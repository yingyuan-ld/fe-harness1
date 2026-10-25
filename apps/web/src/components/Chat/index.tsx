// 对话页面
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import type { Conversation, ConversationMessage } from "../../api";
import { appStore } from "../../store";
import { ChangeCardPanel } from "./ChangeCardPanel";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
import { subscribeConversation } from "./detail";
import { MessageList } from "./MessageList";

export const Chat = observer(function Chat() {
  const { project, activeId, setActiveId, setError, refreshList } = appStore;
  /** 当前打开的对话。没有打开时为空。 */
  const [conversation, setConversation] = useState<Conversation | null>(null);
  /** 当前对话里的消息。 */
  const [messages, setMessages] = useState<ConversationMessage[]>([]);

  useEffect(
    () => subscribeConversation(activeId, { setConversation, setMessages, setActiveId, setError, refreshList }),
    [activeId],
  );

  if (!project || !conversation || conversation.id !== activeId) return null;

  return (
    <>
      <ChatHeader name={project.name} status={conversation.status} />
      <div className="log">
        <MessageList messages={messages} />
        <ChangeCardPanel conversation={conversation} setConversation={setConversation} />
      </div>
      <Composer conversation={conversation} setConversation={setConversation} setMessages={setMessages} />
    </>
  );
});
