import assert from "node:assert/strict";
import test from "node:test";
import { isFrozenCard, parseChangeCard, readStoredCard } from "./card.js";

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
  assert.deepEqual(parseChangeCard(cardText), {
    goal: "把提交按钮改成绿色",
    pages: "/settings",
    acceptance: ["打开设置页能看到绿色提交按钮"],
    outOfScope: ["不改登录页"],
    summary: "只改设置页按钮的颜色",
  });
  assert.equal(parseChangeCard("没有标记"), null);
  assert.equal(parseChangeCard("FE_HARNESS_CARD\ngoal: a\npages: b\nacceptance:\nsummary: c"), null);
  assert.equal(
    parseChangeCard("FE_HARNESS_CARD\ngoal: a\npages: b\nacceptance:\n- 看得到\nsummary: c"),
    null,
  );
});

test("确认后的变更卡带冻结标记", () => {
  const stored = {
    goal: "改标题",
    pages: "首页",
    acceptance: ["看得到新标题"],
    outOfScope: [],
    summary: "只改标题",
    frozen: true,
  };
  assert.equal(isFrozenCard(stored), true);
  assert.equal(readStoredCard(stored)?.card.goal, "改标题");
  assert.equal(isFrozenCard({ ...stored, frozen: false }), false);
});
