/** 代码托管。 */
export const PROVIDERS = [
  "github", // GitHub
  "gitlab", // GitLab
  "azure-devops", // Azure DevOps
] as const;
/** 代码托管的取值。 */
export type Provider = (typeof PROVIDERS)[number];

/** 对话状态。 */
export const CONVERSATION_STATUSES = [
  "clarifying", // 澄清中
  "pending_confirm", // 待确认
  "developing", // 开发中
  "awaiting_acceptance", // 待验收
  "awaiting_merge", // 待合并
  "failed", // 未通过
  "revising", // 返工中
] as const;
/** 对话状态的取值。 */
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/** 预览状态。 */
export const PREVIEW_STATUSES = [
  "pending", // 正在启动
  "ready", // 已有可打开的地址
  "missing", // 没有起来或已停止
] as const;
/** 预览状态的取值。 */
export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];

/** 消息角色。页面默认只显示使用人、助手和系统。 */
export const MESSAGE_ROLES = [
  "user", // 使用人
  "assistant", // 助手
  "system", // 系统
  "prompt", // 真正送给 Agent 的提示
] as const;
/** 消息角色的取值。 */
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** 一次 Agent 运行所处的阶段。 */
export const RUN_PHASES = [
  "clarify", // 澄清
  "implement", // 实现
  "revise", // 返工
] as const;
/** 运行阶段的取值。 */
export type RunPhase = (typeof RUN_PHASES)[number];

/** 一次运行的状态。 */
export const RUN_STATUSES = [
  "running", // 进行中
  "finished", // 已结束
  "error", // 失败
  "cancelled", // 已取消
] as const;
/** 运行状态的取值。 */
export type RunStatus = (typeof RUN_STATUSES)[number];

/** 失败类别。 */
export const ERROR_CLASSES = [
  "startup", // 启动失败
  "run", // 运行失败
] as const;
/** 失败类别的取值。 */
export type ErrorClass = (typeof ERROR_CLASSES)[number];

/** 已登记、允许改动的前端仓库。 */
export type ProjectRecord = {
  /** 仓库 id。 */
  id: string;
  /** 名称。 */
  name: string;
  /** 仓库地址。 */
  repoUrl: string;
  /** 本机目录。 */
  localPath: string;
  /** 代码托管。 */
  provider: Provider;
  /** 起始分支。 */
  startingRef: string;
  /** 测试命令。 */
  testCommand: string;
  /** 开发命令。 */
  devCommand: string;
  /** 必须通过的检查名。 */
  requiredChecks: string[];
};

/** 一次改动对话。 */
export type ConversationRecord = {
  /** 对话 id。 */
  id: string;
  /** 所属仓库。 */
  projectId: string;
  /** 对话状态。 */
  status: ConversationStatus;
  /** 变更卡。确认后冻结，实现和返工都按这张卡执行。 */
  changeCard: unknown;
  /** 澄清 Agent 的 id。 */
  clarifyAgentId: string | null;
  /** 实现 Agent 的 id。返工沿用这一个，不另建。 */
  implementAgentId: string | null;
  /** 工作副本目录。 */
  worktreePath: string | null;
  /** 对话专属分支，形如 fe/ 加对话 id 的前 8 位。 */
  branch: string | null;
  /** 预览端口。 */
  previewPort: number | null;
  /** 合并请求地址。 */
  mrUrl: string | null;
  /** 预览地址。 */
  previewUrl: string | null;
  /** 预览状态。 */
  previewStatus: PreviewStatus | null;
  /** 验收报告。 */
  report: unknown;
  /** 创建时间，毫秒时间戳。 */
  createdAt: number;
  /** 最近更新时间，毫秒时间戳。 */
  updatedAt: number;
};

/** 对话里的一条消息。 */
export type MessageRecord = {
  /** 消息 id。 */
  id: string;
  /** 所属对话。 */
  conversationId: string;
  /** 消息角色。 */
  role: MessageRole;
  /** 正文。 */
  body: string;
  /** 图片引用。 */
  images: string[];
  /** 关联的运行。没有时为空。 */
  runId: string | null;
  /** 创建时间，毫秒时间戳。 */
  createdAt: number;
};

/** 一次 Agent 运行。 */
export type RunRecord = {
  /** 运行 id，使用 SDK 返回的 run.id。 */
  id: string;
  /** 所属对话。 */
  conversationId: string;
  /** Agent id。 */
  agentId: string;
  /** 运行阶段。 */
  phase: RunPhase;
  /** 运行状态。 */
  status: RunStatus;
  /** 失败类别。没有失败时为空。 */
  errorClass: ErrorClass | null;
  /** 创建时间，毫秒时间戳。 */
  createdAt: number;
};

/** 判断字符串是否落在给定取值里。 */
export function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return values.some((item) => item === value);
}
