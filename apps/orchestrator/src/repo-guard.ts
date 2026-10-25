import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execGit = promisify(execFile);

export type RepoSnapshot = {
  branch: string;
  head: string;
  branches: string[];
  status: string;
};

/** 记下登记目录当前的分支、提交和工作区。不是 git 仓库时返回 null。 */
export async function captureRepo(cwd: string): Promise<RepoSnapshot | null> {
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout !== "true") return null;
  const branch = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = await git(cwd, ["rev-parse", "HEAD"]);
  const list = await git(cwd, ["for-each-ref", "refs/heads", "--format=%(refname:short)"]);
  const status = await git(cwd, ["status", "--porcelain"]);
  if (branch.code !== 0 || head.code !== 0) return null;
  return {
    branch: branch.stdout,
    head: head.stdout,
    branches: splitLines(list.stdout),
    status: status.stdout,
  };
}

/** 工作区原本有改动时先暂存，避免收回澄清改动时把它们清掉。 */
export async function holdUserChanges(cwd: string, status: string): Promise<"clean" | "held" | "failed"> {
  if (!status) return "clean";
  const result = await git(cwd, ["stash", "push", "-u", "-m", "fe-harness-clarify"]);
  return result.code === 0 ? "held" : "failed";
}

/** 把暂存的使用人改动放回工作区。 */
export async function restoreHeldChanges(cwd: string): Promise<boolean> {
  const result = await git(cwd, ["stash", "pop"]);
  return result.code === 0;
}

/**
 * 相对快照，工作区被改脏或出现新分支时收回。
 * 报告里带了新分支也视为这一轮不干净。返回 true 表示变更卡不能采用。
 */
export async function revertClarifyDirt(cwd: string, baseline: RepoSnapshot, reportedBranches: string[]): Promise<boolean> {
  const after = await captureRepo(cwd);
  if (!after) return true;
  const newBranches = after.branches.filter((name) => !baseline.branches.includes(name));
  const changed =
    after.head !== baseline.head ||
    after.branch !== baseline.branch ||
    after.status !== baseline.status ||
    newBranches.length > 0;
  if (changed) {
    if (after.branch !== baseline.branch) await git(cwd, ["checkout", baseline.branch]);
    await git(cwd, ["reset", "--hard", baseline.head]);
    await git(cwd, ["clean", "-fd"]);
    const now = await captureRepo(cwd);
    for (const name of (now?.branches ?? []).filter((item) => !baseline.branches.includes(item))) {
      await git(cwd, ["branch", "-D", name]);
    }
  }
  return changed || reportedBranches.some((name) => name.trim());
}

async function git(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const { stdout } = await execGit("git", args, {
      cwd,
      windowsHide: true,
      encoding: "utf8",
      env: gitEnv(),
    });
    return { code: 0, stdout: String(stdout).trim() };
  } catch (err) {
    const error = err as { code?: number | string; stdout?: string };
    if (error.code === "ENOENT") throw new Error("无法执行 git");
    const code = typeof error.code === "number" ? error.code : 1;
    return { code, stdout: String(error.stdout ?? "").trim() };
  }
}

/** 暂存提交需要作者。没有配置时用本地占位，不改 git 配置。 */
function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "fe-harness",
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "fe-harness@localhost",
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "fe-harness",
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "fe-harness@localhost",
  };
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}
