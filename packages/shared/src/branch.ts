/** 对话专属分支：`fe/` 加对话 id 的前 8 位。 */
export function branchName(conversationId: string): string {
  const id = conversationId.trim();
  const prefix = id.slice(0, 8);
  if (!/^[A-Za-z0-9]{8}$/.test(prefix)) {
    throw new Error("对话 id 的前 8 位需要是字母或数字");
  }
  return `fe/${prefix}`;
}
