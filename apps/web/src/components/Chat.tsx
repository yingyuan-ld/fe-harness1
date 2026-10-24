// 对话页面
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { getConversation, sendMessage, type Conversation, type ConversationMessage } from "../api";
import { appStore } from "../store";
import { readCard, STATUS_LABEL, canSend, type Thread } from "../thread";

type Detail = { conversation: Conversation; messages: ConversationMessage[] };

export const Chat = observer(function Chat() {
  const { project, error, activeId, setActiveId, setError, refreshList } = appStore;
  /** 当前打开的对话详情。 */
  const [detail, setDetail] = useState<Detail | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const thread = detail?.conversation.id === activeId ? toThread(detail.conversation, detail.messages) : null;

  useEffect(() => {
    setText("");
    setSending(false);
    if (!activeId) {
      setDetail(null);
      return;
    }
    let closed = false;
    const queued: ConversationMessage[] = [];
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
          return { ...result, messages: mergeMessages(mergeMessages(result.messages, base), extras) };
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
  }, [activeId]);

  if (!project || !thread) return null;
  const current = thread;
  const busy = !canSend(current.status);
  const locked = busy || sending;
  const messages = thread.messages.filter(isVisible);

  /** 把使用人的话写入当前对话。失败时保留输入，原因显示在输入框上方。 */
  function send() {
    const body = text.trim();
    const id = current.id;
    if (!id || sending || !body || locked) return;
    setSending(true);
    appStore.setError("");
    sendMessage(id, body)
      .then((result) => {
        setDetail((current) => {
          if (!current || current.conversation.id !== id) return current;
          return { ...current, messages: mergeMessages(current.messages, [result.message]) };
        });
        appStore.refreshList();
        if (appStore.activeId === id) setText("");
      })
      .catch((err: unknown) => {
        appStore.setError(err instanceof Error ? err.message : "发送失败");
      })
      .finally(() => setSending(false));
  }

  return (
    <>
      <header className="room-head">
        <div>
          <p className="eyebrow">{project.name}</p>
          <h1>{STATUS_LABEL[thread.status]}</h1>
        </div>
      </header>
      <div className="log">
        {messages.map((message) => (
          <article key={message.id} className={`bubble ${message.role}`}>
            <span>{labelFor(message.role)}</span>
            <p>{message.body}</p>
          </article>
        ))}
        {thread.changeCard && thread.status !== "clarifying" ? (
          <article className="card">
            <h2>{thread.changeCard.goal}</h2>
            <p>页面：{thread.changeCard.pages}</p>
            <h3>验收标准</h3>
            <ul>
              {thread.changeCard.acceptance.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <h3>这次不做</h3>
            <ul>
              {thread.changeCard.outOfScope.length === 0 ? (
                <li>（无）</li>
              ) : (
                thread.changeCard.outOfScope.map((item) => <li key={item}>{item}</li>)
              )}
            </ul>
            <p>{thread.changeCard.summary}</p>
          </article>
        ) : null}
      </div>
      <footer className="composer">
        <div className="statusline">
          <strong>{STATUS_LABEL[thread.status]}</strong>
          {thread.previewStatus === "ready" && thread.previewUrl ? (
            <a href={thread.previewUrl} target="_blank" rel="noreferrer">
              打开预览
            </a>
          ) : null}
          {thread.previewStatus === "missing" ? <span>预览没有起来</span> : null}
          {thread.previewStatus === "pending" ? <span>正在启动预览</span> : null}
          {thread.mrUrl ? (
            <a href={thread.mrUrl} target="_blank" rel="noreferrer">
              打开合并请求
            </a>
          ) : null}
        </div>
        {error ? <p className="error">{error}</p> : null}
        <div className="entry">
          <textarea
            value={text}
            placeholder={busy ? "这一轮还在进行" : "描述要改的页面和期望"}
            disabled={locked}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) send();
            }}
          />
          <div className="actions">
            <button type="button" onClick={send} disabled={locked || text.trim() === ""}>
              发送
            </button>
          </div>
        </div>
        <p className="hint">对话会保存。另一个打开的页面也会看到新消息。</p>
      </footer>
    </>
  );
});

function mergeMessages(current: ConversationMessage[], incoming: ConversationMessage[]): ConversationMessage[] {
  const seen = new Set(current.map((item) => item.id));
  const next = [...current];
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    next.push(item);
  }
  return next;
}

function toThread(conversation: Conversation, messages: ConversationMessage[]): Thread {
  return {
    id: conversation.id,
    title: conversation.title,
    status: conversation.status,
    messages,
    changeCard: readCard(conversation.changeCard),
    previewUrl: conversation.previewUrl,
    previewStatus: conversation.previewStatus,
    mrUrl: conversation.mrUrl,
  };
}

function parseLive(raw: string): { type: "message"; message: ConversationMessage } | { type: "deleted" } | null {
  try {
    const data = JSON.parse(raw) as { type?: unknown; message?: ConversationMessage };
    if (!data || typeof data.type !== "string") return null;
    if (data.type === "message" && data.message) return { type: "message", message: data.message };
    if (data.type === "deleted") return { type: "deleted" };
    return null;
  } catch {
    return null;
  }
}

function isVisible(message: Thread["messages"][number]): message is Thread["messages"][number] & { role: "user" | "assistant" | "system" } {
  return message.role !== "prompt";
}

function labelFor(role: "user" | "assistant" | "system"): string {
  if (role === "user") return "使用人";
  if (role === "assistant") return "整理";
  return "系统";
}
