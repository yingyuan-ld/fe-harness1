import { STATUS_LABEL, type Status } from "../../thread";

/** 聊天区顶部：仓库名和当前状态。 */
export function ChatHeader({ name, status }: { name: string; status: Status }) {
  return (
    <header className="room-head">
      <div>
        <p className="eyebrow">{name}</p>
        <h1>{STATUS_LABEL[status]}</h1>
      </div>
    </header>
  );
}
