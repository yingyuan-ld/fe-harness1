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
  role: "user" | "assistant" | "system";
  body: string;
};

/** 页面上的一条对话。登记服务还没有对话接口，所以先记在浏览器里。 */
export type Thread = {
  id: string;
  projectId: string;
  title: string;
  status: Status;
  messages: ChatMessage[];
  changeCard: ChangeCard | null;
  progress: string;
  previewUrl: string | null;
  previewStatus: "pending" | "ready" | "missing" | null;
  mrUrl: string | null;
  unmet: string[];
};

export function createThread(projectId: string): Thread {
  return {
    id: crypto.randomUUID(),
    projectId,
    title: "新对话",
    status: "clarifying",
    messages: [],
    changeCard: null,
    progress: "",
    previewUrl: null,
    previewStatus: null,
    mrUrl: null,
    unmet: [],
  };
}

/** 把使用人的话收成一张可确认的变更卡。 */
export function cardFromText(text: string): ChangeCard {
  const summary = text.trim().replace(/\s+/g, " ");
  const goal = summary.length > 42 ? `${summary.slice(0, 42)}…` : summary;
  return {
    goal: goal || "这次改动",
    pages: "你刚说的页面",
    acceptance: ["页面上能看到这次改动"],
    outOfScope: ["这次不改其他页面"],
    summary,
  };
}

export function canCancel(status: Status): boolean {
  return status === "developing" || status === "revising";
}

export function canSend(status: Status): boolean {
  return status !== "developing" && status !== "revising";
}
