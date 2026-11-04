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

export function roundOf(conversationId: string): ActiveRound | undefined {
  return active.get(conversationId);
}

export function setRound(conversationId: string, round: ActiveRound): void {
  active.set(conversationId, round);
}

export function clearRound(conversationId: string, round: ActiveRound): void {
  if (active.get(conversationId) === round) active.delete(conversationId);
}

/** 这一轮还没被取消，页面上应锁住输入并允许取消。 */
export function isRoundRunning(conversationId: string): boolean {
  const round = active.get(conversationId);
  return Boolean(round && !round.cancelled);
}
