// 在内存里记下每条对话当前正在跑的那一轮实现
import type { AgentRun } from "./agent.js";

/** 一条对话上正在进行的实现或返工。进程内有效，取消时靠它找到这一轮。 */
export type ActiveRound = {
  run: AgentRun;
  runId: string;
  phase: "implement" | "revise";
  cancelled: boolean;
  done: Promise<void>;
  finish: () => void;
};

const active = new Map<string, ActiveRound>();

/** 取出这条对话正在进行的一轮。没有时返回 undefined。 */
export function roundOf(conversationId: string): ActiveRound | undefined {
  return active.get(conversationId);
}

/** 把这一轮登记到这条对话上。同一条对话只保留最新一轮。 */
export function setRound(conversationId: string, round: ActiveRound): void {
  active.set(conversationId, round);
}

/** 这一轮仍是当前轮时把它清掉。后来的一轮不会被旧轮清掉。 */
export function clearRound(conversationId: string, round: ActiveRound): void {
  if (active.get(conversationId) === round) active.delete(conversationId);
}

/** 这一轮还没被取消，页面上应锁住输入并允许取消。 */
export function isRoundRunning(conversationId: string): boolean {
  const round = active.get(conversationId);
  return Boolean(round && !round.cancelled);
}
