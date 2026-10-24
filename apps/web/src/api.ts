import type { Status } from "./thread";

export type Provider = "github" | "gitlab" | "azure-devops";

export type Project = {
  id: string;
  name: string;
  repoUrl: string;
  localPath: string;
  provider: Provider;
  startingRef: string;
  testCommand: string;
  devCommand: string;
  requiredChecks: string[];
};

export type ProjectInput = Omit<Project, "id">;

export type Conversation = {
  id: string;
  projectId: string;
  status: Status;
  title: string;
  changeCard: unknown;
  previewUrl: string | null;
  previewStatus: "pending" | "ready" | "missing" | null;
  mrUrl: string | null;
};

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "prompt";
  body: string;
};

export class ApiError extends Error {}

/** 列出已登记的仓库。 */
export function listProjects(): Promise<{ projects: Project[] }> {
  return request("/api/projects/list");
}

/** 新增仓库。本机目录不合法时，接口返回错误且不写入。 */
export function addProject(input: ProjectInput): Promise<{ project: Project }> {
  return request("/api/projects/add", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 列出一个仓库下的对话，最近更新的在前。 */
export function listConversations(projectId: string): Promise<{ conversations: Conversation[] }> {
  return request(`/api/conversations?projectId=${encodeURIComponent(projectId)}`);
}

/** 在这个仓库下新建一条对话。 */
export function createConversation(projectId: string): Promise<{ conversation: Conversation }> {
  return request("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ projectId }),
  });
}

/** 读取一条对话和它的消息。 */
export function getConversation(id: string): Promise<{ conversation: Conversation; messages: ConversationMessage[] }> {
  return request(`/api/conversations/${encodeURIComponent(id)}`);
}

/** 删除一条对话和它的消息。 */
export function deleteConversation(id: string): Promise<void> {
  return request(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** 把使用人的原文写入这条对话。 */
export function sendMessage(id: string, body: string): Promise<{ message: ConversationMessage }> {
  return request(`/api/conversations/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    body: JSON.stringify({ role: "user", body }),
  });
}

/** 修改已有仓库。 */
export function updateProject(id: string, input: ProjectInput): Promise<{ project: Project }> {
  return request(`/api/projects/update/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("没有连上服务");
  }
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    const message = body && typeof body.error === "string" ? body.error : "请求失败";
    throw new ApiError(message);
  }
  return body as T;
}
