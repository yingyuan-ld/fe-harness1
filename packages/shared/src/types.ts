export const CONVERSATION_STATUSES = [
  "clarifying",
  "pending_confirm",
  "developing",
  "awaiting_acceptance",
  "awaiting_merge",
  "failed",
  "revising",
] as const;

export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const STATUS_LABEL: Record<ConversationStatus, string> = {
  clarifying: "澄清中",
  pending_confirm: "待确认",
  developing: "开发中",
  awaiting_acceptance: "待验收",
  awaiting_merge: "待合并",
  failed: "未通过",
  revising: "返工中",
};

export type Role = "requester" | "engineer" | "admin";

export type Provider = "github" | "gitlab" | "azure-devops";

export type PreviewStatus = "pending" | "ready" | "missing";

export type RunPhase = "clarify" | "implement" | "revise";

export type RunStatus = "running" | "finished" | "error" | "cancelled";

export type ErrorClass = "startup" | "run";

export type MessageRole = "user" | "assistant" | "system" | "prompt";

export type PublicUser = {
  id: string;
  name: string;
  role: Role;
};

/** 已登记、允许改动的前端仓库。 */
export type Project = {
  id: string;
  name: string;
  repoUrl: string;
  localPath: string;
  provider: Provider;
  startingRef: string;
  testCommand: string;
  devCommand: string;
  requiredChecks: string[];
};

/** 使用人确认后冻结，实现和返工都按这张卡执行。 */
export type ChangeCard = {
  goal: string;
  pages: string;
  acceptance: string[];
  outOfScope: string[];
  summary: string;
};

export type AcceptanceItem = {
  text: string;
  checked: boolean;
};

export type AcceptanceReport = {
  status: "pass" | "fail";
  command: string;
  exitCode: number;
  acceptance: AcceptanceItem[];
  summary: string;
};

export type CheckState = "success" | "failure" | "pending";

export type CheckResult = {
  name: string;
  state: CheckState;
};

/** 一次 Agent 运行。id 使用 SDK 返回的 run.id。 */
export type RunRecord = {
  id: string;
  conversationId: string;
  agentId: string;
  phase: RunPhase;
  status: RunStatus;
  errorClass: ErrorClass | null;
};
