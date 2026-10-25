import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { type ProjectRecord, Store } from "../db/index.js";
import { FakeAgent } from "./agent.js";
import { parseChangeCard } from "./card.js";
import { clarifyPrompt } from "./clarify-prompt.js";
import { startServer } from "./http.js";

test("没有夹具时，假 Agent 用对话摘要生成一张能解析的变更卡", async () => {
  const fake = new FakeAgent();
  const session = await fake.create({ cwd: process.cwd() });
  const run = await session.send({
    prompt: clarifyPrompt({ repoName: "示例", summary: "把首页标题改一下" }),
  });
  const result = await run.wait();
  assert.equal(parseChangeCard(result.text)?.goal, "把首页标题改一下");
  const tooMany = session.send({
    prompt: "x",
    images: Array.from({ length: 5 }, () => ({ data: "aa", mimeType: "image/png" })),
  });
  await assert.rejects(tooMany, /最多四张图/);
});

test("假 Agent 回合法变更卡后进入待确认，并在登记目录上创建澄清 Agent", async () => {
  const agent = new FakeAgent();
  agent.replies.push(cardText("把首页标题改一下"));
  const ctx = await start(agent);
  const controller = new AbortController();
  let incoming: Promise<LiveConversation> | undefined;
  try {
    const created = await post(ctx.port, "/api/conversations", { projectId: ctx.project.id });
    const id = created.body.conversation.id as string;
    const events = await fetch(`http://127.0.0.1:${ctx.port}/api/conversations/${id}/events`, {
      signal: controller.signal,
    });
    const reader = events.body?.getReader();
    assert.ok(reader);
    incoming = readUntil(
      reader,
      (item) => item.type === "conversation" && item.conversation?.status === "pending_confirm",
    );

    const posted = await post(ctx.port, `/api/conversations/${id}/messages`, {
      role: "user",
      body: "把首页标题改一下",
    });
    assert.equal(posted.status, 201);
    const event = await withTimeout(incoming, 3000);
    assert.equal(event.conversation.status, "pending_confirm");
    assert.equal(event.conversation.changeCard.goal, "把首页标题改一下");
    assert.equal(event.conversation.cardFrozen, false);

    const detail = await get(ctx.port, `/api/conversations/${id}`);
    assert.equal(detail.body.conversation.status, "pending_confirm");
    const roles = detail.body.messages.map((item) => item.role);
    assert.deepEqual(roles, ["user", "prompt", "system", "assistant"]);
    const prompt = detail.body.messages.find((item) => item.role === "prompt");
    assert.match(prompt?.body ?? "", /示例/);
    assert.match(prompt?.body ?? "", /把首页标题改一下/);
    assert.match(prompt?.body ?? "", /不要修改文件/);
    assert.deepEqual(agent.createdCwd, [ctx.repo]);
    assert.equal(ctx.store.runs(id)[0]?.status, "finished");
    assert.equal(ctx.store.runs(id)[0]?.phase, "clarify");
  } finally {
    controller.abort();
    await incoming?.catch(() => undefined);
    await ctx.close();
  }
});

test("无法解析的回复留在澄清中，此时不能确认", async () => {
  const agent = new FakeAgent();
  agent.replies.push("我还没想好");
  const ctx = await start(agent);
  try {
    const id = await open(ctx.port, ctx.project.id);
    await post(ctx.port, `/api/conversations/${id}/messages`, { role: "user", body: "改一下" });
    const detail = await get(ctx.port, `/api/conversations/${id}`);
    assert.equal(detail.body.conversation.status, "clarifying");
    assert.equal(detail.body.conversation.changeCard, null);
    assert.match(detail.body.messages.map((item) => item.body).join("\n"), /没有形成变更卡/);
    const confirm = await post(ctx.port, `/api/conversations/${id}/confirm`, {});
    assert.equal(confirm.status, 400);
  } finally {
    await ctx.close();
  }
});

