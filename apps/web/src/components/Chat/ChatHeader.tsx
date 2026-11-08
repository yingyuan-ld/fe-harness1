/** 聊天区顶部：仓库名、当前状态，以及这条对话的编号。 */
export function ChatHeader({ name, status, id }: { name: string; status: string; id: string }) {
  return (
    <header className="room-head">
      <div>
        <p className="eyebrow">{name}</p>
        <h1>{status}</h1>
        <p className="room-note">{id}</p>
      </div>
    </header>
  );
}
