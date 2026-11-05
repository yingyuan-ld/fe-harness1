/**
 * 页面上一条对话的公共约定。
 * 校验变更卡，并判断当前状态能不能发送。
 * 聊天区从这里取，不请求接口，也不负责画界面。
 */

export type ChangeCard = {
  goal: string;
  pages: string;
  acceptance: string[];
  outOfScope: string[];
  summary: string;
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

export function canSend(status: string): boolean {
  return status !== "开发中" && status !== "返工中";
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
