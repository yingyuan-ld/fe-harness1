// 对话页面
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { appStore } from "../../store";
import { ChangeCardPanel } from "./ChangeCardPanel";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
import { subscribeConversation, toThread, type Detail } from "./detail";
import { MessageList } from "./MessageList";

export const Chat = observer(function Chat() {
  const { project, activeId, setActiveId, setError, refreshList } = appStore;
  /** 当前打开的对话详情。 */
  const [detail, setDetail] = useState<Detail | null>(null);
  const thread = detail?.conversation.id === activeId ? toThread(detail.conversation, detail.messages) : null;

  useEffect(() => subscribeConversation(activeId, { setDetail, setActiveId, setError, refreshList }), [activeId]);

  if (!project || !thread) return null;
  const current = thread;

  return (
    <>
      <ChatHeader name={project.name} status={current.status} />
      <div className="log">
        <MessageList messages={current.messages} />
        <ChangeCardPanel thread={current} setDetail={setDetail} />
      </div>
      <Composer thread={current} setDetail={setDetail} />
    </>
  );
});
