import assert from "node:assert/strict";
import test from "node:test";
import { toolDetail } from "../src/cursor-agent.js";
import { progressPhrase } from "../src/progress.js";

test("工具参数里的命令能被收成正在跑测试", () => {
  const detail = toolDetail({ command: "npm test -- src/pages" });
  assert.equal(progressPhrase("shell", detail, "npm test"), "正在跑测试");
});

test("改文件的工具收成正在改代码", () => {
  const detail = toolDetail({ file_path: "src/pages/Home.js" });
  assert.equal(progressPhrase("edit", detail, "npm test"), "正在改代码");
});

test("没有命令和路径时不编造内容", () => {
  assert.equal(toolDetail({ count: 1 }), "");
  assert.equal(toolDetail(null), "");
});
