import assert from "node:assert/strict";
import test from "node:test";
import { formatChangeCard, parseChangeCard } from "./card.js";
import type { ChangeCard } from "./types.js";

const card: ChangeCard = {
  goal: "把提交按钮改成绿色",
  pages: "/settings",
  acceptance: ["打开设置页能看到绿色提交按钮"],
  outOfScope: ["不改登录页"],
  summary: "只改设置页按钮的颜色",
};

const cardText = `
说明一下。
FE_HARNESS_CARD
goal: 把提交按钮改成绿色
pages: /settings
acceptance:
- 打开设置页能看到绿色提交按钮
outOfScope:
- 不改登录页
summary: 只改设置页按钮的颜色
`;

test("解析变更卡", () => {
  assert.deepEqual(parseChangeCard(cardText), card);
  assert.equal(parseChangeCard("没有标记"), null);
});

test("变更卡包在代码块里也能解析", () => {
  const wrapped = ["```text", cardText.trim(), "```"].join("\n");
  assert.deepEqual(parseChangeCard(wrapped), card);
});

test("变更卡后面紧跟验收报告时只取变更卡", () => {
  const both = `${cardText}
FE_HARNESS_REPORT
status: pass
command: npm test
exitCode: 0
acceptance:
- [x] 打开设置页能看到绿色提交按钮
summary: 按钮已经是绿色
`;
  assert.deepEqual(parseChangeCard(both), card);
});

test("缺少验收条目、范围或必填字段时不形成变更卡", () => {
  assert.equal(
    parseChangeCard("FE_HARNESS_CARD\ngoal: a\npages: b\nacceptance:\nsummary: c"),
    null,
  );
  assert.equal(
    parseChangeCard(
      "FE_HARNESS_CARD\ngoal: a\npages: b\nacceptance:\n- 能看到按钮\nsummary: c",
    ),
    null,
  );
  assert.equal(
    parseChangeCard(
      "FE_HARNESS_CARD\ngoal:\npages: /settings\nacceptance:\n- 能看到按钮\noutOfScope:\n- （无）\nsummary: 改颜色",
    ),
    null,
  );
});

test("这次不做的事可以写（无），解析后为空列表", () => {
  const text = `
FE_HARNESS_CARD
goal: 把标题加大
pages: /home
acceptance:
- 首页标题比原来大
outOfScope:
- （无）
summary: 只加大首页标题
`;
  assert.deepEqual(parseChangeCard(text)?.outOfScope, []);
});

test("格式化后再解析得到同一张卡", () => {
  assert.deepEqual(parseChangeCard(formatChangeCard(card)), card);
  assert.deepEqual(
    parseChangeCard(formatChangeCard({ ...card, outOfScope: [] })),
    { ...card, outOfScope: [] },
  );
});
