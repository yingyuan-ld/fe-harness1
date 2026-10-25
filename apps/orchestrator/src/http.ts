import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Store } from "../db/index.js";
import type { AgentAdapter } from "./agent.js";
import { confirmCard, runClarify } from "./clarify.js";
import {
  addMessage,
  ConversationError,
  createConversation,
  listConversations,
  Live,
  readConversation,
  removeConversation,
} from "./conversations.js";
import { RegisterError, registerProject, updateProject } from "./registry.js";

/** 在本机启动登记和对话接口。传入 agent 时，使用人的消息会走澄清。端口为 0 时由系统分配。 */
export function startServer(
  store: Store,
  port: number,
  options?: { agent?: AgentAdapter },
): Promise<{ server: Server; port: number }> {
  const live = new Live();
  const agent = options?.agent;
  const server = createServer((req, res) => {
    void handle(req, res, store, live, agent).catch((err: unknown) => {
      if (err instanceof RegisterError || err instanceof ConversationError) {
        send(res, err.status, { error: err.message });
        return;
      }
      console.error(err);
      send(res, 500, { error: "请求失败" });
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

/** 分发登记和对话接口。对话的实时推送在命中后直接占用这条连接。 */
async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  store: Store,
  live: Live,
  agent: AgentAdapter | undefined,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method ?? "GET";

  if (await handleConversation(req, res, store, live, agent, method, pathname, url)) return;

  /** GET /api/projects/list：列出已登记的仓库。 */
  if (method === "GET" && pathname === "/api/projects/list") {
    send(res, 200, { projects: store.listProjects() });
    return;
  }

  /** POST /api/projects/add：登记仓库。本机目录不合法时不写入。 */
  if (method === "POST" && pathname === "/api/projects/add") {
    const project = await registerProject(store, await readJson(req));
    send(res, 201, { project });
    return;
  }

  /** PATCH /api/projects/update/:id：修改已有仓库。仓库不存在或目录不合法时不写入。 */
  const match = /^\/api\/projects\/update\/([^/]+)$/.exec(pathname);
  if (match && method === "PATCH") {
    const project = await updateProject(store, match[1], await readJson(req));
    send(res, 200, { project });
    return;
  }

  send(res, 404, { error: "没有这个接口" });
}

/** 处理对话接口。路径不属于对话时返回 false。 */
async function handleConversation(
  req: IncomingMessage,
  res: ServerResponse,
  store: Store,
  live: Live,
  agent: AgentAdapter | undefined,
  method: string,
  pathname: string,
  url: URL,
): Promise<boolean> {
  /** GET /api/conversations：列出对话。带 projectId 时只返回该仓库下的。 */
  if (method === "GET" && pathname === "/api/conversations") {
    const projectId = url.searchParams.get("projectId")?.trim() || undefined;
    send(res, 200, { conversations: listConversations(store, projectId) });
    return true;
  }
  /** POST /api/conversations：在已登记的仓库下新建对话，状态为澄清中。 */
  if (method === "POST" && pathname === "/api/conversations") {
    send(res, 201, { conversation: createConversation(store, await readJson(req)) });
    return true;
  }

  /** GET /api/conversations/:id/events：用 SSE 推送这条对话的新消息、状态和删除。 */
  const events = /^\/api\/conversations\/([^/]+)\/events$/.exec(pathname);
  if (events && method === "GET") {
    streamEvents(req, res, store, live, events[1]);
    return true;
  }

  /** POST /api/conversations/:id/confirm：确认变更卡并冻结。之后的澄清回复不能再覆盖它。 */
  const confirm = /^\/api\/conversations\/([^/]+)\/confirm$/.exec(pathname);
  if (confirm && method === "POST") {
    await readJson(req);
    send(res, 200, { conversation: confirmCard(store, live, confirm[1]) });
    return true;
  }

  /** POST /api/conversations/:id/messages：写入一条消息。使用人的消息会接着走澄清。 */
  const messages = /^\/api\/conversations\/([^/]+)\/messages$/.exec(pathname);
  if (messages && method === "POST") {
    const message = addMessage(store, live, messages[1], await readJson(req));
    if (message.role === "user" && agent) await runClarify(store, live, agent, messages[1]);
    send(res, 201, { message });
    return true;
  }

  /** GET /api/conversations/:id：读取一条对话和它的全部消息。DELETE：删除这条对话及其消息、运行记录。 */
  const one = /^\/api\/conversations\/([^/]+)\/?$/.exec(pathname);
  if (one && method === "GET") {
    send(res, 200, readConversation(store, one[1]));
    return true;
  }
  if (one && method === "DELETE") {
    removeConversation(store, live, one[1]);
    res.writeHead(204);
    res.end();
    return true;
  }
  if (pathname.startsWith("/api/conversations")) {
    send(res, 404, { error: "没有这个接口" });
    return true;
  }
  return false;
}

/** 把这条对话的后续变更以 SSE 推给当前连接。 */
function streamEvents(req: IncomingMessage, res: ServerResponse, store: Store, live: Live, id: string): void {
  if (!store.conversation(id)) {
    send(res, 404, { error: "对话不存在" });
    return;
  }
  const unsubscribe = live.subscribe(id, (event) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === "deleted") res.end();
  });
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  res.write(": ok\n\n");
  const ping = setInterval(() => {
    res.write(": ping\n\n");
  }, 15000);
  ping.unref();
  req.on("close", () => {
    clearInterval(ping);
    unsubscribe();
  });
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
        reject(new RegisterError("请求内容过大", 400));
        req.destroy();
      }
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        reject(new RegisterError("请求内容必须是对象", 400));
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new RegisterError("请求内容无法解析", 400));
      }
    });
    req.on("error", reject);
  });
}
