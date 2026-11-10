// 三种代码托管共用这一组调用：由 submitMergeRequest 选择适配器并交出请求。
import type { Provider } from "../db/index.js";

/** 代码托管接口没有按预期返回。 */
export class HostError extends Error {}

/** 交给调用方发出的一条托管请求。调用方负责真正的网络访问。 */
export type HostRequest = {
  method: "POST" | "PATCH" | "PUT";
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

/** 创建或更新一份合并请求需要的材料。mrUrl 有值时走更新。 */
export type MergeRequestInput = {
  repoUrl: string;
  token: string;
  title: string;
  description: string;
  head: string;
  base: string;
  mrUrl: string | null;
};

/** 实际发出请求。测试里换成记录请求的假实现。 */
export type HostCaller = (request: HostRequest) => Promise<unknown>;

type Adapter = {
  create(input: MergeRequestInput): HostRequest;
  update(input: MergeRequestInput): HostRequest;
  readUrl(body: unknown, input: MergeRequestInput): string;
};

const adapters: Record<Provider, Adapter> = {
  github: {
    create: githubCreate,
    update: githubUpdate,
    readUrl: (body) => readField(body, "html_url"),
  },
  gitlab: {
    create: gitlabCreate,
    update: gitlabUpdate,
    readUrl: (body) => readField(body, "web_url"),
  },
  "azure-devops": {
    create: azureCreate,
    update: azureUpdate,
    readUrl: readAzureUrl,
  },
};

/**
 * 按仓库的代码托管创建或更新合并请求。
 * 已有地址时更新描述，没有时新建。网络访问由 call 完成。
 */
export async function submitMergeRequest(provider: Provider, input: MergeRequestInput, call: HostCaller): Promise<string> {
  if (!input.token) throw new HostError(missingToken(provider));
  const adapter = adapters[provider];
  const request = input.mrUrl ? adapter.update(input) : adapter.create(input);
  const body = await call(request);
  return adapter.readUrl(body, input);
}

/** 用配置里的令牌访问代码托管。失败时抛出不含令牌的错误。 */
export async function callHost(request: HostRequest): Promise<unknown> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: { "content-type": "application/json", "user-agent": "fe-harness", ...request.headers },
    body: JSON.stringify(request.body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) throw new HostError(`代码托管拒绝了这次请求：${errorText(parsed, response.status)}`);
  return parsed;
}

