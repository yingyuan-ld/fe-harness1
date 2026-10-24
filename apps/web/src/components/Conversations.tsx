import { observer } from "mobx-react-lite";
import { useEffect } from "react";
import { listConversations } from "../api";
import { appStore } from "../store";
import { STATUS_LABEL } from "../thread";

/** 侧栏里的对话管理：加载、新建、选中和删除。 */
export const Conversations = observer(function Conversations() {
  const { project, conversations, activeId, openThread, selectThread, removeThread, setActiveId, setConversations, setError } = appStore;
  const projectId = project?.id ?? "";

  useEffect(() => {
    setActiveId("");
    if (!projectId) {
      setConversations([]);
      return;
    }
    let closed = false;
    listConversations(projectId)
      .then((result) => {
        if (!closed) setConversations(result.conversations);
      })
      .catch((err: unknown) => {
        if (!closed) setError(err instanceof Error ? err.message : "加载失败");
      });
    return () => {
      closed = true;
    };
  }, [projectId]);

  return (
    <>
      <button type="button" onClick={openThread} disabled={!project}>
        新对话
      </button>
      <ul className="threads">
        {conversations.map((item) => (
          <li key={item.id} className="thread-row">
            <button
              type="button"
              className={item.id === activeId ? "thread active" : "thread"}
              onClick={() => selectThread(item.id)}
            >
              <span>{item.title}</span>
              <small>{STATUS_LABEL[item.status]}</small>
            </button>
            <button type="button" className="ghost thread-delete" onClick={() => removeThread(item.id, item.title)}>
              删除
            </button>
          </li>
        ))}
      </ul>
    </>
  );
});
