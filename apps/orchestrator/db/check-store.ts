import assert from "node:assert/strict";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { type ProjectRecord, Store } from "./index.js";

const project: ProjectRecord = {
  id: "m1-check",
  name: "检查用仓库",
  repoUrl: "https://github.com/example/demo",
  localPath: "data/m1-check-repo",
  provider: "github",
  startingRef: "main",
  testCommand: "npm test",
  devCommand: "npm run dev",
  requiredChecks: ["lint"],
};

const conversationId = "m1-check";
const messageId = "m1-check-message";
const runId = "m1-check-run";

const config = loadConfig();
const store = new Store(config.dataDir);
try {
  store.saveProject(project);
  store.deleteConversation(conversationId);
  store.insertConversation({
    id: conversationId,
    projectId: project.id,
  });
  const card = { goal: "把按钮改成绿色" };
  store.patchConversation(conversationId, { status: "pending_confirm", changeCard: card });
  store.insertMessage({
    id: messageId,
    conversationId,
    role: "user",
    body: "把提交按钮改成绿色",
    images: [],
    runId: null,
    createdAt: Date.now(),
  });
  store.insertRun({
    id: runId,
    conversationId,
    agentId: "agent-check",
    phase: "clarify",
    status: "finished",
    errorClass: null,
    createdAt: Date.now(),
  });

  const savedProject = store.project(project.id);
  const savedConversation = store.conversation(conversationId);
  const savedMessage = store.message(messageId);
  const savedRun = store.run(runId);
  const visible = store.listConversations({ projectId: project.id }).map((item) => item.id);

  assert.deepEqual(savedProject, project);
  assert.equal(savedConversation?.status, "pending_confirm");
  assert.deepEqual(savedConversation?.changeCard, card);
  assert.equal(savedMessage?.body, "把提交按钮改成绿色");
  assert.equal(savedRun?.phase, "clarify");
  assert.equal(visible.includes(conversationId), true);

  store.deleteConversation(conversationId);
  store.deleteProject(project.id);

  console.log(
    JSON.stringify(
      {
        db: path.join(config.dataDir, "harness.sqlite"),
        readBack: {
          project: savedProject?.name,
          status: savedConversation?.status,
          changeCard: savedConversation?.changeCard,
          message: savedMessage?.body,
          run: savedRun?.id,
        },
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}
