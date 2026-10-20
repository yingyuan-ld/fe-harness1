import assert from "node:assert/strict";
import test from "node:test";
import { branchName } from "./branch.js";

test("分支名取对话 id 的前 8 位", () => {
  assert.equal(branchName("a1b2c3d4-e5f6-7890-abcd-ef1234567890"), "fe/a1b2c3d4");
  assert.equal(branchName("  abcdef12tail"), "fe/abcdef12");
});

test("前 8 位不足或含符号时拒绝", () => {
  assert.throws(() => branchName("short"), /前 8 位/);
  assert.throws(() => branchName("abcd-efghijkl"), /前 8 位/);
  assert.throws(() => branchName(""), /前 8 位/);
});
