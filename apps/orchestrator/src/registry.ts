import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { isOneOf, PROVIDERS, type ProjectRecord, type Provider, type Store } from "../db/index.js";

const execGit = promisify(execFile);

/** 登记接口返回给调用方的错误。status 是 HTTP 状态码。 */
export class RegisterError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** 新增仓库。本机目录不合法时抛错，不写入。 */
export async function registerProject(store: Store, body: unknown, id?: string): Promise<ProjectRecord> {
  const project = parseProject(body, id ?? randomUUID());
  await assertRepo(project.localPath, project.startingRef);
  assertPathFree(store, project);
  store.saveProject(project);
  const saved = store.project(project.id);
  if (!saved) throw new RegisterError("仓库没有写入", 500);
  return saved;
}

/** 修改已有仓库。仓库不存在，或新的本机目录不合法时，不写入。 */
export async function updateProject(store: Store, id: string, body: unknown): Promise<ProjectRecord> {
  if (!store.project(id)) throw new RegisterError("仓库不存在", 404);
  return registerProject(store, body, id);
}

/** 把请求体解析成仓库记录。缺字段或取值不合法时抛错。 */
function parseProject(body: unknown, id: string): ProjectRecord {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RegisterError("登记内容必须是对象", 400);
  }
  const raw = body as Record<string, unknown>;
  const name = text(raw.name);
  const repoUrl = text(raw.repoUrl);
  const localPath = text(raw.localPath);
  const provider = text(raw.provider);
  const startingRef = text(raw.startingRef);
  const testCommand = text(raw.testCommand);
  const devCommand = text(raw.devCommand);
  if (!name || !repoUrl || !localPath || !provider || !startingRef || !testCommand || !devCommand) {
    throw new RegisterError("名称、仓库地址、本机目录、代码托管、起始分支、测试命令和开发命令都要填", 400);
  }
  if (!isOneOf(PROVIDERS, provider)) {
    throw new RegisterError("代码托管只能是 github、gitlab、azure-devops", 400);
  }
  if (!isBranchName(startingRef)) throw new RegisterError("起始分支名称不正确", 400);
  return {
    id,
    name,
    repoUrl,
    localPath: path.resolve(localPath),
    provider: provider as Provider,
    startingRef,
    testCommand,
    devCommand,
    requiredChecks: readChecks(raw.requiredChecks),
  };
}

/** 同一个本机目录只登记一次，避免两份记录改到同一份工作区。 */
function assertPathFree(store: Store, project: ProjectRecord): void {
  const taken = store.listProjects().find((item) => item.id !== project.id && samePath(item.localPath, project.localPath));
  if (taken) throw new RegisterError("这个本机目录已经登记过了", 400);
}

/** 本机目录必须是 git 工作区，并且起始分支已经存在。 */
async function assertRepo(localPath: string, startingRef: string): Promise<void> {
  if (!existsSync(localPath)) throw new RegisterError("本机目录不存在", 400);
  const inside = await git(localPath, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout !== "true") {
    throw new RegisterError("本机目录不是 git 仓库", 400);
  }
  const branch = await git(localPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${startingRef}`]);
  if (branch.code !== 0) throw new RegisterError("起始分支在本机目录里不存在", 400);
}

/** 读取必须通过的检查名。缺省为空列表，字符串按逗号或换行拆开。 */
function readChecks(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") {
    return value
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) => item.trim()).filter(Boolean);
  }
  throw new RegisterError("必须通过的检查需要是字符串列表", 400);
}

/** 读取字符串并去掉首尾空白。不是字符串时返回空串。 */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 判断起始分支名是否只含字母、数字、点、下划线、斜线和横线。 */
function isBranchName(value: string): boolean {
  return /^[A-Za-z0-9._/-]+$/.test(value) && !value.includes("..") && !value.startsWith("-") && !value.startsWith("/");
}

/** 比较两个本机路径是否指向同一目录。Windows 上忽略大小写。 */
function samePath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  if (process.platform === "win32") return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase();
  return resolvedLeft === resolvedRight;
}

/** 在指定目录执行 git。命令失败时返回退出码，找不到 git 时抛错。 */
async function git(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const { stdout } = await execGit("git", args, { cwd, windowsHide: true });
    return { code: 0, stdout: String(stdout).trim() };
  } catch (err) {
    const error = err as { code?: number | string; stdout?: string };
    if (error.code === "ENOENT") throw new RegisterError("无法执行 git", 500);
    const code = typeof error.code === "number" ? error.code : 1;
    return { code, stdout: String(error.stdout ?? "").trim() };
  }
}
