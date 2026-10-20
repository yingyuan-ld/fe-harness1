const PHASE_PHRASE = {
  clarify: "正在整理需求",
  checks: "正在查看仓库检查",
} as const;

export type ProgressPhase = keyof typeof PHASE_PHRASE;

export function phasePhrase(phase: ProgressPhase): string {
  return PHASE_PHRASE[phase];
}

/** 把工具调用收成使用人能看的短句。返回值不含命令原文。 */
export function progressPhrase(
  toolName: string,
  args: unknown,
  testCommand: string,
): string {
  const blob = JSON.stringify(args ?? "").toLowerCase();
  const command = testCommand.trim().toLowerCase();
  if (command && blob.includes(command)) return "正在跑测试";
  const name = toolName.toLowerCase();
  if (/edit|write|strreplace|apply_patch|patch|delete/.test(name)) {
    return "正在改代码";
  }
  if (/read|grep|glob|search|list|semsearch|\bls\b|ripgrep/.test(name)) {
    return "正在看页面";
  }
  return "正在看页面";
}
