// 每个对话一份 git worktree。
// 澄清阶段弄脏登记目录时的收回仍由 repo-guard 负责。
import { execFile } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Store } from "../db/index.js";

const execGit = promisify(execFile);

/** 工作副本操作失败。 */
export class WorktreeError extends Error {}

/** 对话专属分支：fe/ 加上对话 id 的前 8 位。 */
export function branchName(conversationId: string): string {
  const id = conversationId.trim();
  if (id.length < 8 || id.includes("..") || /[\\/]/.test(id)) {
    throw new WorktreeError("对话 id 无法生成分支名");
  }
  return `fe/${id.slice(0, 8)}`;
}

/** 工作副本目录：data/worktrees/<对话 id>。 */
export function worktreeLocation(dataDir: string, conversationId: string): string {
  const id = conversationId.trim();
  if (!id || id.includes("..") || /[\\/]/.test(id)) {
    throw new WorktreeError("对话 id 不能作为目录名");
  }
  return path.resolve(dataDir, "worktrees", id);
}

/** 从登记的起始分支拉出这个对话的工作副本，并把目录和分支记到对话上。已有则直接返回。 */
export async function createWorktree(
  store: Store,
  dataDir: string,
  conversationId: string,
): Promise<{ worktreePath: string; branch: string }> {
  const { project } = requirePair(store, conversationId);
  const branch = branchName(conversationId);
  const location = worktreeLocation(dataDir, conversationId);
  if (samePath(location, project.localPath)) throw new WorktreeError("工作副本不能放在登记目录里");

  const existing = await findWorktree(project.localPath, location);
  if (existing) {
    if (existing.branch !== branch) throw new WorktreeError("这个目录已经是别的分支的工作副本");
    linkNodeModules(project.localPath, location);
    const savedPath = canonical(location);
    store.patchConversation(conversationId, { worktreePath: savedPath, branch });
    return { worktreePath: savedPath, branch };
  }
  if (existsSync(location)) throw new WorktreeError("工作副本目录已被占用");

  const start = await git(project.localPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${project.startingRef}`]);
  if (start.code !== 0) throw new WorktreeError("起始分支在本机目录里不存在");

  mkdirSync(path.dirname(location), { recursive: true });
  const branchRef = await git(project.localPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  const args =
    branchRef.code === 0
      ? ["worktree", "add", location, branch]
      : ["worktree", "add", "-b", branch, location, project.startingRef];
  const added = await git(project.localPath, args);
  if (added.code !== 0) throw new WorktreeError(added.stderr || "没能创建工作副本");
  linkNodeModules(project.localPath, location);
  const savedPath = canonical(location);
  store.patchConversation(conversationId, { worktreePath: savedPath, branch });
  return { worktreePath: savedPath, branch };
}

/** 把工作副本当前提交推到远程的同名分支。不修改本地 git 配置。 */
export async function pushBranch(cwd: string, branch: string, remote: string): Promise<void> {
  if (!branch || branch.startsWith("-") || !/^[\w./-]+$/.test(branch)) {
    throw new WorktreeError("分支名无法推送");
  }
  if (!remote || remote.startsWith("-")) throw new WorktreeError("推送地址不合法");
  const result = await git(cwd, ["push", remote, `HEAD:refs/heads/${branch}`], {
    ...gitEnv(),
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
  });
  if (result.code !== 0) {
    throw new WorktreeError(redactRemote(result.stderr || result.stdout || "没能推送分支", remote));
  }
}

/** 工作副本相对起始分支是否已有新提交。 */
export async function hasNewCommits(store: Store, conversationId: string): Promise<boolean> {
  const { conversation, project } = requirePair(store, conversationId);
  if (!conversation.worktreePath) throw new WorktreeError("还没有工作副本");
  const count = await git(conversation.worktreePath, ["rev-list", "--count", `${project.startingRef}..HEAD`]);
  if (count.code !== 0) throw new WorktreeError(count.stderr || "没能比较提交");
  const commits = Number(count.stdout);
  if (!Number.isInteger(commits)) throw new WorktreeError("没能比较提交");
  return commits > 0;
}

/** 删除工作副本和它的分支。登记目录里的分支、提交和工作区保持原样。 */
export async function removeWorktree(store: Store, dataDir: string, conversationId: string): Promise<void> {
  const { conversation, project } = requirePair(store, conversationId);
  const branch = conversation.branch ?? branchName(conversationId);
  const location = path.resolve(conversation.worktreePath ?? worktreeLocation(dataDir, conversationId));
  if (samePath(location, project.localPath)) throw new WorktreeError("不能删除登记目录");
  if (branch === project.startingRef) throw new WorktreeError("不能删除起始分支");
  detachNodeModulesLink(location);

  const listed = await findWorktree(project.localPath, location);
  if (listed) {
    const removed = await git(project.localPath, ["worktree", "remove", "--force", location]);
    if (removed.code !== 0) throw new WorktreeError(removed.stderr || "没能删除工作副本");
  } else if (existsSync(location)) {
    if (!samePath(location, worktreeLocation(dataDir, conversationId))) {
      throw new WorktreeError("工作副本目录不在数据目录里，没有删除");
    }
    rmSync(location, { recursive: true, force: true });
    await git(project.localPath, ["worktree", "prune"]);
  }

  const head = await git(project.localPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (head.stdout === branch) throw new WorktreeError("分支正被登记目录使用，没有删除");
  const has = await git(project.localPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (has.code === 0) {
    const deleted = await git(project.localPath, ["branch", "-D", branch]);
    if (deleted.code !== 0) throw new WorktreeError(deleted.stderr || "没能删除分支");
  }
  store.patchConversation(conversationId, { worktreePath: null, branch: null });
}

/**
 * 工作副本根目录没有 node_modules 时，联接到登记仓库的 node_modules。
 * 本体没有依赖目录，或工作副本里已经有真实目录或链接时，保持原样。
 */
function linkNodeModules(repoPath: string, worktreePath: string): void {
  const source = path.join(repoPath, "node_modules");
  const linkPath = path.join(worktreePath, "node_modules");
  let sourceStat;
  try {
    sourceStat = lstatSync(source);
  } catch {
    return;
  }
  if (!sourceStat.isDirectory() && !sourceStat.isSymbolicLink()) return;
  try {
    lstatSync(linkPath);
    return;
  } catch {
    // 工作副本里还没有 node_modules。
  }
  try {
    symlinkSync(path.resolve(source), linkPath, process.platform === "win32" ? "junction" : "dir");
  } catch (err) {
    const message = err instanceof Error ? err.message : "没能映射 node_modules";
    throw new WorktreeError(`没能映射 node_modules：${message}`);
  }
}

/** 删工作副本前先拆掉 node_modules 链接。只拆链接，不碰真实目录，也不跟着链接删本体。 */
function detachNodeModulesLink(worktreePath: string): void {
  const linkPath = path.join(worktreePath, "node_modules");
  try {
    if (!lstatSync(linkPath).isSymbolicLink()) return;
  } catch {
    return;
  }
  rmSync(linkPath, { force: true });
}

/** 取出这条对话和它所属的仓库。对话或仓库不存在时抛错。 */
function requirePair(store: Store, conversationId: string) {
  const conversation = store.conversation(conversationId);
  if (!conversation) throw new WorktreeError("对话不存在");
  const project = store.project(conversation.projectId);
  if (!project) throw new WorktreeError("仓库不存在");
  return { conversation, project };
}

/** 在仓库的工作副本列表里查找这个目录。找到时返回它当前检出的分支。 */
async function findWorktree(repo: string, location: string): Promise<{ branch: string } | null> {
  const listed = await git(repo, ["worktree", "list", "--porcelain"]);
  if (listed.code !== 0) return null;
  for (const block of listed.stdout.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const worktree = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    if (!worktree || !samePath(worktree, location)) continue;
    const ref = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length) ?? "";
    return { branch: ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref };
  }
  return null;
}

/** 在指定目录执行一条 git 命令。命令失败时返回退出码和输出；本机没有 git 时抛错。 */
async function git(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = gitEnv(),
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execGit("git", args, {
      cwd,
      windowsHide: true,
      encoding: "utf8",
      env,
    });
    return { code: 0, stdout: String(stdout).trim(), stderr: String(stderr).trim() };
  } catch (err) {
    const error = err as { code?: number | string; stdout?: string; stderr?: string };
    if (error.code === "ENOENT") throw new WorktreeError("无法执行 git");
    const code = typeof error.code === "number" ? error.code : 1;
    return { code, stdout: String(error.stdout ?? "").trim(), stderr: String(error.stderr ?? "").trim() };
  }
}

/** 输出里如果带上了远程地址中的令牌，换成占位符。 */
function redactRemote(text: string, remote: string): string {
  let secret = "";
  try {
    secret = new URL(remote).password;
  } catch {
    secret = "";
  }
  if (!secret) return text || "没能推送分支";
  return text.split(secret).join("***").split(encodeURIComponent(secret)).join("***") || "没能推送分支";
}

/** 需要作者时用本地占位，不改 git 配置。 */
function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "fe-harness",
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "fe-harness@localhost",
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "fe-harness",
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "fe-harness@localhost",
  };
}

/** 比较两条路径是否指向同一位置。Windows 上忽略大小写。 */
function samePath(left: string, right: string): boolean {
  const resolvedLeft = canonical(left);
  const resolvedRight = canonical(right);
  if (process.platform === "win32") return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase();
  return resolvedLeft === resolvedRight;
}

/** 把短文件名和斜杠展开成同一条实际路径。目录还不存在时退回绝对路径。 */
function canonical(value: string): string {
  const resolved = path.resolve(value);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}
