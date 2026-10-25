import { observer } from "mobx-react-lite";
import { useState, type Dispatch, type SetStateAction } from "react";
import { getConversation, sendMessage } from "../../api";
import { appStore } from "../../store";
import { canSend, STATUS_LABEL, type Thread } from "../../thread";
import { mergeMessages, type Detail } from "./detail";

/** 输入区：状态、预览、合并请求和发送。 */
export const Composer = observer(function Composer({
  thread,
  setDetail,
}: {
  thread: Thread;
  setDetail: Dispatch<SetStateAction<Detail | null>>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const { error } = appStore;
  const busy = !canSend(thread.status);
  const locked = busy || sending;

  /** 把使用人的话写入当前对话。失败时保留输入，原因显示在输入框上方。 */
  function send() {
    const body = text.trim();
    const id = thread.id;
    if (!id || sending || !body || locked) return;
    setSending(true);
    appStore.setError("");
    sendMessage(id, body)
      .then(() => getConversation(id))
      .then((latest) => {
        setDetail((open) => {
          if (appStore.activeId !== id) return open;
          const messages = open?.conversation.id === id ? mergeMessages(latest.messages, open.messages) : latest.messages;
          return { ...latest, messages };
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
  );
});
