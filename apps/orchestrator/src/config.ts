import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type AppConfig = {
  /** 调用 Cursor Agent 的密钥。 */
  cursorApiKey: string;
  /** 使用的模型，缺省为 composer-2.5。 */
  modelId: string;
  /** 本机服务端口，缺省为 8787。 */
  port: number;
  /** SQLite 等数据的目录，相对配置文件所在目录，缺省为 data。 */
  dataDir: string;
  /** GitHub 令牌，用来推送分支、打开合并请求。 */
  githubToken: string;
  /** GitLab 令牌，用来推送分支、打开合并请求。 */
  gitlabToken: string;
  /** Azure DevOps 令牌，用来推送分支、打开合并请求。 */
  azureDevOpsToken: string;
  /** 预览地址使用的主机名，缺省为 127.0.0.1。 */
  previewHost: string;
  /** 实际读到的配置文件绝对路径。 */
  file: string;
};

/** 仓库根目录。本文件在 apps/orchestrator/src，向上三级。 */
export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

/** 默认配置文件：仓库根目录下的 config.json。 */
export function defaultConfigPath(): string {
  return path.join(repoRoot(), "config.json");
}

/** 读取并校验配置。缺省字段补上默认值，数据目录解析成绝对路径。 */
export function loadConfig(file = defaultConfigPath()): AppConfig {
  const configPath = path.resolve(file);
  const text = readConfig(configPath);
  const raw = parseObject(text, configPath);
  return {
    cursorApiKey: readString(raw, "cursorApiKey") ?? "",
    modelId: readString(raw, "modelId") || "composer-2.5",
    port: readPort(raw.port),
    dataDir: path.resolve(path.dirname(configPath), readString(raw, "dataDir") || "data"),
    githubToken: readString(raw, "githubToken") ?? "",
    gitlabToken: readString(raw, "gitlabToken") ?? "",
    azureDevOpsToken: readString(raw, "azureDevOpsToken") ?? "",
    previewHost: readPreviewHost(readString(raw, "previewHost")),
    file: configPath,
  };
}

/** 读出配置文件全文。文件不存在时抛出带路径的错误。 */
function readConfig(configPath: string): string {
  try {
    return readFileSync(configPath, "utf8");
  } catch {
    throw new Error(`找不到配置文件 ${configPath}`);
  }
}

/** 解析成对象。内容不是 JSON 对象时抛错。 */
function parseObject(text: string, configPath: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`无法解析 ${configPath}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("config.json 必须是对象");
  }
  return value as Record<string, unknown>;
}

/** 读取字符串字段并去掉首尾空白。缺省返回 undefined，类型不对则抛错。 */
function readString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  if (value == null) return undefined;
  if (typeof value !== "string") throw new Error(`${key} 必须是字符串`);
  return value.trim();
}

/** 读取端口。缺省为 8787，必须是 1 到 65535 的整数。 */
function readPort(value: unknown): number {
  if (value == null) return 8787;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("port 必须是 1 到 65535 的整数");
  }
  return value;
}

/** 读取预览主机名。缺省为 127.0.0.1，只允许字母、数字、点和横线。 */
function readPreviewHost(value: string | undefined): string {
  const host = value || "127.0.0.1";
  if (!/^[\w.-]+$/.test(host)) throw new Error("previewHost 只能包含字母、数字、点和横线");
  return host;
}
