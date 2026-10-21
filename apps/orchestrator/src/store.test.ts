import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { type ProjectRecord, Store } from "../db/index.js";
import { loadConfig } from "./config.js";

const project: ProjectRecord = {
  id: "app",
  name: "示例前端",
  repoUrl: "https://github.com/example/app",
  localPath: "E:/repos/app",
  provider: "github",
  startingRef: "main",
  testCommand: "npm test",
  devCommand: "npm run dev",
  requiredChecks: ["lint"],
};

test("找不到配置文件", () => {
  assert.throws(() => loadConfig(path.join(tmpdir(), "missing-fe-config.json")), /找不到配置文件/);
});

test("预览主机和端口不合法时拒绝", () => {
  const dir = makeDir();
  try {
    assert.throws(() => loadConfig(writeConfig(dir, { previewHost: "bad host" })), /previewHost/);
    assert.throws(() => loadConfig(writeConfig(dir, { port: 0 })), /port/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("缺省端口、模型和预览主机", () => {
  const dir = makeDir();
  try {
    const config = loadConfig(writeConfig(dir, { cursorApiKey: " key ", githubToken: " gh " }));
    assert.equal(config.cursorApiKey, "key");
    assert.equal(config.githubToken, "gh");
    assert.equal(config.gitlabToken, "");
    assert.equal(config.azureDevOpsToken, "");
    assert.equal(config.modelId, "composer-2.5");
    assert.equal(config.port, 8787);
    assert.equal(config.previewHost, "127.0.0.1");
    assert.equal(config.dataDir, path.join(dir, "data"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("仓库写入后再次打开仍能读到", () => {
  const dir = makeDir();
  const dataDir = path.join(dir, "data");
  const first = new Store(dataDir);
  try {
    first.saveProject(project);
    assert.equal(first.project("missing"), undefined);
  } finally {
    first.close();
  }
  const second = new Store(dataDir);
  try {
    assert.equal(second.project("app")?.name, "示例前端");
    assert.equal(existsSync(path.join(dataDir, "harness.sqlite")), true);
  } finally {
    second.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("仓库、对话、消息和运行可以按 id 写回", () => {
  const store = openStore();
  try {
    store.saveProject(project);
    store.saveProject({ ...project, name: "示例前端改名" });
    assert.equal(store.project("app")?.name, "示例前端改名");
    assert.deepEqual(store.project("app")?.requiredChecks, ["lint"]);

    store.insertConversation({ id: "c-admin", projectId: "app", createdAt: 10 });
    store.insertConversation({ id: "c-other", projectId: "app", createdAt: 20 });
    const card = { goal: "把按钮改成绿色", pages: "/settings" };
    const patched = store.patchConversation("c-admin", {
      status: "pending_confirm",
      changeCard: card,
      branch: "fe/cadmin0",
      previewStatus: "ready",
      previewUrl: "http://127.0.0.1:5173",
    });
    assert.equal(patched.status, "pending_confirm");
    assert.deepEqual(store.conversation("c-admin")?.changeCard, card);
    assert.equal(store.conversation("c-admin")?.previewUrl, "http://127.0.0.1:5173");
    assert.deepEqual(
      store.listConversations({ projectId: "app" }).map((item) => item.id),
      ["c-admin", "c-other"],
    );

    store.insertMessage({
      id: "m1",
      conversationId: "c-admin",
      role: "user",
      body: "把提交按钮改成绿色",
      images: ["shot.png"],
      runId: null,
      createdAt: 30,
    });
    store.insertRun({
      id: "r1",
      conversationId: "c-admin",
      agentId: "agent-1",
      phase: "clarify",
      status: "running",
      errorClass: null,
      createdAt: 40,
    });
    assert.equal(store.message("m1")?.images[0], "shot.png");
    assert.equal(store.updateRun("r1", { status: "error", errorClass: "run" }).errorClass, "run");
    assert.equal(store.messages("c-admin").length, 1);
    assert.equal(store.runs("c-admin")[0]?.status, "error");

    store.patchConversation("c-admin", { changeCard: null, previewUrl: null });
    assert.equal(store.conversation("c-admin")?.changeCard, null);
    assert.equal(store.conversation("c-admin")?.previewUrl, null);

    store.deleteConversation("c-admin");
    store.deleteConversation("c-other");
    assert.equal(store.conversation("c-admin"), undefined);
    assert.equal(store.message("m1"), undefined);
    assert.equal(store.run("r1"), undefined);
    store.deleteProject("app");
    assert.equal(store.project("app"), undefined);
  } finally {
    store.close();
    rmSync(storeDir(store), { recursive: true, force: true });
  }
});

const dirs = new WeakMap<Store, string>();

function openStore(): Store {
  const dir = makeDir();
  const store = new Store(path.join(dir, "data"));
  dirs.set(store, dir);
  return store;
}

function storeDir(store: Store): string {
  return dirs.get(store) ?? tmpdir();
}

function makeDir(): string {
  return mkdtempSync(path.join(tmpdir(), "fe-m1-"));
}

function writeConfig(dir: string, patch: Record<string, unknown>): string {
  const file = path.join(dir, "config.json");
  writeFileSync(file, JSON.stringify(patch));
  return file;
}
