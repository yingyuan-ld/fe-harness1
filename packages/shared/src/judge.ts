import type { AcceptanceReport, ChangeCard, CheckResult } from "./types.js";

export type CheckSnapshot = {
  required: string[];
  results: CheckResult[];
  timedOut: boolean;
};

/**
 * passed：变更卡、报告、提交和仓库检查都已通过。
 * pending：报告和提交已通过，所需检查还在进行。此时不能当成未通过。
 */
export type JudgeResult = {
  passed: boolean;
  pending: boolean;
  reasons: string[];
};

export type JudgeInput = {
  card: ChangeCard;
  report: AcceptanceReport | null;
  testCommand: string;
  hasNewCommits: boolean;
  checks: CheckSnapshot;
};

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function localReasons(input: JudgeInput): string[] {
  const reasons: string[] = [];
  const { report, card, testCommand } = input;
  if (!report) {
    reasons.push("没有验收报告");
  } else {
    if (report.status !== "pass") reasons.push("报告状态不是通过");
    if (report.exitCode !== 0) reasons.push(`测试退出码为 ${report.exitCode}`);
    if (normalize(report.command) !== normalize(testCommand)) {
      reasons.push("测试命令与仓库配置不一致");
    }
    const reported = new Map(
      report.acceptance.map((item) => [normalize(item.text), item.checked]),
    );
    for (const item of card.acceptance) {
      const key = normalize(item);
      if (!reported.has(key)) reasons.push(`未覆盖：${item}`);
      else if (!reported.get(key)) reasons.push(`未勾选：${item}`);
    }
    for (const item of report.acceptance) {
      if (item.checked) continue;
      const already = reasons.some((reason) => reason.endsWith(item.text));
      if (!already) reasons.push(`未勾选：${item.text}`);
    }
  }
  if (!input.hasNewCommits) reasons.push("没有产生提交");
  return reasons;
}

function failed(reasons: string[]): JudgeResult {
  return { passed: false, pending: false, reasons };
}

export function judgeAcceptance(input: JudgeInput): JudgeResult {
  const reasons = localReasons(input);
  if (reasons.length > 0) return failed(reasons);

  const { required, results, timedOut } = input.checks;
  if (required.length === 0) return { passed: true, pending: false, reasons: [] };

  const unmet: string[] = [];
  const waiting: string[] = [];
  for (const name of required) {
    const found = results.find((item) => item.name === name);
    if (!found || found.state === "pending") {
      waiting.push(name);
      continue;
    }
    if (found.state === "failure") unmet.push(`检查失败：${name}`);
  }
  if (unmet.length > 0) return failed(unmet);
  if (waiting.length > 0 && timedOut) {
    return failed(["仓库检查在等待时间内没有全部通过"]);
  }
  if (waiting.length > 0) {
    return {
      passed: false,
      pending: true,
      reasons: waiting.map((name) => `仓库检查尚未完成：${name}`),
    };
  }
  return { passed: true, pending: false, reasons: [] };
}
