import { useState, type Dispatch, type SetStateAction } from "react";
import { confirmConversation, type Conversation } from "../../api";
import { appStore } from "../../store";
import { readCard } from "../../thread";

/** 变更卡。待确认且未冻结时可以点「按这个开发」。 */
export function ChangeCardPanel({
  conversation,
  setConversation,
}: {
  conversation: Conversation;
  setConversation: Dispatch<SetStateAction<Conversation | null>>;
}) {
  const [confirming, setConfirming] = useState(false);
  const card = readCard(conversation.changeCard);

  /** 冻结当前变更卡。实现还没开始，状态先停在待确认。 */
  function confirm() {
    const id = conversation.id;
    if (!id || confirming || conversation.cardFrozen) return;
    setConfirming(true);
    appStore.setError("");
    confirmConversation(id)
      .then((result) => {
        setConversation((open) => (open && open.id === id ? result.conversation : open));
        appStore.refreshList();
      })
      .catch((err: unknown) => {
        appStore.setError(err instanceof Error ? err.message : "没能确认");
      })
      .finally(() => setConfirming(false));
  }

  if (!card || conversation.status === "clarifying") return null;
  return (
    <article className="card">
      <h2>{card.goal}</h2>
      <p>页面：{card.pages}</p>
      <h3>验收标准</h3>
      <ul>
        {card.acceptance.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <h3>这次不做</h3>
      <ul>
        {card.outOfScope.length === 0 ? <li>（无）</li> : card.outOfScope.map((item) => <li key={item}>{item}</li>)}
      </ul>
      <p>{card.summary}</p>
      {conversation.cardFrozen ? <p>已确认，后面按这张卡开发。</p> : null}
      {conversation.status === "pending_confirm" && !conversation.cardFrozen ? (
        <div className="actions">
          <button type="button" onClick={confirm} disabled={confirming}>
            {confirming ? "正在确认…" : "按这个开发"}
          </button>
        </div>
      ) : null}
    </article>
  );
}
