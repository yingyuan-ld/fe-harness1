// 用 Cursor SDK 的本地运行时实现 AgentAdapter。澄清和开发都通过这层收发。
import { Agent, type Run, type SDKAgent } from "@cursor/sdk";
import { RunCancelled, type AgentPlace, type AgentRun, type AgentSession, type AgentAdapter } from "./agent.js";
import { progressPhrase } from "./progress.js";

/** 把工具参数收成一段可检索的文字。字段名随工具变化，只取常见的命令和路径。 */
export function toolDetail(args: unknown): string {
  if (typeof args === "string") return args;
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  const bits: string[] = [];
  for (const key of ["command", "cmd", "path", "file_path", "target_file", "file", "glob_pattern"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) bits.push(value);
  }
  return bits.join("\n");
}

/** 本地 Cursor Agent。密钥和模型来自配置，工作目录由每次创建或恢复传入。 */
export class CursorAgent implements AgentAdapter {
  private readonly open = new Map<string, SDKAgent>();

  constructor(private readonly options: { apiKey: string; modelId: string }) {}

  /** 在指定目录新建一个本地 Agent，并留在本进程里供后续恢复。 */
  async create(input: AgentPlace): Promise<AgentSession> {
    const sdk = await Agent.create({
      apiKey: this.options.apiKey,
      model: { id: this.options.modelId },
      mode: "agent",
      local: { cwd: input.cwd, settingSources: [] },
    });
    this.open.set(sdk.agentId, sdk);
    return this.session(sdk, input.testCommand ?? "");
  }

  /** 按已有编号接回。本进程里还留着的直接复用，否则从本地记录恢复。假编号则新建。 */
  async resume(agentId: string, input: AgentPlace): Promise<AgentSession> {
    if (!agentId.startsWith("agent-") && !agentId.startsWith("bc-")) return this.create(input);
    const cached = this.open.get(agentId);
    const sdk =
      cached ??
      (await Agent.resume(agentId, {
        apiKey: this.options.apiKey,
        model: { id: this.options.modelId },
        mode: "agent",
        local: { cwd: input.cwd, settingSources: [] },
      }));
    this.open.set(sdk.agentId, sdk);
    return this.session(sdk, input.testCommand ?? "");
  }

  /** 关掉本进程里还留着的 Agent。进程退出时调用。 */
  async close(): Promise<void> {
    const agents = [...this.open.values()];
    this.open.clear();
    await Promise.all(agents.map((agent) => agent[Symbol.asyncDispose]().catch(() => undefined)));
  }

  private session(sdk: SDKAgent, testCommand: string): AgentSession {
    return {
      agentId: sdk.agentId,
      send: async ({ prompt, images }) => {
        if ((images?.length ?? 0) > 4) throw new Error("最多四张图");
        const run = await sdk.send(
          images?.length
            ? { text: prompt, images: images.map((image) => ({ data: image.data, mimeType: image.mimeType })) }
            : prompt,
        );
        return this.run(run, testCommand);
      },
      dispose: async () => undefined,
    };
  }

  private run(run: Run, testCommand: string): AgentRun {
    return {
      id: run.id,
      events: toolPhrases(run, testCommand),
      wait: async () => {
        const result = await run.wait();
        if (result.status === "cancelled") throw new RunCancelled();
        if (result.status === "error") throw new Error(result.error?.message || "这轮没有完成");
        const branches = (result.git?.branches ?? []).flatMap((item) => (item.branch?.trim() ? [item.branch.trim()] : []));
        return { text: result.result ?? "", branches };
      },
      cancel: async () => {
        if (run.supports("cancel")) await run.cancel();
      },
    };
  }
}

/** 工具一开始调用时收成进度短句。完成事件不再重复送出。 */
async function* toolPhrases(run: Run, testCommand: string): AsyncIterable<{ phrase: string }> {
  if (!run.supports("stream")) return;
  for await (const event of run.stream()) {
    if (event.type !== "tool_call" || event.status !== "running") continue;
    yield { phrase: progressPhrase(event.name, toolDetail(event.args), testCommand) };
  }
}
