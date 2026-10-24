import { useState } from "react";
import type { Project } from "../api";
import { STATUS_LABEL, canCancel, canSend, type Thread } from "../thread";

export function Chat({
  project,
  thread,
  onSend,
  onConfirm,
  onCancel,
}: {
  project: Project;
  thread: Thread;
  onSend: (text: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const locked = !canSend(thread.status);

  function send() {
    const body = text.trim();
    if (!body || locked) return;
    onSend(body);
    setText("");
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
        {thread.messages.map((message) => (
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
              {thread.changeCard.outOfScope.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p>{thread.changeCard.summary}</p>
            {thread.status === "pending_confirm" ? (
              <button type="button" onClick={onConfirm}>
                按这个开发
              </button>
            ) : null}
          </article>
        ) : null}
        {thread.status === "failed" && thread.unmet.length > 0 ? (
          <article className="card warn">
            <h2>未通过</h2>
            <ul>
              {thread.unmet.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ) : null}
      </div>
      <footer className="composer">
        <div className="statusline">
          <strong>{thread.progress || STATUS_LABEL[thread.status]}</strong>
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
          {canCancel(thread.status) ? (
            <button type="button" className="ghost" onClick={onCancel}>
              取消本轮
            </button>
          ) : null}
        </div>
        <div className="entry">
          <textarea
            value={text}
            placeholder={locked ? "这一轮还在进行" : "描述要改的页面和期望"}
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
        <p className="hint">仓库登记会保存。对话和进度先在这个页面里演示。</p>
      </footer>
    </>
  );
}

function labelFor(role: ChatRole): string {
  if (role === "user") return "使用人";
  if (role === "assistant") return "整理";
  return "系统";
}

type ChatRole = Thread["messages"][number]["role"];