/** 把 https 仓库地址加上令牌，供 git push 使用。本地路径原样返回。 */
export function remoteWithToken(provider: Provider, repoUrl: string, token: string): string {
  let url: URL;
  try {
    url = new URL(repoUrl);
  } catch {
    return repoUrl;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return repoUrl;
  if (!token) throw new HostError(missingToken(provider));
  url.username = provider === "gitlab" ? "oauth2" : provider === "github" ? "x-access-token" : "pat";
  url.password = token;
  return url.href;
}

function githubCreate(input: MergeRequestInput): HostRequest {
  const repo = githubRepo(input.repoUrl);
  return {
    method: "POST",
    url: `${repo.api}/repos/${repo.owner}/${repo.name}/pulls`,
    headers: githubHeaders(input.token),
    body: { title: input.title, body: input.description, head: input.head, base: input.base },
  };
}

function githubUpdate(input: MergeRequestInput): HostRequest {
  const repo = githubRepo(input.repoUrl);
  const number = requestNumber(input.mrUrl, "pull");
  return {
    method: "PATCH",
    url: `${repo.api}/repos/${repo.owner}/${repo.name}/pulls/${number}`,
    headers: githubHeaders(input.token),
    body: { title: input.title, body: input.description },
  };
}

function gitlabCreate(input: MergeRequestInput): HostRequest {
  const repo = gitlabRepo(input.repoUrl);
  return {
    method: "POST",
    url: `${repo.api}/projects/${repo.project}/merge_requests`,
    headers: { "PRIVATE-TOKEN": input.token },
    body: {
      source_branch: input.head,
      target_branch: input.base,
      title: input.title,
      description: input.description,
    },
  };
}

function gitlabUpdate(input: MergeRequestInput): HostRequest {
  const repo = gitlabRepo(input.repoUrl);
  const number = requestNumber(input.mrUrl, "merge_requests");
  return {
    method: "PUT",
    url: `${repo.api}/projects/${repo.project}/merge_requests/${number}`,
    headers: { "PRIVATE-TOKEN": input.token },
    body: { title: input.title, description: input.description },
  };
}

function azureCreate(input: MergeRequestInput): HostRequest {
  const repo = azureRepo(input.repoUrl);
  return {
    method: "POST",
    url: `${repo.api}?api-version=7.1`,
    headers: azureHeaders(input.token),
    body: {
      title: input.title,
      description: input.description,
      sourceRefName: fullRef(input.head),
      targetRefName: fullRef(input.base),
    },
  };
}

function azureUpdate(input: MergeRequestInput): HostRequest {
  const repo = azureRepo(input.repoUrl);
  const number = requestNumber(input.mrUrl, "pullrequest");
  return {
    method: "PATCH",
    url: `${repo.api}/${number}?api-version=7.1`,
    headers: azureHeaders(input.token),
    body: { title: input.title, description: input.description },
  };
}

function githubRepo(repoUrl: string): { api: string; owner: string; name: string } {
  const url = parseHttp(repoUrl, "GitHub");
  const parts = pathParts(url);
  if (parts.length < 2) throw new HostError("仓库地址无法对应到 GitHub 仓库");
  const api = url.hostname === "github.com" ? "https://api.github.com" : `${url.origin}/api/v3`;
  return { api, owner: encodeURIComponent(parts[0]), name: encodeURIComponent(parts[1]) };
}

function gitlabRepo(repoUrl: string): { api: string; project: string } {
  const url = parseHttp(repoUrl, "GitLab");
  const parts = pathParts(url);
  if (parts.length < 2) throw new HostError("仓库地址无法对应到 GitLab 仓库");
  return { api: `${url.origin}/api/v4`, project: encodeURIComponent(parts.join("/")) };
}

function azureRepo(repoUrl: string): { api: string; web: string } {
  const url = parseHttp(repoUrl, "Azure DevOps");
  const parts = pathParts(url);
  const gitAt = parts.indexOf("_git");
  if (url.hostname === "dev.azure.com" || url.hostname.endsWith(".dev.azure.com")) {
    if (gitAt !== 2 || parts.length < 4) throw new HostError("仓库地址无法对应到 Azure DevOps 仓库");
    const [org, project, , repo] = parts;
    const base = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}`;
    return {
      api: `${base}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests`,
      web: `${base}/_git/${encodeURIComponent(repo)}`,
    };
  }
  if (url.hostname.endsWith(".visualstudio.com")) {
    if (gitAt !== 1 || parts.length < 3) throw new HostError("仓库地址无法对应到 Azure DevOps 仓库");
    const org = url.hostname.slice(0, url.hostname.indexOf("."));
    const [project, , repo] = parts;
    const base = `https://${encodeURIComponent(org)}.visualstudio.com/${encodeURIComponent(project)}`;
    return {
      api: `${base}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests`,
      web: `${base}/_git/${encodeURIComponent(repo)}`,
    };
  }
  throw new HostError("仓库地址无法对应到 Azure DevOps 仓库");
}

function readAzureUrl(body: unknown, input: MergeRequestInput): string {
  const id = body && typeof body === "object" ? (body as { pullRequestId?: unknown }).pullRequestId : undefined;
  if (typeof id !== "number") {
    if (input.mrUrl) return input.mrUrl;
    throw new HostError("代码托管没有返回合并请求地址");
  }
  return `${azureRepo(input.repoUrl).web}/pullrequest/${id}`;
}

function parseHttp(repoUrl: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(repoUrl);
  } catch {
    throw new HostError(`仓库地址无法对应到 ${name} 仓库`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HostError(`仓库地址无法对应到 ${name} 仓库`);
  }
  return url;
}

function pathParts(url: URL): string[] {
  return url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .map((part, index, all) => (index === all.length - 1 ? part.replace(/\.git$/, "") : part));
}

function githubHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
  };
}

function azureHeaders(token: string): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}` };
}

function fullRef(name: string): string {
  return name.startsWith("refs/") ? name : `refs/heads/${name}`;
}

function requestNumber(mrUrl: string | null, marker: string): string {
  const match = mrUrl ? new RegExp(`/${marker}/(\\d+)`).exec(mrUrl) : null;
  if (!match) throw new HostError("合并请求地址无法识别");
  return match[1];
}

function readField(body: unknown, key: string): string {
  if (!body || typeof body !== "object") throw new HostError("代码托管没有返回合并请求地址");
  const value = (body as Record<string, unknown>)[key];
  if (typeof value !== "string" || !value.trim()) throw new HostError("代码托管没有返回合并请求地址");
  return value;
}

function errorText(body: unknown, status: number): string {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 200);
  }
  return `HTTP ${status}`;
}

function missingToken(provider: Provider): string {
  if (provider === "github") return "没有配置 GitHub 令牌";
  if (provider === "gitlab") return "没有配置 GitLab 令牌";
  return "没有配置 Azure DevOps 令牌";
}
