import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { type ProjectRecord, Store } from "../db/index.js";
import { createWorktree, hasNewCommits, removeWorktree } from "../src/worktree.js";

const conversationId = "abcdef12-3456-7890-abcd-ef1234567890";

test("创建后出现工作副本和分支，删除后原克隆保持原样", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fe-m6-"));
  const repo = path.join(root, "repo");
  const dataDir = path.join(root, "data");
  mkdirSync(repo);
  git(repo, ["init", "-b", "main"]);
  writeFileSync(path.join(repo, "readme.txt"), "v1\n");
  git(repo, ["add", "readme.txt"]);
  git(repo, ["commit", "-m", "init"]);
  writeFileSync(path.join(repo, "keep.txt"), "leave-me\n");
  writeFileSync(path.join(repo, "readme.txt"), "v1\ndirty\n");
  const before = snapshot(repo);

  const store = new Store(dataDir);
  store.saveProject(project(repo));
  store.insertConversation({ id: conversationId, projectId: "p1" });
  try {
    const created = await createWorktree(store, dataDir, conversationId);
    const again = await createWorktree(store, dataDir, conversationId);
    assert.equal(again.worktreePath, created.worktreePath);
    assert.equal(created.branch, "fe/abcdef12");
    assert.equal(existsSync(created.worktreePath), true);
    assert.equal(git(created.worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]), "fe/abcdef12");
    assert.match(git(repo, ["branch", "--list", "fe/abcdef12"]), /fe\/abcdef12/);
    assert.equal(readFileSync(path.join(created.worktreePath, "readme.txt"), "utf8").replace(/\r\n/g, "\n"), "v1\n");
    assert.equal(existsSync(path.join(repo, "note.txt")), false);
    assert.equal(await hasNewCommits(store, conversationId), false);
    assert.equal(store.conversation(conversationId)?.status, "clarifying");
    assert.deepEqual(snapshot(repo), before);

    writeFileSync(path.join(created.worktreePath, "note.txt"), "from-worktree\n");
    git(created.worktreePath, ["add", "note.txt"]);
    git(created.worktreePath, ["commit", "-m", "note"]);
    assert.equal(await hasNewCommits(store, conversationId), true);
    assert.equal(existsSync(path.join(repo, "note.txt")), false);
    assert.deepEqual(snapshot(repo), before);

    await removeWorktree(store, dataDir, conversationId);
    await removeWorktree(store, dataDir, conversationId);
    assert.equal(existsSync(created.worktreePath), false);
    assert.equal(git(repo, ["branch", "--list", "fe/abcdef12"]), "");
    assert.equal(store.conversation(conversationId)?.worktreePath, null);
    assert.equal(store.conversation(conversationId)?.branch, null);
    assert.deepEqual(snapshot(repo), before);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function project(localPath: string): ProjectRecord {
  return {
    id: "p1",
    name: "示例",
    repoUrl: "https://example.com/repo",
    localPath,
    provider: "github",
    startingRef: "main",
    testCommand: "npm test",
    devCommand: "npm run dev",
    requiredChecks: [],
  };
}

function snapshot(repo: string) {
  return {
    branch: git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]),
    head: git(repo, ["rev-parse", "HEAD"]),
    status: git(repo, ["status", "--porcelain"]),
    readme: readFileSync(path.join(repo, "readme.txt"), "utf8"),
    keep: readFileSync(path.join(repo, "keep.txt"), "utf8"),
  };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "fe",
      GIT_AUTHOR_EMAIL: "fe@example.com",
      GIT_COMMITTER_NAME: "fe",
      GIT_COMMITTER_EMAIL: "fe@example.com",
    },
  }).trim();
}
