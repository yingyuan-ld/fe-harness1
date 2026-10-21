import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./open.js";
import {
  CONVERSATION_STATUSES,
  ERROR_CLASSES,
  isOneOf,
  MESSAGE_ROLES,
  PREVIEW_STATUSES,
  PROVIDERS,
  RUN_PHASES,
  RUN_STATUSES,
  type ConversationRecord,
  type ConversationStatus,
  type ErrorClass,
  type MessageRecord,
  type MessageRole,
  type PreviewStatus,
  type ProjectRecord,
  type Provider,
  type RunPhase,
  type RunRecord,
  type RunStatus,
} from "./records.js";

type ConversationPatch = Partial<
  Omit<ConversationRecord, "id" | "projectId" | "createdAt" | "updatedAt">
>;

type ConversationSql = {
  id: string;
  project_id: string;
  status: string;
  change_card: string | null;
  clarify_agent_id: string | null;
  implement_agent_id: string | null;
  worktree_path: string | null;
  branch: string | null;
  preview_port: number | null;
  mr_url: string | null;
  preview_url: string | null;
  preview_status: string | null;
  report: string | null;
  created_at: number;
  updated_at: number;
};

export class Store {
  private readonly db: DatabaseSync;

  /** 打开 dataDir 下的数据库。目录和表不存在时由 openDatabase 建好。 */
  constructor(dataDir: string) {
    this.db = openDatabase(dataDir);
  }

  /** 关闭数据库连接。 */
  close(): void {
    this.db.close();
  }

  /** 按 id 写入仓库。已有同一 id 时覆盖。 */
  saveProject(project: ProjectRecord): void {
    requireText(project.id, "仓库 id");
    requireText(project.name, "仓库名称");
    requireText(project.repoUrl, "仓库地址");
    requireText(project.localPath, "本机目录");
    requireText(project.startingRef, "起始分支");
    if (!isOneOf(PROVIDERS, project.provider)) {
      throw new Error("代码托管只能是 github、gitlab、azure-devops");
    }
    if (!Array.isArray(project.requiredChecks) || project.requiredChecks.some((item) => typeof item !== "string")) {
      throw new Error("必须通过的检查需要是字符串列表");
    }
    this.db
      .prepare(
        `INSERT INTO projects (
           id, name, repo_url, local_path, provider, starting_ref, test_command, dev_command, required_checks
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           repo_url = excluded.repo_url,
           local_path = excluded.local_path,
           provider = excluded.provider,
           starting_ref = excluded.starting_ref,
           test_command = excluded.test_command,
           dev_command = excluded.dev_command,
           required_checks = excluded.required_checks`,
      )
      .run(
        project.id,
        project.name,
        project.repoUrl,
        project.localPath,
        project.provider,
        project.startingRef,
        project.testCommand,
        project.devCommand,
        JSON.stringify(project.requiredChecks),
      );
  }

