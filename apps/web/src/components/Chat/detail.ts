// 负责订阅事件流、合并消息，以及把接口数据整理成页面用的对话。
import type { Dispatch, SetStateAction } from "react";
import { getConversation, type Conversation, type ConversationMessage } from "../../api";
import { readCard, type Thread } from "../../thread";

export type Detail = { conversation: Conversation; messages: ConversationMessage[] };

type LiveHandlers = {
  setDetail: Dispatch<SetStateAction<Detail | null>>;
  setActiveId: (id: string) => void;
  setError: (message: string) => void;
  refreshList: () => void;
};

/** 订阅这条对话的后续变更，并读取已有内容。返回的函数用于取消。 */
export function subscribeConversation(activeId: string, handlers: LiveHandlers): () => void {
  const { setDetail, setActiveId, setError, refreshList } = handlers;
  if (!activeId) {
    setDetail(null);
    return () => undefined;
  }
  let closed = false;
  const queued: ConversationMessage[] = [];
  let queuedConversation: Conversation | null = null;
  const source = new EventSource(`/api/conversations/${encodeURIComponent(activeId)}/events`);
  source.onmessage = (event) => {
    const data = parseLive(event.data);
    if (!data) return;
    if (data.type === "deleted") {
      setDetail(null);
      setActiveId("");
      refreshList();
      return;
    }
    if (data.type === "conversation") {
      setDetail((current) => {
        if (!current || current.conversation.id !== activeId) {
          queuedConversation = data.conversation;
          return current;
        }
        return { ...current, conversation: data.conversation };
      });
      refreshList();
      return;
    }
    if (data.type !== "message") return;
    const message = data.message;
    setDetail((current) => {
      if (!current || current.conversation.id !== activeId) {
        queued.push(message);
        return current;
      }
      return { ...current, messages: mergeMessages(current.messages, [message]) };
    });
    refreshList();
  };
  getConversation(activeId)
    .then((result) => {
      if (closed) return;
      setDetail((current) => {
        const base = current?.conversation.id === activeId ? current.messages : result.messages;
        const extras = queued.splice(0);
        const conversation = queuedConversation?.id === activeId ? queuedConversation : result.conversation;
        queuedConversation = null;
        return { conversation, messages: mergeMessages(mergeMessages(result.messages, base), extras) };
      });
    })
    .catch((err: unknown) => {
      if (closed) return;
      setDetail(null);
      setActiveId("");
      setError(err instanceof Error ? err.message : "加载失败");
    });
  return () => {
    closed = true;
    source.close();
  };
}

/** 按 id 去重后追加消息。同一条从发送和事件流各来一次时只保留一份。 */
export function mergeMessages(current: ConversationMessage[], incoming: ConversationMessage[]): ConversationMessage[] {
  const seen = new Set(current.map((item) => item.id));
  const next = [...current];
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    next.push(item);
  }
  return next;
}

/** 把接口里的对话整理成页面用的结构。变更卡在这里校验一次。 */
export function toThread(conversation: Conversation, messages: ConversationMessage[]): Thread {
  return {
    id: conversation.id,
    title: conversation.title,
    status: conversation.status,
    messages,
    changeCard: readCard(conversation.changeCard),
    cardFrozen: conversation.cardFrozen === true,
    previewUrl: conversation.previewUrl,
    previewStatus: conversation.previewStatus,
    mrUrl: conversation.mrUrl,
  };
}

export function parseLive(
  raw: string,
): { type: "message"; message: ConversationMessage } | { type: "conversation"; conversation: Conversation } | { type: "deleted" } | null {
  try {
    const data = JSON.parse(raw) as { type?: unknown; message?: ConversationMessage; conversation?: Conversation };
    if (!data || typeof data.type !== "string") return null;
    if (data.type === "message" && data.message) return { type: "message", message: data.message };
    if (data.type === "conversation" && data.conversation) return { type: "conversation", conversation: data.conversation };
    if (data.type === "deleted") return { type: "deleted" };
    return null;
  } catch {
    return null;
  }
}
