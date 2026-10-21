import { Store } from "../db/index.js";
import { loadConfig } from "./config.js";
import { startServer } from "./http.js";

const config = loadConfig();
const store = new Store(config.dataDir);
const { port } = await startServer(store, config.port);
console.log(`仓库登记 http://127.0.0.1:${port}/api/projects/list`);
