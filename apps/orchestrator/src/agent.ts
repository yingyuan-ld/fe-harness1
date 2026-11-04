import { randomUUID } from "node:crypto";
import { progressPhrase } from "./progress.js";

/** 这一轮被取消。等待结束的一方据此收尾，不再采用正文。 */
export class RunCancelled extends Error {
  constructor() {
    super("这轮已取消");
  }
}

/** 一张随提示送出的图片。一轮最多四张。 */
export type AgentImage = {
  data: string;
  mimeType: string;
};

export type AgentRunResult = {
  /** 助手正文，变更卡放在末尾。 */
  text: string;
  /** 这一轮新拉出的分支。澄清阶段出现分支就要收回。 */
  branches: string[];
};

/** 一轮运行。事件已收成短句，正文要等结束。 */
export type AgentRun = {
  id: string;
  events: AsyncIterable<{ phrase: string }>;
  wait(): Promise<AgentRunResult>;
  cancel(): Promise<void>;
};

/** 一个可复用的 Agent。澄清阶段按 id 恢复，不每次新建。 */
export type AgentSession = {
  agentId: string;
  send(input: { prompt: string; images?: AgentImage[] }): Promise<AgentRun>;
  dispose(): Promise<void>;
};

/** 创建或恢复 Agent。工作目录由调用方传入。 */
export type AgentAdapter = {
  create(input: { cwd: string }): Promise<AgentSession>;
  resume(agentId: string, input: { cwd: string }): Promise<AgentSession>;
};

/**
 * 脚本假 Agent。测试可以预先放入回复；没有夹具时，用对话摘要填一张合法变更卡。
 * 真 Cursor 不在这一层的完成范围内。
 */
export class FakeAgent implements AgentAdapter {
  /** 按发送顺序取出的回复。取完后改用对话摘要生成变更卡。 */
  replies: string[] = [];
  /** 下一次结束时报告的新分支。 */
  reportedBranches: string[] = [];
  /** 已经送出的提示，按发送顺序保留。 */
  readonly prompts: string[] = [];
  /** 下一次发送时按工具名收成进度短句。 */
  tools: Array<{ name: string; detail?: string }> = [];
  /** 判断工具是不是在跑登记的测试命令。 */
  progressCommand = "";
  /** 为真时，wait 停住，直到 cancel 或 release。 */
  hold = false;
  /** 结束前调用，测试用它把登记目录改脏。 */
  beforeWait?: (cwd: string) => void;
  readonly createdCwd: string[] = [];
  readonly resumed: string[] = [];
  private seq = 0;
  private readonly cwdOf = new Map<string, string>();
  private readonly held: Array<() => void> = [];

  /** 放行最早一轮被停住的 wait。 */
  release(): void {
    this.held.shift()?.();
  }

  async create(input: { cwd: string }): Promise<AgentSession> {
    const agentId = `fake-${++this.seq}`;
    this.createdCwd.push(input.cwd);
    this.cwdOf.set(agentId, input.cwd);
    return this.session(agentId);
  }

  async resume(agentId: string, input: { cwd: string }): Promise<AgentSession> {
    this.resumed.push(agentId);
    this.cwdOf.set(agentId, input.cwd);
    return this.session(agentId);
  }

  private session(agentId: string): AgentSession {
    return {
      agentId,
      send: async ({ prompt, images }) => {
        if ((images?.length ?? 0) > 4) throw new Error("最多四张图");
        const cwd = this.cwdOf.get(agentId) ?? "";
        this.prompts.push(prompt);
        const scripted = this.replies.shift();
        const text = scripted ?? cardFromSummary(prompt);
        const branches = [...this.reportedBranches];
        const phrases = this.tools.splice(0).map((tool) => progressPhrase(tool.name, tool.detail ?? "", this.progressCommand));
        const id = randomUUID();
        const slot = holdSlot(this.hold, this.held);
        return {
          id,
          events: phraseEvents(phrases),
          wait: async () => {
            await slot.gate;
            if (slot.cancelled) throw new RunCancelled();
            this.beforeWait?.(cwd);
            return { text, branches };
          },
          cancel: async () => {
            slot.cancelled = true;
            slot.release();
          },
        };
      },
      dispose: async () => undefined,
    };
  }
}

function cardFromSummary(prompt: string): string {
  const summary = summaryLine(prompt);
  return [
    "按对话摘要整理成下面这张变更卡。",
    "FE_HARNESS_CARD",
    `goal: ${summary}`,
    "pages: 对话里提到的页面",
    "acceptance:",
    "- 打开页面能看到这次描述的改动",
    "outOfScope:",
    "- （无）",
    `summary: ${summary}`,
  ].join("\n");
}

function summaryLine(prompt: string): string {
  const marker = "对话摘要：";
  const start = prompt.indexOf(marker);
  const rest = start >= 0 ? prompt.slice(start + marker.length).trim() : "";
  const paragraph = rest.split(/\r?\n\r?\n/)[0]?.trim() ?? "";
  const line = paragraph.split(/\r?\n/).find((item) => item.trim())?.trim() || "按使用人的描述修改页面";
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}

function holdSlot(hold: boolean, held: Array<() => void>): { gate: Promise<void>; release: () => void; cancelled: boolean } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  const slot = { gate, release, cancelled: false };
  if (hold) held.push(slot.release);
  else slot.release();
  return slot;
}

async function* phraseEvents(phrases: string[]): AsyncIterable<{ phrase: string }> {
  for (const phrase of phrases) yield { phrase };
}
