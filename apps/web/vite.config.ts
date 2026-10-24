import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** 页面把 /api 转到编排器。端口跟 config.json 保持一致。 */
function apiPort(): number {
  try {
    const file = resolve(root, "config.json");
    if (!existsSync(file)) return 8787;
    const raw = JSON.parse(readFileSync(file, "utf8")) as { port?: unknown };
    if (typeof raw.port === "number" && raw.port > 0) return raw.port;
  } catch {
    return 8787;
  }
  return 8787;
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort()}`,
    },
  },
});
