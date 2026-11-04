/** 把工具事件收成使用人能看懂的短句。 */
export function progressPhrase(toolName: string, detail: string, testCommand: string): string {
  const command = testCommand.trim().toLowerCase();
  if (command && `${toolName}\n${detail}`.toLowerCase().includes(command)) return "正在跑测试";
  if (/edit|write|strreplace|apply_patch|patch|delete/.test(toolName.toLowerCase())) return "正在改代码";
  return "正在看页面";
}
