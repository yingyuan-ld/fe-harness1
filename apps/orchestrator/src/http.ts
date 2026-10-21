import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Store } from "../db/index.js";
import { RegisterError, registerProject, updateProject } from "./registry.js";

/** 在本机启动登记接口。端口为 0 时由系统分配。 */
export function startServer(store: Store, port: number): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    void handle(req, res, store).catch((err: unknown) => {
      if (err instanceof RegisterError) {
        send(res, err.status, { error: err.message });
        return;
      }
      console.error(err);
      send(res, 500, { error: "登记失败" });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolve({ server, port: actual });
    });
  });
}

/** 分发登记接口：列出、新增、修改仓库。其他路径返回 404。 */
async function handle(req: IncomingMessage, res: ServerResponse, store: Store): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method ?? "GET";

  if (method === "GET" && pathname === "/api/projects/list") {
    send(res, 200, { projects: store.listProjects() });
    return;
  }

  if (method === "POST" && pathname === "/api/projects/add") {
    const project = await registerProject(store, await readJson(req));
    send(res, 201, { project });
    return;
  }

  const match = /^\/api\/projects\/update\/([^/]+)$/.exec(pathname);
  if (match && method === "PATCH") {
    const project = await updateProject(store, match[1], await readJson(req));
    send(res, 200, { project });
    return;
  }

  send(res, 404, { error: "没有这个接口" });
}

/** 以 JSON 写回状态码和响应体。 */
function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** 读出请求体并解析成 JSON。空正文、无法解析或超过 1MB 时抛错。 */
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (chunks.reduce((sum, item) => sum + item.length, 0) > 1_000_000) {
        reject(new RegisterError("登记内容过大", 400));
        req.destroy();
      }
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        reject(new RegisterError("登记内容必须是对象", 400));
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new RegisterError("登记内容无法解析", 400));
      }
    });
    req.on("error", reject);
  });
}
