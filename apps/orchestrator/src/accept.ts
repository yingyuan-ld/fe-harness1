// 负责验收判定。
import type { Store } from "../db/index.js";
import type { ChangeCard } from "./card.js";
import { readStoredCard } from "./card.js";
import { hasNewCommits } from "./worktree.js";

const REPORT = "FE_HARNESS_REPORT";

export type AcceptanceItem = {
  text: string;
  checked: boolean;
};

/** 从回复末尾解析出的验收报告。 */
export type AcceptanceReport = {
  status: "pass" | "fail";
  command: string;
  exitCode: number;
  acceptance: AcceptanceItem[];
  summary: string;
};

/** 判定结果。未通过时 unmet 是写给使用人的原因。 */
export type AcceptanceVerdict = {
  passed: boolean;
  unmet: string[];
  report: AcceptanceReport | null;
};

/** 从正文里解析验收报告。没有标记、字段不全或验收条为空时返回 null。正文里的「已完成」不算报告。 */
export function parseAcceptanceReport(text: string): AcceptanceReport | null {
  const block = extractBlock(text, REPORT);
  if (!block) return null;
  const fields = new Map<string, { value: string; items: AcceptanceItem[] }>();
  let current: string | null = null;
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const keyed = /^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*)$/.exec(line);
    if (keyed) {
      current = keyed[1];
      fields.set(current, { value: keyed[2].trim(), items: [] });
      continue;
    }
    if (!current) continue;
    const box = /^-\s+\[(x|X| )\]\s*(.*)$/.exec(line);
    if (!box || !box[2].trim()) continue;
    fields.get(current)?.items.push({ text: box[2].trim(), checked: box[1].toLowerCase() === "x" });
  }
  const status = reportStatus(fields.get("status")?.value ?? "");
  const command = fields.get("command")?.value ?? "";
  const exitRaw = fields.get("exitCode")?.value ?? "";
  const summary = fields.get("summary")?.value ?? "";
  const acceptance = fields.get("acceptance")?.items ?? [];
  if (!status || !/^-?\d+$/.test(exitRaw) || !command || !summary || acceptance.length === 0) return null;
  return { status, command, exitCode: Number(exitRaw), acceptance, summary };
}

/**
 * 判定这一轮能不能进入待验收。
 * 要通过，报告得是通过、退出码为 0、命令与登记的一致、变更卡上每条验收标准都勾上，并且工作副本有新提交。
 */
export function judgeAcceptance(input: {
  card: ChangeCard;
  report: AcceptanceReport | null;
  testCommand: string;
  hasNewCommit: boolean;
}): AcceptanceVerdict {
  const { card, report, testCommand, hasNewCommit } = input;
  const unmet: string[] = [];
  if (!report) {
    unmet.push("没有验收报告");
  } else {
    if (report.status !== "pass") unmet.push("报告状态不是通过");
    if (report.exitCode !== 0) unmet.push(`测试退出码为 ${report.exitCode}`);
    if (normalize(report.command) !== normalize(testCommand)) unmet.push("测试命令与登记的不一致");
    for (const item of card.acceptance) {
      const found = report.acceptance.find((entry) => normalize(entry.text) === normalize(item));
      if (!found || !found.checked) unmet.push(`未勾选：${item}`);
    }
  }
  if (!hasNewCommit) unmet.push("相对起始分支没有新提交");
  return { passed: unmet.length === 0, unmet, report };
}

/** 读取这轮回复、变更卡和是否有新提交，给出判定。不启动 Agent。 */
export async function acceptanceVerdict(store: Store, conversationId: string, text: string): Promise<AcceptanceVerdict> {
  const conversation = store.conversation(conversationId);
  const project = conversation ? store.project(conversation.projectId) : undefined;
  const card = conversation ? readStoredCard(conversation.changeCard)?.card : null;
  const report = parseAcceptanceReport(text);
  if (!conversation || !project || !card) {
    return { passed: false, unmet: ["没有变更卡"], report };
  }
  let hasNewCommit = false;
  if (conversation.worktreePath) {
    try {
      hasNewCommit = await hasNewCommits(store, conversationId);
    } catch {
      hasNewCommit = false;
    }
  }
  return judgeAcceptance({ card, report, testCommand: project.testCommand, hasNewCommit });
}

function reportStatus(value: string): "pass" | "fail" | null {
  if (value === "pass" || value === "通过") return "pass";
  if (value === "fail" || value === "未通过") return "fail";
  return null;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function extractBlock(text: string, marker: string): string | null {
  const cleaned = text.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "");
  const start = cleaned.indexOf(marker);
  if (start < 0) return null;
  return cleaned.slice(start + marker.length).replace(/^\r?\n/, "").trim();
}
