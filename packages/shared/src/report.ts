import { extractBlock, parseFields } from "./block.js";
import type { AcceptanceReport } from "./types.js";

export function parseAcceptanceReport(text: string): AcceptanceReport | null {
  const block = extractBlock(text, "FE_HARNESS_REPORT");
  if (!block) return null;
  const fields = parseFields(block);
  const status = fields.get("status")?.value;
  const command = fields.get("command")?.value ?? "";
  const exitRaw = fields.get("exitCode")?.value ?? "";
  const summary = fields.get("summary")?.value ?? "";
  const acceptance = fields.get("acceptance")?.checks ?? [];
  if (status !== "pass" && status !== "fail") return null;
  if (!/^-?\d+$/.test(exitRaw)) return null;
  if (!command || !summary || acceptance.length === 0) return null;
  if (acceptance.some((item) => !item.text)) return null;
  return {
    status,
    command,
    exitCode: Number(exitRaw),
    acceptance,
    summary,
  };
}