test("使用人补充后重新出卡", async () => {
  const agent = new FakeAgent();
  agent.replies.push(cardText("第一版"), cardText("第二版"));
  const ctx = await start(agent);
  try {
    const id = await open(ctx.port, ctx.project.id);
    await post(ctx.port, `/api/conversations/${id}/messages`, { role: "user", body: "第一版" });
    await post(ctx.port, `/api/conversations/${id}/messages`, { role: "user", body: "改成第二版" });
    const detail = await get(ctx.port, `/api/conversations/${id}`);
    assert.equal(detail.body.conversation.status, "pending_confirm");
    assert.ok(detail.body.conversation.changeCard);
    assert.equal(detail.body.conversation.changeCard.goal, "第二版");
    assert.equal(agent.createdCwd.length, 1);
    assert.equal(agent.resumed.length, 1);
  } finally {
    await ctx.close();
  }
});

test("确认后变更卡不再被澄清回复覆盖", async () => {
  const agent = new FakeAgent();
  agent.replies.push(cardText("保持这张"), cardText("想覆盖"));
  const ctx = await start(agent);
  try {
    const id = await open(ctx.port, ctx.project.id);
    await post(ctx.port, `/api/conversations/${id}/messages`, { role: "user", body: "保持这张" });
    const confirm = await post(ctx.port, `/api/conversations/${id}/confirm`, {});
    assert.equal(confirm.status, 200);
    assert.equal(confirm.body.conversation.cardFrozen, true);
    assert.ok(confirm.body.conversation.changeCard);
    assert.equal(confirm.body.conversation.changeCard.goal, "保持这张");

    await post(ctx.port, `/api/conversations/${id}/messages`, { role: "user", body: "再改一改" });
    const detail = await get(ctx.port, `/api/conversations/${id}`);
    assert.ok(detail.body.conversation.changeCard);
    assert.equal(detail.body.conversation.changeCard.goal, "保持这张");
    assert.equal(detail.body.conversation.cardFrozen, true);
    assert.equal(detail.body.conversation.status, "pending_confirm");
    assert.equal(agent.createdCwd.length, 1);
    assert.equal(agent.resumed.length, 0);
  } finally {
    await ctx.close();
  }
});

