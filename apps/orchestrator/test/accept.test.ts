import assert from "node:assert/strict";
import test from "node:test";
import { judgeAcceptance, parseAcceptanceReport } from "../src/accept.js";
import type { ChangeCard } from "../src/card.js";

const card: ChangeCard = {
  goal: "把首页标题改一下",
  pages: "首页",
  acceptance: ["打开首页能看到新标题"],
  outOfScope: [],
  summary: "只改首页标题",
};

const command = "npm test";

test("夹具：报告通过、命令一致、验收勾满且有新提交时通过", () => {
  const verdict = judge(reportText({}), true);
  assert.equal(verdict.passed, true);
  assert.deepEqual(verdict.unmet, []);
});

test("夹具：没有验收报告，正文写已完成也不通过", () => {
  const verdict = judgeAcceptance({
    card,
    report: parseAcceptanceReport("已完成"),
    testCommand: command,
    hasNewCommit: true,
  });
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.unmet, ["没有验收报告"]);
});

test("夹具：测试命令与登记的不一致时不通过", () => {
  const verdict = judge(reportText({ command: "npm run test" }), true);
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.unmet, ["测试命令与登记的不一致"]);
});

test("夹具：相对起始分支没有新提交时不通过", () => {
  const verdict = judge(reportText({}), false);
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.unmet, ["相对起始分支没有新提交"]);
});

test("夹具：验收标准未勾满时不通过", () => {
  const verdict = judge(reportText({ checked: false }), true);
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.unmet, ["未勾选：打开首页能看到新标题"]);
});

function judge(text: string, hasNewCommit: boolean) {
  return judgeAcceptance({
    card,
    report: parseAcceptanceReport(text),
    testCommand: command,
    hasNewCommit,
  });
}

function reportText(input: { command?: string; checked?: boolean; status?: string }): string {
  const mark = input.checked === false ? " " : "x";
  return [
    "已完成",
    "FE_HARNESS_REPORT",
    `status: ${input.status ?? "pass"}`,
    `command: ${input.command ?? command}`,
    "exitCode: 0",
    "acceptance:",
    `- [${mark}] 打开首页能看到新标题`,
    "summary: 首页标题已改",
  ].join("\n");
}
