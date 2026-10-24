import { useEffect, useRef, useState } from "react";
import { ApiError, listProjects, type Project } from "./api";
import { Chat } from "./components/Chat";
import { Registry } from "./components/Registry";
import { cardFromText, createThread, STATUS_LABEL, type Thread } from "./thread";

export function App() {
  /** 已登记的仓库。 */
  const [projects, setProjects] = useState<Project[]>([]);
  /** 当前选中的仓库 id。 */
  const [projectId, setProjectId] = useState("");
  /** 所有仓库的对话，只存在当前页面里。 */
  const [threads, setThreads] = useState<Thread[]>([]);
  /** 当前打开的对话 id。 */
  const [activeId, setActiveId] = useState("");
  /** 登记窗口：新建、编辑，或关闭。 */
  const [registry, setRegistry] = useState<"create" | "edit" | null>(null);
  /** 加载或登记失败时显示的原因。 */
  const [error, setError] = useState("");
  /** 首次拉取仓库是否已经结束。 */
  const [ready, setReady] = useState(false);
  /** 各对话尚未执行的定时器，按对话 id 分组。 */
  const timers = useRef<Record<string, number[]>>({});
  /** 最新的仓库列表。延迟回调里用它，避免读到旧数据。 */
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  /** 拉取已登记仓库。当前选中的还在列表里就保留，否则改选第一个。 */
  async function loadProjects() {
    const result = await listProjects();
    setProjects(result.projects);
    setProjectId((current) =>
      current && result.projects.some((item) => item.id === current) ? current : (result.projects[0]?.id ?? ""),
    );
  }

  useEffect(() => {
    loadProjects()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "加载失败"))
      .finally(() => setReady(true));
    return () => {
      for (const handles of Object.values(timers.current)) {
        for (const handle of handles) window.clearTimeout(handle);
      }
    };
  }, []);

  /** 当前选中的仓库。没有选中时为空。 */
  const project = projects.find((item) => item.id === projectId) ?? null;
  /** 当前仓库下的对话。 */
  const visibleThreads = threads.filter((item) => item.projectId === projectId);
  /** 当前打开的对话。没有打开时为空。 */
  const active = visibleThreads.find((item) => item.id === activeId) ?? null;

  /** 切换仓库，并收起当前对话。 */
  function selectProject(id: string) {
    setProjectId(id);
    setActiveId("");
  }

  /** 在当前仓库下新建一条对话并打开。 */
  function openThread() {
    if (!projectId) return;
    const thread = createThread(projectId);
    setThreads((list) => [thread, ...list]);
    setActiveId(thread.id);
  }

  /** 确认后删除这条页面内的对话，并清掉它的定时器。 */
  function removeThread(id: string, title: string) {
    if (!window.confirm(`删除「${title}」？这条对话只在当前页面里。`)) return;
    clearTimers(id);
    setThreads((list) => list.filter((item) => item.id !== id));
    if (activeId === id) setActiveId("");
  }

  /** 按 id 局部更新一条对话。 */
  function patchThread(id: string, patch: Partial<Thread>) {
    setThreads((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  /** 取消某条对话尚未执行的定时更新。 */
  function clearTimers(id: string) {
    for (const handle of timers.current[id] ?? []) window.clearTimeout(handle);
    timers.current[id] = [];
  }

  /** 延迟更新某条对话，并记下定时器，删除或取消时能清掉。 */
  function later(id: string, ms: number, run: () => void) {
    const handle = window.setTimeout(run, ms);
    timers.current[id] = [...(timers.current[id] ?? []), handle];
  }

  /** 把使用人的话记进当前对话。开发中和返工中不接收。待验收、未通过或待合并时进入返工，否则整理出变更卡。 */
  function send(text: string) {
    if (!active) return;
    const id = active.id;
    const summary = text.trim();
    if (!summary) return;
    if (active.status === "developing" || active.status === "revising") return;
    const userMessage = { id: crypto.randomUUID(), role: "user" as const, body: summary };
    if (active.status === "awaiting_merge" || active.status === "failed" || active.status === "awaiting_acceptance") {
      clearTimers(id);
      setThreads((list) =>
        list.map((item) =>
          item.id === id
            ? { ...item, status: "revising", progress: "正在改代码", messages: [...item.messages, userMessage] }
            : item,
        ),
      );
      later(id, 900, () =>
        patchThread(id, { status: "awaiting_merge", progress: "可以打开合并请求" }),
      );
      return;
    }
    const card = cardFromText(summary);
    const title = summary.length > 24 ? `${summary.slice(0, 24)}…` : summary;
    setThreads((list) =>
      list.map((item) => {
        if (item.id !== id) return item;
        const named = item.messages.some((message) => message.role === "user");
        return {
          ...item,
          title: named ? item.title : title,
          status: "pending_confirm",
          changeCard: card,
          progress: "",
          unmet: [],
          messages: [
            ...item.messages,
            userMessage,
            { id: crypto.randomUUID(), role: "assistant", body: "整理好了，请看变更卡。没问题就按这个开发。" },
          ],
        };
      }),
    );
  }

  /** 按变更卡演示开发：进度从看页面、改代码、跑测试走到可以打开合并请求。 */
  function confirm() {
    if (!active || active.status !== "pending_confirm") return;
    const id = active.id;
    clearTimers(id);
    patchThread(id, {
      status: "developing",
      progress: "正在看页面",
      previewStatus: "pending",
      previewUrl: null,
      mrUrl: null,
      unmet: [],
    });
    later(id, 700, () => patchThread(id, { progress: "正在改代码" }));
    later(id, 1400, () =>
      patchThread(id, {
        progress: "正在跑测试",
        previewStatus: "ready",
        previewUrl: "http://127.0.0.1:5173",
      }),
    );
    later(id, 2200, () => {
      const repo = projectsRef.current.find((item) => item.id === active.projectId);
      patchThread(id, {
        status: "awaiting_merge",
        progress: "可以打开合并请求",
        mrUrl: repo?.repoUrl.startsWith("http") ? repo.repoUrl : null,
      });
    });
  }

  /** 取消本轮。已有变更卡则回到待确认，否则回到澄清中。 */
  function cancel() {
    if (!active) return;
    const id = active.id;
    clearTimers(id);
    setThreads((list) =>
      list.map((item) =>
        item.id === id
          ? {
              ...item,
              status: item.changeCard ? "pending_confirm" : "clarifying",
              progress: "",
              previewStatus: null,
              previewUrl: null,
              messages: [...item.messages, { id: crypto.randomUUID(), role: "system", body: "本轮已取消" }],
            }
          : item,
      ),
    );
  }

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <strong>fe-harness</strong>
        </div>
        <button type="button" onClick={() => setRegistry("create")}>
          登记仓库
        </button>
        <ul className="repos">
          {projects.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={item.id === projectId ? "thread active" : "thread"}
                onClick={() => selectProject(item.id)}
              >
                <span>{item.name}</span>
                <small>{item.startingRef}</small>
              </button>
            </li>
          ))}
        </ul>
        {project ? <p className="hint">{project.localPath}</p> : null}
        {project ? (
          <button type="button" className="ghost" onClick={() => setRegistry("edit")}>
            编辑这个仓库
          </button>
        ) : null}
        <button type="button" onClick={openThread} disabled={!project}>
          新对话
        </button>
        <ul className="threads">
          {visibleThreads.map((item) => (
            <li key={item.id} className="thread-row">
              <button
                type="button"
                className={item.id === activeId ? "thread active" : "thread"}
                onClick={() => setActiveId(item.id)}
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
        {error ? <p className="error">{error}</p> : null}
      </aside>
      <section className="room">
        {active && project ? (
          <Chat project={project} thread={active} onSend={send} onConfirm={confirm} onCancel={cancel} />
        ) : (
          <div className="empty">
            <h1>{project ? "选一个仓库，开始说要改什么" : "先登记一个仓库"}</h1>
            <p>
              {project
                ? "点「新对话」，用中文说明要改的页面。变更卡、进度和预览先在这个页面里演示。"
                : "填名称、仓库地址、本机目录和起始分支。目录不是 git 仓库，或分支不存在时，会直接告诉你，并且不会保存。"}
            </p>
            {project ? null : (
              <button type="button" onClick={() => setRegistry("create")}>
                登记仓库
              </button>
            )}
            {!ready ? <p className="hint">正在读取已登记的仓库…</p> : null}
          </div>
        )}
      </section>
      {registry ? (
        <Registry
          project={registry === "edit" ? project : null}
          onClose={() => setRegistry(null)}
          onSaved={(saved) => {
            setRegistry(null);
            setError("");
            setProjectId(saved.id);
            loadProjects().catch((err: unknown) => setError(err instanceof ApiError ? err.message : "加载失败"));
          }}
        />
      ) : null}
    </div>
  );
}