test("澄清改脏登记目录或拉出新分支时收回改动，并留在澄清中", async () => {
  const dirty = new FakeAgent();
  dirty.replies.push(cardText("不该采用"));
  dirty.beforeWait = (cwd) => writeFileSync(path.join(cwd, "dirty.txt"), "x");
  const dirtyCtx = await start(dirty);
  try {
    const id = await open(dirtyCtx.port, dirtyCtx.project.id);
    await post(dirtyCtx.port, `/api/conversations/${id}/messages`, { role: "user", body: "改首页" });
    const detail = await get(dirtyCtx.port, `/api/conversations/${id}`);
    assert.equal(detail.body.conversation.status, "clarifying");
    assert.equal(detail.body.conversation.changeCard, null);
    assert.equal(existsSync(path.join(dirtyCtx.repo, "dirty.txt")), false);
    assert.match(detail.body.messages.map((item) => item.body).join("\n"), /不允许改仓库/);
  } finally {
    await dirtyCtx.close();
  }

  const branched = new FakeAgent();
  branched.replies.push(cardText("不该采用"));
  branched.beforeWait = (cwd) => execFileSync("git", ["checkout", "-b", "sneak"], { cwd, windowsHide: true });
  const branchCtx = await start(branched);
  try {
    const id = await open(branchCtx.port, branchCtx.project.id);
    await post(branchCtx.port, `/api/conversations/${id}/messages`, { role: "user", body: "改首页" });
    const detail = await get(branchCtx.port, `/api/conversations/${id}`);
    assert.equal(detail.body.conversation.status, "clarifying");
    assert.equal(detail.body.conversation.changeCard, null);
    const head = git(branchCtx.repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
    assert.equal(head, "main");
    const listed = git(branchCtx.repo, ["branch", "--list", "sneak"]);
    assert.equal(listed, "");
  } finally {
    await branchCtx.close();
  }
});

test("只报告了新分支时也不进入待确认", async () => {
  const agent = new FakeAgent();
  agent.replies.push(cardText("不该采用"));
  agent.reportedBranches = ["ghost"];
  const ctx = await start(agent);
  try {
    const id = await open(ctx.port, ctx.project.id);
    await post(ctx.port, `/api/conversations/${id}/messages`, { role: "user", body: "改首页" });
    const detail = await get(ctx.port, `/api/conversations/${id}`);
    assert.equal(detail.body.conversation.status, "clarifying");
    assert.equal(detail.body.conversation.changeCard, null);
  } finally {
    await ctx.close();
  }
});

test("登记目录里原本的未提交文件，在澄清结束后还在", async () => {
  const agent = new FakeAgent();
  agent.replies.push(cardText("只改标题"));
  const ctx = await start(agent);
  try {
    writeFileSync(path.join(ctx.repo, "keep.txt"), "leave-me");
    const id = await open(ctx.port, ctx.project.id);
    await post(ctx.port, `/api/conversations/${id}/messages`, { role: "user", body: "改标题" });
    const detail = await get(ctx.port, `/api/conversations/${id}`);
    assert.equal(detail.body.conversation.status, "pending_confirm");
    assert.equal(existsSync(path.join(ctx.repo, "keep.txt")), true);
  } finally {
    await ctx.close();
  }
});

function cardText(goal: string): string {
  return [
    "整理好了。",
    "FE_HARNESS_CARD",
    `goal: ${goal}`,
    "pages: 首页",
    "acceptance:",
    "- 打开首页能看到新标题",
    "outOfScope:",
    "- 不改其他页面",
    "summary: 只改首页标题",
  ].join("\n");
}

async function open(port: number, projectId: string): Promise<string> {
  const created = await post(port, "/api/conversations", { projectId });
  assert.equal(created.status, 201);
  return created.body.conversation.id as string;
}

async function start(agent: FakeAgent) {
  const root = mkdtempSync(path.join(tmpdir(), "fe-m5-"));
  const repo = path.join(root, "repo");
  const dataDir = path.join(root, "data");
  mkdirSync(repo);
  initRepo(repo);
  const store = new Store(dataDir);
  const project: ProjectRecord = {
    id: "p1",
    name: "示例",
    repoUrl: "https://example.com/repo",
    localPath: repo,
    provider: "github",
    startingRef: "main",
    testCommand: "npm test",
    devCommand: "npm run dev",
    requiredChecks: [],
  };
  store.saveProject(project);
  const started = await startServer(store, 0, { agent });
  return {
    port: started.port,
    project,
    repo,
    store,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        started.server.close((err) => (err ? reject(err) : resolve()));
      });
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function initRepo(dir: string): void {
  git(dir, ["init", "-b", "main"]);
  git(dir, ["commit", "--allow-empty", "-m", "init"]);
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

async function post(port: number, pathname: string, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Json };
}

async function get(port: number, pathname: string) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  return { status: response.status, body: (await response.json()) as Json };
}

type LiveConversation = {
  conversation: { status: string; changeCard: { goal: string }; cardFrozen: boolean };
};

type Json = {
  conversation: {
    id: string;
    status: string;
    cardFrozen: boolean;
    changeCard: { goal: string } | null;
  };
  messages: Array<{ role: string; body: string }>;
  error?: string;
};

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  matches: (item: { type?: string; conversation?: { status?: string; changeCard?: { goal?: string }; cardFrozen?: boolean } }) => boolean,
): Promise<LiveConversation> {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    while (!buffer.includes("\n\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("推送已断开");
      buffer += decoder.decode(value, { stream: true });
    }
    const split = buffer.indexOf("\n\n");
    const block = buffer.slice(0, split);
    buffer = buffer.slice(split + 2);
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data) continue;
    const parsed = JSON.parse(data) as { type?: string; conversation?: { status?: string; changeCard?: { goal?: string }; cardFrozen?: boolean } };
    if (matches(parsed) && parsed.conversation?.status && parsed.conversation.changeCard && parsed.conversation.cardFrozen !== undefined) {
      return {
        conversation: {
          status: parsed.conversation.status,
          changeCard: parsed.conversation.changeCard as { goal: string },
          cardFrozen: parsed.conversation.cardFrozen,
        },
      };
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("没有收到推送")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
