import { type Store } from "../db/index.js";
import type { AgentAdapter } from "./agent.js";
import { isFrozenCard, parseChangeCard, proseBeforeCard, readStoredCard, type ChangeCard } from "./card.js";
import { clarifyPrompt } from "./clarify-prompt.js";
import {
  addMessage,
  ConversationError,
  type Live,
  presentConversation,
  type ConversationView,
} from "./conversations.js";
import { captureRepo, holdUserChanges, restoreHeldChanges, revertClarifyDirt } from "./repo-guard.js";

const ORGANIZING = "正在整理需求";
const NO_CARD = "没有形成变更卡，请换种说法再试一次。";
const DIRTY = "本轮作废，请再发一次。澄清阶段不允许改仓库。";
const NOT_GIT = "本机目录不是 git 仓库，这一轮停在澄清中。";
const HOLD_FAILED = "没能先保住本机目录里原有的改动，这一轮停在澄清中。";
const FAILED = "整理没有完成，请再发一次。";
const STASH_FAILED = "澄清改动已收回，但原本的本地改动没能放回，请在本机目录查看 git stash。";

/** 使用人发来补充后，用澄清 Agent 重新整理变更卡。卡已冻结时什么也不改。 */
export async function runClarify(store: Store, live: Live, agent: AgentAdapter, conversationId: string): Promise<void> {
  const conversation = store.conversation(conversationId);
  if (!conversation) return;
  if (isFrozenCard(conversation.changeCard)) return;
  if (conversation.status !== "clarifying" && conversation.status !== "pending_confirm") return;
  const project = store.project(conversation.projectId);
  if (!project) return;
  if (store.runs(conversationId).some((run) => run.phase === "clarify" && run.status === "running")) return;

  const previous = readStoredCard(conversation.changeCard);
  const before = await captureRepo(project.localPath);
  if (!before) {
    say(store, live, conversationId, NOT_GIT);
    return;
  }
  const held = await holdUserChanges(project.localPath, before.status);
  if (held === "failed") {
    say(store, live, conversationId, HOLD_FAILED);
    return;
  }

  let cleared = false;
  let gotReply = false;
  let runId = "";
  try {
    const session = conversation.clarifyAgentId
      ? await agent.resume(conversation.clarifyAgentId, { cwd: project.localPath })
      : await agent.create({ cwd: project.localPath });
    store.patchConversation(conversationId, {
      status: "clarifying",
      changeCard: null,
      clarifyAgentId: session.agentId,
    });
    cleared = true;
    publish(store, live, conversationId);

    const summary = store
      .messages(conversationId)
      .filter((item) => item.role === "user" && item.body.trim())
      .map((item) => item.body.trim())
      .join("\n");
    const prompt = clarifyPrompt({ repoName: project.name, summary });
    say(store, live, conversationId, prompt, "prompt");

    const baseline = await captureRepo(project.localPath);
    if (!baseline) {
      say(store, live, conversationId, NOT_GIT);
      return;
    }
    const run = await session.send({ prompt });
    runId = run.id;
    store.insertRun({
      id: run.id,
      conversationId,
      agentId: session.agentId,
      phase: "clarify",
      status: "running",
      errorClass: null,
      createdAt: Date.now(),
    });
    say(store, live, conversationId, ORGANIZING);
    const result = await run.wait();
    gotReply = true;
    store.updateRun(run.id, { status: "finished" });

    const blocked = await revertClarifyDirt(project.localPath, baseline, result.branches);
    const prose = proseBeforeCard(result.text);
    if (blocked) {
      store.updateRun(run.id, { status: "error", errorClass: "run" });
      if (prose) say(store, live, conversationId, prose, "assistant");
      say(store, live, conversationId, DIRTY);
      publish(store, live, conversationId);
      return;
    }

    const card = parseChangeCard(result.text);
    if (!card) {
      if (prose) say(store, live, conversationId, prose, "assistant");
      say(store, live, conversationId, NO_CARD);
      publish(store, live, conversationId);
      return;
    }
    if (isFrozenCard(store.conversation(conversationId)?.changeCard)) return;
    say(store, live, conversationId, prose || `已整理：${card.summary}`, "assistant");
    store.patchConversation(conversationId, { status: "pending_confirm", changeCard: card });
    publish(store, live, conversationId);
  } catch (err) {
    console.error(err);
    if (runId) store.updateRun(runId, { status: "error", errorClass: "run" });
    say(store, live, conversationId, FAILED);
    if (cleared && !gotReply) restorePrevious(store, conversationId, previous?.card ?? null);
    publish(store, live, conversationId);
  } finally {
    if (held === "held") {
      const restored = await restoreHeldChanges(project.localPath).catch(() => false);
      if (!restored) say(store, live, conversationId, STASH_FAILED);
    }
  }
}

/** 确认当前变更卡并冻结。之后的澄清回复不能再覆盖它。 */
export function confirmCard(store: Store, live: Live, conversationId: string): ConversationView {
  const conversation = store.conversation(conversationId);
  if (!conversation) throw new ConversationError("对话不存在", 404);
  const stored = readStoredCard(conversation.changeCard);
  if (!stored || conversation.status !== "pending_confirm") {
    throw new ConversationError("还没有可以确认的变更卡", 400);
  }
  if (!stored.frozen) {
    store.patchConversation(conversationId, { changeCard: { ...stored.card, frozen: true } });
  }
  const view = presentConversation(store, store.conversation(conversationId) ?? conversation);
  live.publish(conversationId, { type: "conversation", conversation: view });
  return view;
}

function restorePrevious(store: Store, conversationId: string, card: ChangeCard | null): void {
  if (!card) return;
  if (!store.conversation(conversationId)) return;
  store.patchConversation(conversationId, { status: "pending_confirm", changeCard: card });
}

function publish(store: Store, live: Live, conversationId: string): void {
  const conversation = store.conversation(conversationId);
  if (!conversation) return;
  live.publish(conversationId, { type: "conversation", conversation: presentConversation(store, conversation) });
}

function say(
  store: Store,
  live: Live,
  conversationId: string,
  body: string,
  role: "system" | "assistant" | "prompt" = "system",
): void {
  addMessage(store, live, conversationId, { role, body });
}
