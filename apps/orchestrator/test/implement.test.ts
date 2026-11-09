import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { type ProjectRecord, Store } from "../db/index.js";
import { FakeAgent } from "../src/agent.js";
import { Live } from "../src/conversations.js";
import { cancelCoding, passPreview, runImplement, runRevise } from "../src/implement.js";
import { stopPreview } from "../src/preview.js";
import { progressPhrase } from "../src/progress.js";
import { removeWorktree } from "../src/worktree.js";

const conversationId = "abcdef12-3456-7890-abcd-ef1234567890";

test("工具事件收成看页面、改代码、跑测试", () => {
  assert.equal(progressPhrase("grep", "", "npm test"), "正在看页面");
  assert.equal(progressPhrase("edit", "src/App.tsx", "npm test"), "正在改代码");
  assert.equal(progressPhrase("shell", "npm test", "npm test"), "正在跑测试");
});

test("假 Agent 收到冻结卡和分支名，取消后可以再操作，返工不新建实现 Agent", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fe-m7-"));
  const repo = path.join(root, "repo");
  const dataDir = path.join(root, "data");
  mkdirSync(repo);
  git(repo, ["init", "-b", "main"]);
  writeFileSync(path.join(repo, "readme.txt"), "v1\n");
  git(repo, ["add", "readme.txt"]);
  git(repo, ["commit", "-m", "init"]);

  const store = new Store(dataDir);
  const live = new Live();
  const agent = new FakeAgent();
  agent.hold = true;
  agent.progressCommand = "npm test";
  agent.tools.push({ name: "edit", detail: "src/App.tsx" });
  store.saveProject(project(repo));
  store.insertConversation({ id: conversationId, projectId: "p1", status: "待确认" });
  store.patchConversation(conversationId, {
    changeCard: {
      goal: "把首页标题改一下",
      pages: "首页",
      acceptance: ["打开首页能看到新标题"],
      outOfScope: ["不改其他页面"],
      summary: "只改首页标题",
      frozen: true,
    },
  });

  const first = runImplement(store, live, agent, dataDir, conversationId);
  try {
    await waitFor(() => store.messages(conversationId).some((item) => item.body === "正在改代码"));
    const prompt = agent.prompts[0] ?? "";
    assert.match(prompt, /把首页标题改一下/);
    assert.match(prompt, /fe\/abcdef12/);
    assert.match(prompt, /改完后在当前分支提交/);
    assert.doesNotMatch(prompt, /FE_HARNESS_REPORT/);
    assert.match(prompt, /不要修改 package.json 的 scripts/);
    assert.equal(store.conversation(conversationId)?.status, "开发中");
    assert.equal(store.conversation(conversationId)?.branch, "fe/abcdef12");
    assert.equal(existsSync(store.conversation(conversationId)?.worktreePath ?? ""), true);
    assert.equal(agent.createdCwd.length, 1);
    assert.equal(agent.createdCwd[0], store.conversation(conversationId)?.worktreePath);
    assert.equal(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]), "main");
    assert.equal(store.runs(conversationId)[0]?.phase, "implement");
    assert.equal(store.runs(conversationId)[0]?.status, "running");

    const second = runRevise(store, live, agent, dataDir, conversationId, "把标题再改大一点");
    await waitFor(() => agent.prompts.length === 2);
    await first;
    assert.equal(store.runs(conversationId).find((item) => item.phase === "implement")?.status, "cancelled");
    assert.equal(agent.createdCwd.length, 1);
    assert.equal(agent.resumed.length, 1);
    assert.match(agent.prompts[1] ?? "", /fe\/abcdef12/);
    assert.match(agent.prompts[1] ?? "", /把首页标题改一下/);
    assert.match(agent.prompts[1] ?? "", /把标题再改大一点/);

    await cancelCoding(store, live, conversationId);
    await second;
    assert.equal(store.conversation(conversationId)?.status, "待确认");
    assert.equal(store.runs(conversationId).every((item) => item.status === "cancelled"), true);

    agent.hold = false;
    agent.replies.push("按补充改好了。");
    await runRevise(store, live, agent, dataDir, conversationId, "再改一次");
    assert.equal(agent.createdCwd.length, 1);
    assert.equal(agent.resumed.length, 2);
    assert.equal(store.runs(conversationId).filter((item) => item.phase === "revise" && item.status === "finished").length, 1);
    assert.equal(store.conversation(conversationId)?.status, "未通过");
    const verdict = store.conversation(conversationId)?.report as { unmet?: string[] };
    assert.ok(verdict.unmet?.includes("相对起始分支没有新提交"));
    assert.throws(() => passPreview(store, live, conversationId), /现在还不能通过/);
    assert.equal(store.conversation(conversationId)?.implementAgentId, agent.resumed[0]);
  } finally {
    agent.release();
    await first.catch(() => undefined);
    if (store.conversation(conversationId)?.worktreePath) {
      await removeWorktree(store, dataDir, conversationId).catch(() => undefined);
    }
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("有新提交后进入待验收并给出预览地址，通过后进入待合并", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fe-m7-preview-"));
  const repo = path.join(root, "repo");
  const dataDir = path.join(root, "data");
  const stub = path.join(root, "preview-stub.js");
  const id = "bbbbbbbb-3456-7890-abcd-ef1234567890";
  mkdirSync(repo);
  git(repo, ["init", "-b", "main"]);
  writeFileSync(path.join(repo, "readme.txt"), "v1\n");
  git(repo, ["add", "readme.txt"]);
  git(repo, ["commit", "-m", "init"]);
  writeFileSync(stub, "console.log('http://127.0.0.1:9/');\nsetInterval(() => {}, 1000);\n");

  const store = new Store(dataDir);
  const live = new Live();
  const agent = new FakeAgent();
  agent.replies.push("改好了。");
  agent.beforeWait = (cwd) => {
    writeFileSync(path.join(cwd, "readme.txt"), "v2\n");
    git(cwd, ["add", "readme.txt"]);
    git(cwd, ["commit", "-m", "preview"]);
  };
  store.saveProject({ ...project(repo), devCommand: `node "${stub}"` });
  store.insertConversation({ id, projectId: "p1", status: "待确认" });
  store.patchConversation(id, {
    changeCard: {
      goal: "把首页标题改一下",
      pages: "首页",
      acceptance: ["打开首页能看到新标题"],
      outOfScope: [],
      summary: "只改首页标题",
      frozen: true,
    },
  });
  try {
    await runImplement(store, live, agent, dataDir, id);
    const conversation = store.conversation(id);
    assert.equal(conversation?.status, "待验收");
    assert.equal(conversation?.previewStatus, "ready");
    assert.equal(conversation?.previewUrl, "http://127.0.0.1:9/");
    assert.ok(store.messages(id).some((item) => item.body.startsWith("预览地址：")));
    passPreview(store, live, id);
    assert.equal(store.conversation(id)?.status, "待合并");
    assert.ok(store.messages(id).some((item) => item.body === "使用人已通过预览。"));
  } finally {
    await stopPreview(id);
    if (store.conversation(id)?.worktreePath) {
      await removeWorktree(store, dataDir, id).catch(() => undefined);
    }
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

async function waitFor(ready: () => boolean): Promise<void> {
  const start = Date.now();
  while (!ready()) {
    if (Date.now() - start > 3000) throw new Error("超时");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
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
