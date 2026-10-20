import assert from "node:assert/strict";
import test from "node:test";
import { parseAcceptanceReport } from "./report.js";

const raw = `
正文里写已完成也不算数。
FE_HARNESS_REPORT
status: pass
command: npm test
exitCode: 0
acceptance:
- [x] 打开设置页能看到绿色提交按钮
- [ ] 移动端按钮同样是绿色
summary: 桌面端按钮已经是绿色
`;

test("解析验收报告，保留勾选状态", () => {
  assert.deepEqual(parseAcceptanceReport(raw), {
    status: "pass",
    command: "npm test",
    exitCode: 0,
    acceptance: [
      { text: "打开设置页能看到绿色提交按钮", checked: true },
      { text: "移动端按钮同样是绿色", checked: false },
    ],
    summary: "桌面端按钮已经是绿色",
  });
});

test("没有标记、状态非法、退出码不是整数、缺少验收勾选时解析失败", () => {
  assert.equal(parseAcceptanceReport("已完成"), null);
  assert.equal(
    parseAcceptanceReport(raw.replace("status: pass", "status: done")),
    null,
  );
  assert.equal(
    parseAcceptanceReport(raw.replace("exitCode: 0", "exitCode: zero")),
    null,
  );
  assert.equal(
    parseAcceptanceReport(`
FE_HARNESS_REPORT
status: pass
command: npm test
exitCode: 0
acceptance:
- 打开设置页能看到绿色提交按钮
summary: 按钮已经是绿色
`),
    null,
  );
});

test("失败状态和负退出码可以解析", () => {
  const report = parseAcceptanceReport(
    raw.replace("status: pass", "status: fail").replace("exitCode: 0", "exitCode: -1"),
  );
  assert.equal(report?.status, "fail");
  assert.equal(report?.exitCode, -1);
});
