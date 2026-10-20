import assert from "node:assert/strict";
import test from "node:test";
import { phasePhrase, progressPhrase } from "./progress.js";

test("进度短句不含命令原文", () => {
  const phrase = progressPhrase(
    "shell",
    { command: "npm test --coverage" },
    "npm test",
  );
  assert.equal(phrase, "正在跑测试");
  assert.equal(phrase.includes("npm"), false);
  assert.equal(progressPhrase("edit", {}, "npm test"), "正在改代码");
  assert.equal(progressPhrase("grep", {}, "npm test"), "正在看页面");
  assert.equal(progressPhrase("shell", { command: "git status" }, "npm test"), "正在看页面");
});

test("澄清和查看检查有单独短句", () => {
  assert.equal(phasePhrase("clarify"), "正在整理需求");
  assert.equal(phasePhrase("checks"), "正在查看仓库检查");
});
