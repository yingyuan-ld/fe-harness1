import assert from "node:assert/strict";
import test from "node:test";
import { judgeAcceptance, type CheckSnapshot, type JudgeInput } from "./judge.js";
import type { AcceptanceReport, ChangeCard } from "./types.js";

const card: ChangeCard = {
  goal: "把提交按钮改成绿色",
  pages: "/settings",
  acceptance: ["打开设置页能看到绿色提交按钮", "移动端按钮同样是绿色"],
  outOfScope: ["不改登录页"],
  summary: "只改设置页按钮的颜色",
};

const report: AcceptanceReport = {
  status: "pass",
  command: "npm test",
  exitCode: 0,
  acceptance: [
    { text: "打开设置页能看到绿色提交按钮", checked: true },
    { text: "移动端按钮同样是绿色", checked: true },
  ],
  summary: "按钮已经是绿色",
};

const noChecks: CheckSnapshot = { required: [], results: [], timedOut: false };

function input(patch: Partial<JudgeInput> = {}): JudgeInput {
  return {
    card,
    report,
    testCommand: "npm test",
    hasNewCommits: true,
    checks: noChecks,
    ...patch,
  };
}

test("报告、提交和检查都满足时通过", () => {
  assert.deepEqual(judgeAcceptance(input()), {
    passed: true,
    pending: false,
    reasons: [],
  });
});

test("缺报告", () => {
  const result = judgeAcceptance(input({ report: null }));
  assert.equal(result.passed, false);
  assert.equal(result.pending, false);
  assert.deepEqual(result.reasons, ["没有验收报告"]);
});

test("命令不一致", () => {
  const result = judgeAcceptance(
    input({ report: { ...report, command: "npm run lint" } }),
  );
  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes("测试命令与仓库配置不一致"));
});

test("命令只差空白时仍视为同一条", () => {
  const result = judgeAcceptance(
    input({
      report: { ...report, command: "npm   test" },
      testCommand: " npm test ",
    }),
  );
  assert.equal(result.passed, true);
});

test("退出码非 0", () => {
  const result = judgeAcceptance(input({ report: { ...report, exitCode: 1 } }));
  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes("测试退出码为 1"));
});

test("验收条未勾满", () => {
  const result = judgeAcceptance(
    input({
      report: {
        ...report,
        acceptance: [
          { text: "打开设置页能看到绿色提交按钮", checked: true },
          { text: "移动端按钮同样是绿色", checked: false },
        ],
      },
    }),
  );
  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes("未勾选：移动端按钮同样是绿色"));
});

test("报告没写到变更卡上的某一条", () => {
  const result = judgeAcceptance(
    input({
      report: {
        ...report,
        acceptance: [{ text: "打开设置页能看到绿色提交按钮", checked: true }],
      },
    }),
  );
  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes("未覆盖：移动端按钮同样是绿色"));
});

test("没有新提交", () => {
  const result = judgeAcceptance(input({ hasNewCommits: false }));
  assert.equal(result.passed, false);
  assert.deepEqual(result.reasons, ["没有产生提交"]);
});

test("报告状态不是通过", () => {
  const result = judgeAcceptance(
    input({ report: { ...report, status: "fail" } }),
  );
  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes("报告状态不是通过"));
});

test("所需检查还在进行时保持等待，不算未通过", () => {
  const result = judgeAcceptance(
    input({
      checks: {
        required: ["lint", "build"],
        results: [
          { name: "lint", state: "success" },
          { name: "build", state: "pending" },
        ],
        timedOut: false,
      },
    }),
  );
  assert.equal(result.passed, false);
  assert.equal(result.pending, true);
  assert.deepEqual(result.reasons, ["仓库检查尚未完成：build"]);
});

test("所需检查全部成功时通过", () => {
  const result = judgeAcceptance(
    input({
      checks: {
        required: ["lint"],
        results: [{ name: "lint", state: "success" }],
        timedOut: false,
      },
    }),
  );
  assert.equal(result.passed, true);
});

test("检查失败", () => {
  const result = judgeAcceptance(
    input({
      checks: {
        required: ["lint"],
        results: [{ name: "lint", state: "failure" }],
        timedOut: false,
      },
    }),
  );
  assert.equal(result.passed, false);
  assert.equal(result.pending, false);
  assert.deepEqual(result.reasons, ["检查失败：lint"]);
});

test("检查超时仍未完成", () => {
  const result = judgeAcceptance(
    input({
      checks: { required: ["lint"], results: [], timedOut: true },
    }),
  );
  assert.equal(result.passed, false);
  assert.equal(result.pending, false);
  assert.deepEqual(result.reasons, ["仓库检查在等待时间内没有全部通过"]);
});

test("报告已经失败时不再等待检查", () => {
  const result = judgeAcceptance(
    input({
      report: null,
      checks: {
        required: ["lint"],
        results: [{ name: "lint", state: "pending" }],
        timedOut: false,
      },
    }),
  );
  assert.equal(result.pending, false);
  assert.ok(result.reasons.includes("没有验收报告"));
});
