import { randomUUID } from "node:crypto";
import { isOneOf, MESSAGE_ROLES, type ConversationRecord, type MessageRecord, type MessageRole, type Store } from "../db/index.js";
import { readStoredCard, type ChangeCard } from "./card.js";

/** 对话接口返回给调用方的错误。status 是 HTTP 状态码。 */
export class ConversationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** 返回给页面的对话。变更卡是解析后的字段，冻结与否单独标出。 */
export type ConversationView = Omit<ConversationRecord, "changeCard"> & {
  changeCard: ChangeCard | null;
  cardFrozen: boolean;
  title: string;
};

export type LiveEvent =
  | { type: "message"; message: MessageRecord }
  | { type: "conversation"; conversation: ConversationView }
  | { type: "deleted"; conversationId: string };

type Listener = (event: LiveEvent) => void;

/** 把一条对话的变更推给当前打开它的页面。只活在这个进程里。 */
export class Live {
  private readonly rooms = new Map<string, Set<Listener>>();

  /** 订阅一条对话。返回的函数用于取消订阅。 */
  subscribe(conversationId: string, listener: Listener): () => void {
    const room = this.rooms.get(conversationId) ?? new Set<Listener>();
    room.add(listener);
    this.rooms.set(conversationId, room);
    return () => {
      room.delete(listener);
      if (room.size === 0) this.rooms.delete(conversationId);
    };
  }

  /** 通知这条对话当前所有打开的页面。 */
  publish(conversationId: string, event: LiveEvent): void {
    for (const listener of this.rooms.get(conversationId) ?? []) {
      try {
        listener(event);
      } catch (err) {
        console.error(err);
      }
    }
  }
}

/** 在已登记的仓库下新建对话。状态为澄清中。 */
export function createConversation(store: Store, body: unknown) {
  const projectId = projectIdOf(body);
  if (!store.project(projectId)) throw new ConversationError("仓库不存在", 404);
  const conversation = store.insertConversation({ id: randomUUID(), projectId });
  return presentConversation(store, conversation);
}

/** 列出对话。传入仓库 id 时只返回该仓库下的。最近更新的在前。 */
export function listConversations(store: Store, projectId?: string) {
  const conversations = store.listConversations(projectId ? { projectId } : {});
  return conversations.map((conversation) => presentConversation(store, conversation));
}

/** 读取一条对话和它的全部消息。提示消息也返回，由页面决定是否显示。 */
export function readConversation(store: Store, id: string) {
  const conversation = store.conversation(id);
  if (!conversation) throw new ConversationError("对话不存在", 404);
  const messages = store.messages(id);
  return { conversation: presentConversation(store, conversation), messages };
}

/** 删除对话及其消息、运行记录，并通知已打开的页面。 */
export function removeConversation(store: Store, live: Live, id: string): void {
  if (!store.conversation(id)) throw new ConversationError("对话不存在", 404);
  store.deleteConversation(id);
  live.publish(id, { type: "deleted", conversationId: id });
}

/** 写入一条消息并推送给已打开这条对话的页面。 */
export function addMessage(store: Store, live: Live, conversationId: string, body: unknown): MessageRecord {
  if (!store.conversation(conversationId)) throw new ConversationError("对话不存在", 404);
  const input = parseMessage(body);
  const message = store.insertMessage({
    id: randomUUID(),
    conversationId,
    role: input.role,
    body: input.body,
    images: input.images,
    runId: null,
    createdAt: nextTime(store, conversationId),
  });
  store.patchConversation(conversationId, {});
  live.publish(conversationId, { type: "message", message });
  return message;
}

/** 给页面的对话形状。变更卡去掉冻结标记，冻结与否用 cardFrozen 表示。 */
export function presentConversation(store: Store, conversation: ConversationRecord): ConversationView {
  const stored = readStoredCard(conversation.changeCard);
  return {
    ...conversation,
    changeCard: stored?.card ?? null,
    cardFrozen: stored?.frozen ?? false,
    title: titleOf(store.messages(conversation.id)),
  };
}

/** 同一条对话里的消息时间严格递增，避免同一毫秒里顺序被 id 打乱。 */
function nextTime(store: Store, conversationId: string): number {
  const latest = store.messages(conversationId).reduce((max, item) => Math.max(max, item.createdAt), 0);
  return Math.max(Date.now(), latest + 1);
}

/** 用第一条使用人消息做标题。还没有使用人消息时叫新对话。 */
function titleOf(messages: MessageRecord[]): string {
  const first = messages.find((item) => item.role === "user" && item.body.trim());
  if (!first) return "新对话";
  const text = first.body.trim().replace(/\s+/g, " ");
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

/** 从请求体取出仓库 id。 */
function projectIdOf(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ConversationError("对话内容必须是对象", 400);
  }
  const projectId = (body as Record<string, unknown>).projectId;
  if (typeof projectId !== "string" || !projectId.trim()) throw new ConversationError("要选择一个仓库", 400);
  return projectId.trim();
}

/** 从请求体取出消息角色、正文和图片引用。 */
function parseMessage(body: unknown): { role: MessageRole; body: string; images: string[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ConversationError("消息内容必须是对象", 400);
  }
  const raw = body as Record<string, unknown>;
  if (typeof raw.role !== "string" || !isOneOf(MESSAGE_ROLES, raw.role)) {
    throw new ConversationError("消息角色只能是 user、assistant、system、prompt", 400);
  }
  if (typeof raw.body !== "string" || !raw.body.trim()) throw new ConversationError("消息不能为空", 400);
  if (raw.images === undefined) return { role: raw.role, body: raw.body.trim(), images: [] };
  if (!Array.isArray(raw.images) || raw.images.some((item) => typeof item !== "string")) {
    throw new ConversationError("图片引用需要是字符串列表", 400);
  }
  return { role: raw.role, body: raw.body.trim(), images: raw.images };
}
