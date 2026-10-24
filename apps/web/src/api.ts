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
    throw new ApiError("没有连上登记服务");
  }
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    const message = body && typeof body.error === "string" ? body.error : "登记失败";
    throw new ApiError(message);
  }
  return body as T;
}
