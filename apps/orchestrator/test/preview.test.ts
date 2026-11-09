import assert from "node:assert/strict";
import test from "node:test";
import { ensurePreview, findPreviewUrl, stopPreview } from "../src/preview.js";

test("从输出里取出第一个网址", () => {
  assert.equal(findPreviewUrl("ready at http://127.0.0.1:3000/."), "http://127.0.0.1:3000/");
  assert.equal(findPreviewUrl("no address"), null);
});

test("进程马上退出时预览记为没有起来", async () => {
  const outcome = await ensurePreview({
    conversationId: "preview-exit",
    cwd: process.cwd(),
    devCommand: "node -e process.exit(0)",
    host: "127.0.0.1",
  });
  assert.equal(outcome.status, "missing");
  assert.equal(outcome.url, null);
  await stopPreview("preview-exit");
});
