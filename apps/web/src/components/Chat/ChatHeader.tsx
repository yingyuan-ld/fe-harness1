/** 聊天区顶部：仓库名和当前状态。 */
export function ChatHeader({ name, status }: { name: string; status: string }) {
  return (
    <header className="room-head">
      <div>
        <p className="eyebrow">{name}</p>
        <h1>{status}</h1>
      </div>
    </header>
  );
}
