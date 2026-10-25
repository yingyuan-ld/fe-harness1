import type { Thread } from "../../thread";

/** 聊天记录。提示消息不展示。 */
export function MessageList({ messages }: { messages: Thread["messages"] }) {
  return (
    <>
      {messages.filter(isVisible).map((message) => (
        <article key={message.id} className={`bubble ${message.role}`}>
          <span>{labelFor(message.role)}</span>
          <p>{message.body}</p>
        </article>
      ))}
    </>
  );
}

function isVisible(message: Thread["messages"][number]): message is Thread["messages"][number] & { role: "user" | "assistant" | "system" } {
  return message.role !== "prompt";
}

function labelFor(role: "user" | "assistant" | "system"): string {
  if (role === "user") return "使用人";
  if (role === "assistant") return "整理";
  return "系统";
}
