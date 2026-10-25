// 负责订阅事件流和合并消息。
import type { Dispatch, SetStateAction } from "react";
import { getConversation, type Conversation, type ConversationMessage } from "../../api";

type LiveHandlers = {
  setConversation: Dispatch<SetStateAction<Conversation | null>>;
  setMessages: Dispatch<SetStateAction<ConversationMessage[]>>;
  setActiveId: (id: string) => void;
  setError: (message: string) => void;
  refreshList: () => void;
};

/** 订阅这条对话的后续变更，并读取已有内容。返回的函数用于取消。 */
export function subscribeConversation(activeId: string, handlers: LiveHandlers): () => void {
  const { setConversation, setMessages, setActiveId, setError, refreshList } = handlers;
  if (!activeId) {
    setConversation(null);
    setMessages([]);
    return () => undefined;
  }
  let closed = false;
  let opened = false;
  const queued: ConversationMessage[] = [];
  let queuedConversation: Conversation | null = null;
  const source = new EventSource(`/api/conversations/${encodeURIComponent(activeId)}/events`);
  source.onmessage = (event) => {
    const data = parseLive(event.data);
    if (!data) return;
    if (data.type === "deleted") {
      setConversation(null);
      setMessages([]);
      setActiveId("");
      refreshList();
      return;
    }
    if (data.type === "conversation") {
      setConversation((current) => {
        if (!opened || !current || current.id !== activeId) {
          queuedConversation = data.conversation;
          return current;
        }
        return data.conversation;
      });
      refreshList();
      return;
    }
    if (data.type !== "message") return;
    const message = data.message;
    if (!opened) {
      queued.push(message);
      refreshList();
      return;
    }
    setMessages((current) => mergeMessages(current, [message]));
    refreshList();
  };
  getConversation(activeId)
    .then((result) => {
      if (closed) return;
      opened = true;
      const conversation = queuedConversation?.id === activeId ? queuedConversation : result.conversation;
      queuedConversation = null;
      const extras = queued.splice(0);
      setConversation(conversation);
      setMessages((current) => mergeMessages(mergeMessages(result.messages, current), extras));
    })
    .catch((err: unknown) => {
      if (closed) return;
      setConversation(null);
      setMessages([]);
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
