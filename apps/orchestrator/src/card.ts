/** 一张变更卡：确认前给使用人看，确认后冻结给实现和返工用。 */
export type ChangeCard = {
  goal: string;
  pages: string;
  acceptance: string[];
  outOfScope: string[];
  summary: string;
};

const CARD = "FE_HARNESS_CARD";

/** 从 Agent 回复里解析变更卡。缺标记、缺字段或没有验收标准时返回 null。 */
export function parseChangeCard(text: string): ChangeCard | null {
  const block = extractBlock(text, CARD);
  if (!block) return null;
  const fields = parseFields(block);
  if (!fields.has("outOfScope")) return null;
  return asChangeCard({
    goal: fields.get("goal")?.value ?? "",
    pages: fields.get("pages")?.value ?? "",
    summary: fields.get("summary")?.value ?? "",
    acceptance: fields.get("acceptance")?.items ?? [],
    outOfScope: fields.get("outOfScope")?.items ?? [],
  });
}

/** 读取已经存进对话的变更卡。附带 frozen 时表示已经确认。 */
export function readStoredCard(value: unknown): { card: ChangeCard; frozen: boolean } | null {
  const card = asChangeCard(value);
  if (!card) return null;
  const frozen =
    typeof value === "object" && value !== null && !Array.isArray(value) && (value as { frozen?: unknown }).frozen === true;
  return { card, frozen };
}

/** 这张卡是否已经确认冻结。 */
export function isFrozenCard(value: unknown): boolean {
  return readStoredCard(value)?.frozen === true;
}

/** 回复里标记之前的说明。没有说明时返回空串。 */
export function proseBeforeCard(text: string): string {
  const cleaned = stripFences(text);
  const start = cleaned.indexOf(CARD);
  return (start >= 0 ? cleaned.slice(0, start) : cleaned).trim();
}

/** 把对象收成变更卡。验收标准至少一条，outOfScope 必须是字符串列表。 */
export function asChangeCard(value: unknown): ChangeCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.goal !== "string" || typeof raw.pages !== "string" || typeof raw.summary !== "string") return null;
  if (!isStringList(raw.acceptance) || !isStringList(raw.outOfScope)) return null;
  const goal = raw.goal.trim();
  const pages = raw.pages.trim();
  const summary = raw.summary.trim();
  const acceptance = raw.acceptance.map((item) => item.trim()).filter(Boolean);
  const outOfScope = raw.outOfScope.map((item) => item.trim()).filter((item) => item && item !== "（无）");
  if (!goal || !pages || !summary || acceptance.length === 0) return null;
  return { goal, pages, summary, acceptance, outOfScope };
}

function extractBlock(text: string, marker: string): string | null {
  const cleaned = stripFences(text);
  const start = cleaned.indexOf(marker);
  if (start < 0) return null;
  return cleaned.slice(start + marker.length).replace(/^\r?\n/, "").trim();
}

function stripFences(text: string): string {
  return text.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "");
}

type Field = { value: string; items: string[] };

function parseFields(block: string): Map<string, Field> {
  const fields = new Map<string, Field>();
  let current: string | null = null;
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const keyed = /^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*)$/.exec(line);
    if (keyed) {
      current = keyed[1];
      fields.set(current, { value: keyed[2].trim(), items: [] });
      continue;
    }
    if (!current) continue;
    const field = fields.get(current);
    if (!field) continue;
    const checked = /^-\s+\[(?:x|X| )\]\s*(.*)$/.exec(line);
    const plain = /^-\s+(.*)$/.exec(line);
    if (checked) field.items.push(checked[1].trim());
    else if (plain) field.items.push(plain[1].trim());
  }
  return fields;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
