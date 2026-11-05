import type { Store } from "../db/index.js";
import { RunCancelled, type AgentAdapter, type AgentRun } from "./agent.js";
import { readStoredCard } from "./card.js";
import { addMessage, ConversationError, type Live, presentConversation } from "./conversations.js";
import { implementPrompt } from "./implement-prompt.js";
import { clearRound, roundOf, setRound, type ActiveRound } from "./rounds.js";
import { createWorktree, WorktreeError } from "./worktree.js";

const LOOKING = "正在看页面";
const CANCELLED = "这轮已取消。";
const FAILED = "这轮没有完成，请再试一次。";

/** 在工作副本里按冻结的变更卡开发。上一轮还在跑时先取消。 */
export async function runImplement(
  store: Store,
  live: Live,
  agent: AgentAdapter,
  dataDir: string,
  conversationId: string,
): Promise<void> {
  await runCoding(store, live, agent, dataDir, conversationId, "implement");
}

/** 用原来的实现 Agent、工作副本和分支返工。 */
export async function runRevise(
  store: Store,
  live: Live,
  agent: AgentAdapter,
  dataDir: string,
  conversationId: string,
  note: string,
): Promise<void> {
  await runCoding(store, live, agent, dataDir, conversationId, "revise", note);
}

/** 取消正在进行的实现或返工。取消后对话回到待确认，可以再发一轮。 */
export async function cancelCoding(store: Store, live: Live, conversationId: string): Promise<void> {
  const current = roundOf(conversationId);
  if (!current || current.cancelled) throw new ConversationError("现在没有可以取消的一轮", 409);
  current.cancelled = true;
  publish(store, live, conversationId);
  await current.run.cancel().catch(() => undefined);
  await current.done;
}

/** 在工作副本里跑一轮实现或返工。结束后运行记录标为完成，对话状态先留在开发中或返工中。 */
async function runCoding(
  store: Store, // 存储库
  live: Live, // 实时更新
  agent: AgentAdapter, // 代理适配器
  dataDir: string, // 数据目录
  conversationId: string, // 对话 ID
  phase: "implement" | "revise", // 阶段: 实现或返工
  note = "", // 备注
): Promise<void> {
  if (roundOf(conversationId)) await cancelCoding(store, live, conversationId);
  const conversation = store.conversation(conversationId);
  if (!conversation) throw new ConversationError("对话不存在", 404);
  const project = store.project(conversation.projectId);
  if (!project) throw new ConversationError("仓库不存在", 404);
  const stored = readStoredCard(conversation.changeCard);
  if (!stored?.frozen) throw new ConversationError("变更卡还没确认", 400);
  if (phase === "revise" && !conversation.implementAgentId) throw new ConversationError("还没有开始开发，不能返工", 400);

  let runId = "";
  let round: ActiveRound | null = null;
  try {
    const place = await createWorktree(store, dataDir, conversationId);
    const session = conversation.implementAgentId
      ? await agent.resume(conversation.implementAgentId, { cwd: place.worktreePath })
      : await agent.create({ cwd: place.worktreePath });
    const status = phase === "revise" ? "返工中" : "开发中";
    store.patchConversation(conversationId, {
      status,
      implementAgentId: session.agentId,
    });
    const prompt = implementPrompt({
      card: stored.card,
      branch: place.branch,
      startingRef: project.startingRef,
      testCommand: project.testCommand,
      note: phase === "revise" ? note : undefined,
    });
    say(store, live, conversationId, prompt, "prompt");
    say(store, live, conversationId, LOOKING);

    const run = await session.send({ prompt });
    runId = run.id;
    store.insertRun({
      id: run.id,
      conversationId,
      agentId: session.agentId,
      phase,
      status: "running",
      errorClass: null,
      createdAt: Date.now(),
    });
    round = track(conversationId, run, runId, phase);
    publish(store, live, conversationId);
    let last = LOOKING;
    for await (const event of run.events) {
      if (round.cancelled) break;
      if (!event.phrase || event.phrase === last) continue;
      last = event.phrase;
      say(store, live, conversationId, event.phrase);
    }
    const result = await run.wait();
    if (round.cancelled) {
      settleCancelled(store, live, conversationId, runId);
      return;
    }
    store.updateRun(runId, { status: "finished" });
    say(store, live, conversationId, proseBeforeReport(result.text), "assistant");
    publish(store, live, conversationId);
  } catch (err) {
    if (round?.cancelled || err instanceof RunCancelled) {
      if (runId) settleCancelled(store, live, conversationId, runId);
      return;
    }
    console.error(err);
    if (runId) store.updateRun(runId, { status: "error", errorClass: "run" });
    const message = err instanceof WorktreeError || err instanceof ConversationError ? err.message : FAILED;
    say(store, live, conversationId, message);
    if (store.conversation(conversationId)) {
      store.patchConversation(conversationId, { status: "待确认" });
    }
    publish(store, live, conversationId);
  } finally {
    if (round) {
      clearRound(conversationId, round);
      round.finish();
      publish(store, live, conversationId);
    }
  }
}

/** 记下这条对话正在跑的一轮，供取消时找到它。finish 在这一轮收尾后放行等待方。 */
function track(conversationId: string, run: AgentRun, runId: string, phase: "implement" | "revise"): ActiveRound {
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = () => resolve();
  });
  const round: ActiveRound = { run, runId, phase, cancelled: false, done, finish };
  setRound(conversationId, round);
  return round;
}

/** 把仍在运行的记录标为已取消，对话回到待确认，并写一条系统消息。 */
function settleCancelled(store: Store, live: Live, conversationId: string, runId: string): void {
  const current = store.run(runId);
  if (!current || current.status !== "running") return;
  store.updateRun(runId, { status: "cancelled" });
  if (store.conversation(conversationId)) store.patchConversation(conversationId, { status: "待确认" });
  say(store, live, conversationId, CANCELLED);
  publish(store, live, conversationId);
}

/** 取验收报告标记之前的说明。没有标记时用整段正文，空正文用一句结束语。 */
function proseBeforeReport(text: string): string {
  const marker = "FE_HARNESS_REPORT";
  const start = text.indexOf(marker);
  const prose = (start >= 0 ? text.slice(0, start) : text).trim();
  return prose || "这轮已经结束。";
}

/** 把当前对话状态推给已打开这条对话的页面。 */
function publish(store: Store, live: Live, conversationId: string): void {
  const conversation = store.conversation(conversationId);
  if (!conversation) return;
  live.publish(conversationId, { type: "conversation", conversation: presentConversation(store, conversation) });
}

/** 写入一条消息并推送给页面。正文为空或对话已删除时不写。 */
function say(
  store: Store,
  live: Live,
  conversationId: string,
  body: string,
  role: "system" | "assistant" | "prompt" = "system",
): void {
  if (!body.trim() || !store.conversation(conversationId)) return;
  addMessage(store, live, conversationId, { role, body });
}
