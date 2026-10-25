/**
 * 页面上一条对话的公共约定。
 * 定义对话状态和中文标签、聊天区使用的对话结构，并校验变更卡、判断当前状态能不能发送。
 * 聊天区、侧栏和接口类型都从这里取，不请求接口，也不负责画界面。
 */

export const STATUSES = [
  "clarifying",
  "pending_confirm",
  "developing",
  "awaiting_acceptance",
  "awaiting_merge",
  "failed",
  "revising",
] as const;

export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  clarifying: "澄清中",
  pending_confirm: "待确认",
  developing: "开发中",
  awaiting_acceptance: "待验收",
  awaiting_merge: "待合并",
  failed: "未通过",
  revising: "返工中",
};

export type ChangeCard = {
  goal: string;
  pages: string;
  acceptance: string[];
  outOfScope: string[];
  summary: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "prompt";
  body: string;
};

export type Thread = {
  id: string;
  title: string;
  status: Status;
  messages: ChatMessage[];
  changeCard: ChangeCard | null;
  /** 已经确认，不再因为补充而换卡。 */
  cardFrozen: boolean;
  previewUrl: string | null;
  previewStatus: "pending" | "ready" | "missing" | null;
  mrUrl: string | null;
};

/** 变更卡缺字段时不展示，避免把未完成的内容画成卡片。 */
export function readCard(value: unknown): ChangeCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.goal !== "string" || typeof raw.pages !== "string" || typeof raw.summary !== "string") return null;
  if (!isStringList(raw.acceptance) || !isStringList(raw.outOfScope)) return null;
  return {
    goal: raw.goal,
    pages: raw.pages,
    acceptance: raw.acceptance,
    outOfScope: raw.outOfScope,
    summary: raw.summary,
  };
}

export function canSend(status: Status): boolean {
  return status !== "developing" && status !== "revising";
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
