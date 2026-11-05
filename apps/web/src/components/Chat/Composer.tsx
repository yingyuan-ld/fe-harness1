import { observer } from "mobx-react-lite";
import { useState, type Dispatch, type SetStateAction } from "react";
import { cancelRound, getConversation, sendMessage, type Conversation, type ConversationMessage } from "../../api";
import { appStore } from "../../store";
import { canSend } from "../../thread";
import { mergeMessages } from "./detail";

/** 输入区：状态、预览、合并请求和发送。 */
export const Composer = observer(function Composer({
  conversation,
  setConversation,
  setMessages,
}: {
  conversation: Conversation;
  setConversation: Dispatch<SetStateAction<Conversation | null>>;
  setMessages: Dispatch<SetStateAction<ConversationMessage[]>>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const { error } = appStore;
  const roundBusy = conversation.busy === true || (conversation.busy == null && !canSend(conversation.status));
  const locked = roundBusy || sending || cancelling;

  /** 把使用人的话写入当前对话。失败时保留输入，原因显示在输入框上方。 */
  function send() {
    const body = text.trim();
    const id = conversation.id;
    if (!id || sending || !body || locked) return;
    setSending(true);
    appStore.setError("");
    sendMessage(id, body)
      .then(() => getConversation(id))
      .then((latest) => {
        if (appStore.activeId !== id) return;
        setConversation(latest.conversation);
        setMessages((open) => mergeMessages(latest.messages, open));
        appStore.refreshList();
        if (appStore.activeId === id) setText("");
      })
      .catch((err: unknown) => {
        appStore.setError(err instanceof Error ? err.message : "发送失败");
      })
      .finally(() => setSending(false));
  }

  /** 停掉正在进行的实现或返工。停掉之后可以再发。 */
  function cancel() {
    const id = conversation.id;
    if (!id || cancelling || !conversation.busy) return;
    setCancelling(true);
    appStore.setError("");
    cancelRound(id)
      .then(() => getConversation(id))
      .then((latest) => {
        if (appStore.activeId !== id) return;
        setConversation(latest.conversation);
        setMessages(latest.messages);
        appStore.refreshList();
      })
      .catch((err: unknown) => {
        appStore.setError(err instanceof Error ? err.message : "没能取消");
      })
      .finally(() => setCancelling(false));
  }

  return (
    <footer className="composer">
      <div className="statusline">
        <strong>{conversation.status}</strong>
        {conversation.busy ? (
          <button type="button" onClick={cancel} disabled={cancelling}>
            {cancelling ? "正在取消…" : "取消本轮"}
          </button>
        ) : null}
        {conversation.previewStatus === "ready" && conversation.previewUrl ? (
          <a href={conversation.previewUrl} target="_blank" rel="noreferrer">
            打开预览
          </a>
        ) : null}
        {conversation.previewStatus === "missing" ? <span>预览没有起来</span> : null}
        {conversation.previewStatus === "pending" ? <span>正在启动预览</span> : null}
        {conversation.mrUrl ? (
          <a href={conversation.mrUrl} target="_blank" rel="noreferrer">
            打开合并请求
          </a>
        ) : null}
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div className="entry">
        <textarea
          value={text}
          placeholder={roundBusy ? "这一轮还在进行" : "描述要改的页面和期望"}
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