  /** 按 id 读取仓库。没有时返回 undefined。 */
  project(id: string): ProjectRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, name, repo_url, local_path, provider, starting_ref, test_command, dev_command, required_checks
         FROM projects WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          name: string;
          repo_url: string;
          local_path: string;
          provider: string;
          starting_ref: string;
          test_command: string;
          dev_command: string;
          required_checks: string;
        }
      | undefined;
    if (!row) return undefined;
    if (!isOneOf(PROVIDERS, row.provider)) throw new Error("代码托管无法识别");
    return {
      id: row.id,
      name: row.name,
      repoUrl: row.repo_url,
      localPath: row.local_path,
      provider: row.provider,
      startingRef: row.starting_ref,
      testCommand: row.test_command,
      devCommand: row.dev_command,
      requiredChecks: JSON.parse(row.required_checks) as string[],
    };
  }

  /** 列出全部仓库，按名称、id 排序。 */
  listProjects(): ProjectRecord[] {
    const rows = this.db.prepare("SELECT id FROM projects ORDER BY name, id").all() as Array<{ id: string }>;
    return rows.map((row) => this.project(row.id)).filter((item): item is ProjectRecord => item !== undefined);
  }

  /** 按 id 删除仓库。 */
  deleteProject(id: string): void {
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }

  /** 新建对话。状态缺省为澄清中。 */
  insertConversation(input: {
    id: string;
    projectId: string;
    status?: ConversationStatus;
    createdAt?: number;
  }): ConversationRecord {
    requireText(input.id, "对话 id");
    const status = input.status ?? "clarifying";
    if (!isOneOf(CONVERSATION_STATUSES, status)) throw new Error("对话状态无法识别");
    const now = input.createdAt ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO conversations (
           id, project_id, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.projectId, status, now, now);
    return this.requireConversation(input.id);
  }

  /** 按 id 读取对话。没有时返回 undefined。 */
  conversation(id: string): ConversationRecord | undefined {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as ConversationSql | undefined;
    return row ? mapConversation(row) : undefined;
  }

  /** 列出对话。可按所属仓库过滤，最近更新的在前。 */
  listConversations(filter: { projectId?: string } = {}): ConversationRecord[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter.projectId) {
      clauses.push("project_id = ?");
      params.push(filter.projectId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM conversations ${where} ORDER BY updated_at DESC, id`)
      .all(...params) as ConversationSql[];
    return rows.map(mapConversation);
  }

  /** 局部更新对话并刷新更新时间。id 和所属仓库保持不变。 */
  patchConversation(id: string, patch: ConversationPatch): ConversationRecord {
    const current = this.requireConversation(id);
    const next: ConversationRecord = { ...current, ...patch, id: current.id, updatedAt: Date.now() };
    if (!isOneOf(CONVERSATION_STATUSES, next.status)) throw new Error("对话状态无法识别");
    if (next.previewStatus !== null && !isOneOf(PREVIEW_STATUSES, next.previewStatus)) {
      throw new Error("预览状态无法识别");
    }
    this.db
      .prepare(
        `UPDATE conversations SET
           status = ?, change_card = ?, clarify_agent_id = ?, implement_agent_id = ?,
           worktree_path = ?, branch = ?, preview_port = ?, mr_url = ?, preview_url = ?,
           preview_status = ?, report = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.status,
        json(next.changeCard),
        next.clarifyAgentId,
        next.implementAgentId,
        next.worktreePath,
        next.branch,
        next.previewPort,
        next.mrUrl,
        next.previewUrl,
        next.previewStatus,
        json(next.report),
        next.updatedAt,
        id,
      );
    return this.requireConversation(id);
  }

  /** 按 id 删除对话。它的消息和运行记录一并删除。 */
  deleteConversation(id: string): void {
    this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  }

  /** 写入一条消息。 */
  insertMessage(message: MessageRecord): MessageRecord {
    requireText(message.id, "消息 id");
    requireText(message.conversationId, "对话 id");
    if (!isOneOf(MESSAGE_ROLES, message.role)) throw new Error("消息角色无法识别");
    if (!Array.isArray(message.images) || message.images.some((item) => typeof item !== "string")) {
      throw new Error("图片引用需要是字符串列表");
    }
    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, body, images, run_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.conversationId,
        message.role,
        message.body,
        JSON.stringify(message.images),
        message.runId,
        message.createdAt,
      );
    return this.requireMessage(message.id);
  }

  /** 按 id 读取消息。没有时返回 undefined。 */
  message(id: string): MessageRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, conversation_id, role, body, images, run_id, created_at
         FROM messages WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          conversation_id: string;
          role: string;
          body: string;
          images: string;
          run_id: string | null;
          created_at: number;
        }
      | undefined;
    if (!row) return undefined;
    if (!isOneOf(MESSAGE_ROLES, row.role)) throw new Error("消息角色无法识别");
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      body: row.body,
      images: JSON.parse(row.images) as string[],
      runId: row.run_id,
      createdAt: row.created_at,
    };
  }

  /** 列出某条对话的消息，按创建时间排序。 */
  messages(conversationId: string): MessageRecord[] {
    const rows = this.db
      .prepare("SELECT id FROM messages WHERE conversation_id = ? ORDER BY created_at, id")
      .all(conversationId) as Array<{ id: string }>;
    return rows.map((row) => this.message(row.id)).filter((item): item is MessageRecord => item !== undefined);
  }

  /** 写入一次 Agent 运行。 */
  insertRun(run: RunRecord): RunRecord {
    requireText(run.id, "运行 id");
    requireText(run.conversationId, "对话 id");
    requireText(run.agentId, "Agent id");
    if (!isOneOf(RUN_PHASES, run.phase)) throw new Error("运行阶段无法识别");
    if (!isOneOf(RUN_STATUSES, run.status)) throw new Error("运行状态无法识别");
    if (run.errorClass !== null && !isOneOf(ERROR_CLASSES, run.errorClass)) {
      throw new Error("失败类别无法识别");
    }
    this.db
      .prepare(
        `INSERT INTO runs (id, conversation_id, agent_id, phase, status, error_class, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(run.id, run.conversationId, run.agentId, run.phase, run.status, run.errorClass, run.createdAt);
    return this.requireRun(run.id);
  }

  /** 按 id 读取运行记录。没有时返回 undefined。 */
  run(id: string): RunRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, conversation_id, agent_id, phase, status, error_class, created_at
         FROM runs WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          conversation_id: string;
          agent_id: string;
          phase: string;
          status: string;
          error_class: string | null;
          created_at: number;
        }
      | undefined;
    if (!row) return undefined;
    if (!isOneOf(RUN_PHASES, row.phase)) throw new Error("运行阶段无法识别");
    if (!isOneOf(RUN_STATUSES, row.status)) throw new Error("运行状态无法识别");
    if (row.error_class !== null && !isOneOf(ERROR_CLASSES, row.error_class)) {
      throw new Error("失败类别无法识别");
    }
    return {
      id: row.id,
      conversationId: row.conversation_id,
      agentId: row.agent_id,
      phase: row.phase,
      status: row.status,
      errorClass: row.error_class,
      createdAt: row.created_at,
    };
  }

  /** 列出某条对话的运行记录，按创建时间排序。 */
  runs(conversationId: string): RunRecord[] {
    const rows = this.db
      .prepare("SELECT id FROM runs WHERE conversation_id = ? ORDER BY created_at, id")
      .all(conversationId) as Array<{ id: string }>;
    return rows.map((row) => this.run(row.id)).filter((item): item is RunRecord => item !== undefined);
  }

  /** 更新运行的状态和失败类别。 */
  updateRun(id: string, patch: { status?: RunStatus; errorClass?: ErrorClass | null }): RunRecord {
    const current = this.requireRun(id);
    const status = patch.status ?? current.status;
    const errorClass = patch.errorClass === undefined ? current.errorClass : patch.errorClass;
    if (!isOneOf(RUN_STATUSES, status)) throw new Error("运行状态无法识别");
    if (errorClass !== null && !isOneOf(ERROR_CLASSES, errorClass)) throw new Error("失败类别无法识别");
    this.db.prepare("UPDATE runs SET status = ?, error_class = ? WHERE id = ?").run(status, errorClass, id);
    return this.requireRun(id);
  }

  /** 读取对话。不存在时抛错。 */
  private requireConversation(id: string): ConversationRecord {
    const row = this.conversation(id);
    if (!row) throw new Error(`找不到对话 ${id}`);
    return row;
  }

  /** 读取消息。不存在时抛错。 */
  private requireMessage(id: string): MessageRecord {
    const row = this.message(id);
    if (!row) throw new Error(`找不到消息 ${id}`);
    return row;
  }

  /** 读取运行记录。不存在时抛错。 */
  private requireRun(id: string): RunRecord {
    const row = this.run(id);
    if (!row) throw new Error(`找不到运行记录 ${id}`);
    return row;
  }
}

/** 把数据库行转成对话记录。 */
function mapConversation(row: ConversationSql): ConversationRecord {
  if (!isOneOf(CONVERSATION_STATUSES, row.status)) throw new Error("对话状态无法识别");
  if (row.preview_status !== null && !isOneOf(PREVIEW_STATUSES, row.preview_status)) {
    throw new Error("预览状态无法识别");
  }
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    changeCard: parseJson(row.change_card),
    clarifyAgentId: row.clarify_agent_id,
    implementAgentId: row.implement_agent_id,
    worktreePath: row.worktree_path,
    branch: row.branch,
    previewPort: row.preview_port,
    mrUrl: row.mr_url,
    previewUrl: row.preview_url,
    previewStatus: row.preview_status,
    report: parseJson(row.report),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 把库存的 JSON 文本还原成值。空则返回 null。 */
function parseJson(value: string | null): unknown {
  if (value === null) return null;
  return JSON.parse(value);
}

/** 把值收成 JSON 文本。空则存 null。 */
function json(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

/** 要求文本去掉空白后不为空。 */
function requireText(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label}不能为空`);
}
