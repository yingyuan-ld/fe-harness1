import { Store } from "../db/index.js";
import { FakeAgent } from "./agent.js";
import { loadConfig } from "./config.js";
import { CursorAgent } from "./cursor-agent.js";
import { startServer } from "./http.js";

const config = loadConfig();
const store = new Store(config.dataDir);
const agent = config.cursorApiKey
  ? new CursorAgent({ apiKey: config.cursorApiKey, modelId: config.modelId })
  : new FakeAgent();
if (agent instanceof CursorAgent) {
  const stop = () => {
    void agent.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
const { port } = await startServer(store, config.port, { agent, dataDir: config.dataDir });
console.log(agent instanceof CursorAgent ? "Agent：Cursor 本地运行时" : "Agent：脚本");
console.log(`仓库登记 http://127.0.0.1:${port}/api/projects/list`);
console.log(`对话 http://127.0.0.1:${port}/api/conversations`);
