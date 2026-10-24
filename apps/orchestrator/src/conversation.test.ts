import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { type ProjectRecord, Store } from "../db/index.js";
import { startServer } from "./http.js";

test("两个客户端打开同一条对话，一边写入系统消息，另一边通过 SSE 收到", async () => {
  const ctx = await start();
  const controller = new AbortController();
  let incoming: Promise<string> | undefined;
  try {
    const created = await post(ctx.port, "/api/conversations", { projectId: ctx.project.id });
    assert.equal(created.status, 201);
    const id = created.body.conversation.id as string;

    const events = await fetch(`http://127.0.0.1:${ctx.port}/api/conversations/${id}/events`, {
      signal: controller.signal,
    });
    assert.equal(events.status, 200);
    assert.match(events.headers.get("content-type") ?? "", /text\/event-stream/);
    const reader = events.body?.getReader();
    assert.ok(reader);
    incoming = nextData(reader);

    const posted = await post(ctx.port, `/api/conversations/${id}/messages`, {
      role: "system",
      body: "系统消息到了",
    });
    assert.equal(posted.status, 201);

    const event = JSON.parse(await withTimeout(incoming, 3000)) as {
      type: string;
      message: { role: string; body: string };
    };
    assert.equal(event.type, "message");
    assert.equal(event.message.role, "system");
    assert.equal(event.message.body, "系统消息到了");
  } finally {
    controller.abort();
    await incoming?.catch(() => undefined);
    await ctx.close();
  }
});

test("对话可以新建、按仓库列出、保存使用人原文和提示，删除后记录消失", async () => {
  const ctx = await start();
  try {
    const other = { ...ctx.project, id: "p2", name: "另一个" };
    ctx.store.saveProject(other);
    const created = await post(ctx.port, "/api/conversations", { projectId: ctx.project.id });
    const id = created.body.conversation.id as string;
    const elsewhere = await post(ctx.port, "/api/conversations", { projectId: other.id });

    const missing = await post(ctx.port, "/api/conversations", { projectId: "没有" });
    assert.equal(missing.status, 404);

    const user = await post(ctx.port, `/api/conversations/${id}/messages`, {
      role: "user",
      body: "把首页标题改一下",
    });
    assert.equal(user.status, 201);
    const prompt = await post(ctx.port, `/api/conversations/${id}/messages`, {
      role: "prompt",
      body: "送给 Agent 的提示",
    });
    assert.equal(prompt.status, 201);

    const detail = await get(ctx.port, `/api/conversations/${id}`);
    assert.equal(detail.status, 200);
    const roles = detail.body.messages.map((item) => item.role);
    assert.deepEqual(roles, ["user", "prompt"]);
    assert.equal(detail.body.conversation.title, "把首页标题改一下");

    const listed = await get(ctx.port, `/api/conversations?projectId=${ctx.project.id}`);
    const ids = listed.body.conversations.map((item) => item.id);
    assert.deepEqual(ids, [id]);
    assert.notEqual(ids[0], elsewhere.body.conversation.id);

    const removed = await fetch(`http://127.0.0.1:${ctx.port}/api/conversations/${id}`, { method: "DELETE" });
    assert.equal(removed.status, 204);
    const again = await get(ctx.port, `/api/conversations/${id}`);
    assert.equal(again.status, 404);
    const after = await get(ctx.port, `/api/conversations?projectId=${ctx.project.id}`);
    assert.deepEqual(after.body.conversations, []);
  } finally {
    await ctx.close();
  }
});

async function start() {
  const dir = mkdtempSync(path.join(tmpdir(), "fe-m4-"));
  const store = new Store(dir);
  const project: ProjectRecord = {
    id: "p1",
    name: "示例",
    repoUrl: "https://example.com/repo",
    localPath: dir,
    provider: "github",
    startingRef: "main",
    testCommand: "npm test",
    devCommand: "npm run dev",
    requiredChecks: [],
  };
  store.saveProject(project);
  const started = await startServer(store, 0);
  return {
    port: started.port,
    project,
    store,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        started.server.close((err) => (err ? reject(err) : resolve()));
      });
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function post(port: number, pathname: string, body: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Json };
}

async function get(port: number, pathname: string) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  return { status: response.status, body: (await response.json()) as Json };
}

type Json = {
  conversation: { id: string; title: string };
  conversations: Array<{ id: string }>;
  messages: Array<{ role: string; body: string }>;
  error?: string;
};

/** 读到下一条 data 事件。注释行会跳过。 */
async function nextData(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
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
    if (data) return data;
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
