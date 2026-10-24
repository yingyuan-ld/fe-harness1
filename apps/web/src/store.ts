import { makeAutoObservable } from "mobx";
import { createConversation, deleteConversation, listConversations, type Conversation, type Project } from "./api";

class AppStore {
  /** 当前选中的仓库。没有选中时为空。 */
  project: Project | null = null;
  /** 错误信息。 */
  error = "";
  /** 当前仓库下的对话。 */
  conversations: Conversation[] = [];
  /** 当前打开的对话 id。没有打开时为空字符串。 */
  activeId = "";

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  selectProject(project: Project | null) {
    this.project = project;
  }

  setError(message: string) {
    this.error = message;
  }

  setConversations(conversations: Conversation[]) {
    this.conversations = conversations;
  }

  setActiveId(id: string) {
    this.activeId = id;
  }

  /** 重新读取当前仓库的对话列表。 */
  refreshList() {
    const current = this.project?.id;
    if (!current) return;
    listConversations(current)
      .then((result) => this.setConversations(result.conversations))
      .catch(() => undefined);
  }

  /** 在当前仓库下新建一条对话并打开。 */
  openThread() {
    const projectId = this.project?.id;
    if (!projectId) return;
    this.setError("");
    createConversation(projectId)
      .then((result) => {
        this.setActiveId(result.conversation.id);
        this.refreshList();
      })
      .catch((err: unknown) => this.setError(err instanceof Error ? err.message : "没能新建对话"));
  }

  /** 打开侧栏里点中的那条对话。 */
  selectThread(id: string) {
    this.setError("");
    this.setActiveId(id);
  }

  /** 删除这条对话在服务里的记录。 */
  removeThread(id: string, title: string) {
    if (!window.confirm(`删除「${title}」？这条对话和里面的消息会去掉。`)) return;
    this.setError("");
    deleteConversation(id)
      .then(() => {
        if (this.activeId === id) this.setActiveId("");
        this.refreshList();
      })
      .catch((err: unknown) => this.setError(err instanceof Error ? err.message : "没能删除"));
  }
}

export const appStore = new AppStore();
