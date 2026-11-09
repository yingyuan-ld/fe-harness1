// 在工作副本里启动登记的开发命令，从输出里认出预览地址。
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

const WAIT_MS = 15_000;

type Running = {
  child: ChildProcess;
  port: number;
  url: string | null;
  intentional: boolean;
  onDown?: () => void;
};

const running = new Map<string, Running>();

export type PreviewStart = {
  conversationId: string;
  cwd: string;
  devCommand: string;
  host: string;
  /** 预览曾就绪、之后进程自己退出时调用。主动停掉时不调用。 */
  onDown?: () => void;
};

export type PreviewOutcome = {
  status: "ready" | "missing";
  url: string | null;
  port: number | null;
};

/** 从开发命令的输出里取第一个 http(s) 地址。没有时返回 null。 */
export function findPreviewUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"'<>]+/);
  if (!match) return null;
  return match[0].replace(/[),.;]+$/, "");
}

/**
 * 保证这条对话有一个预览进程。
 * 已经在跑就复用，不重启。没打印地址或进程退出时记为 missing。
 */
export async function ensurePreview(input: PreviewStart): Promise<PreviewOutcome> {
  const existing = running.get(input.conversationId);
  if (existing && existing.child.exitCode === null && !existing.child.killed) {
    return outcome(existing);
  }
  const devCommand = input.devCommand.trim();
  if (!devCommand || !/^[\w.-]+$/.test(input.host)) {
    return { status: "missing", url: null, port: null };
  }
  let port = 0;
  try {
    port = await freePort();
  } catch {
    return { status: "missing", url: null, port: null };
  }
  // 先不做自定义预览入口。
  // const command = `${devCommand} --host ${input.host} --port ${port}`;
  const command = devCommand;
  const child = spawn(command, {
    cwd: input.cwd,
    shell: true,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const record: Running = { child, port, url: null, intentional: false, onDown: input.onDown };
  running.set(input.conversationId, record);
  child.on("exit", () => {
    if (running.get(input.conversationId)?.child === child) running.delete(input.conversationId);
    if (record.intentional || !record.url) return;
    record.onDown?.();
  });
  record.url = await waitForUrl(child);
  if (!record.url || child.exitCode !== null) {
    record.intentional = true;
    if (running.get(input.conversationId)?.child === child) running.delete(input.conversationId);
    killTree(child);
    return { status: "missing", url: null, port };
  }
  return outcome(record);
}

/** 停掉这条对话的预览。没有在跑时直接返回。 */
export function stopPreview(conversationId: string): Promise<void> {
  const current = running.get(conversationId);
  if (!current) return Promise.resolve();
  current.intentional = true;
  running.delete(conversationId);
  return exited(current.child);
}

/** 停掉本进程拉起的全部预览。 */
export function stopAllPreviews(): Promise<void> {
  return Promise.all([...running.keys()].map((id) => stopPreview(id))).then(() => undefined);
}

function outcome(record: Running): PreviewOutcome {
  if (!record.url) return { status: "missing", url: null, port: record.port };
  return { status: "ready", url: record.url, port: record.port };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error("没有分配到端口"))));
    });
  });
}

function waitForUrl(child: ChildProcess): Promise<string | null> {
  return new Promise((resolve) => {
    let text = "";
    let done = false;
    const finish = (url: string | null) => {
      if (done) return;
      done = true;
      resolve(url);
    };
    const onData = (chunk: Buffer | string) => {
      if (done) return;
      text += chunk.toString();
      if (text.length > 100_000) text = text.slice(-50_000);
      const url = findPreviewUrl(text);
      if (url) finish(url);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", () => finish(null));
    child.once("exit", () => finish(findPreviewUrl(text)));
    setTimeout(() => finish(findPreviewUrl(text)), WAIT_MS).unref();
  });
}

function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    killTree(child);
  });
}

function killTree(child: ChildProcess): void {
  if (child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  child.kill();
}
