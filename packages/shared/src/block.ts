const CARD = "FE_HARNESS_CARD";
const REPORT = "FE_HARNESS_REPORT";

export function extractBlock(text: string, marker: string): string | null {
  const cleaned = text.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "");
  const start = cleaned.indexOf(marker);
  if (start < 0) return null;
  let rest = cleaned.slice(start + marker.length).replace(/^\r?\n/, "");
  const other = marker === CARD ? REPORT : CARD;
  const next = rest.indexOf(other);
  if (next >= 0) rest = rest.slice(0, next);
  return rest.trim();
}

export type Field = {
  value: string;
  items: string[];
  checks: { text: string; checked: boolean }[];
};

export function parseFields(block: string): Map<string, Field> {
  const fields = new Map<string, Field>();
  let current: string | null = null;
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const keyed = /^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*)$/.exec(line);
    if (keyed) {
      current = keyed[1];
      fields.set(current, { value: keyed[2].trim(), items: [], checks: [] });
      continue;
    }
    if (!current) continue;
    const field = fields.get(current)!;
    const box = /^-\s+\[(x|X| )\]\s*(.*)$/.exec(line);
    if (box) {
      const text = box[2].trim();
      field.checks.push({ text, checked: box[1].toLowerCase() === "x" });
      field.items.push(text);
      continue;
    }
    const plain = /^-\s+(.*)$/.exec(line);
    if (plain) field.items.push(plain[1].trim());
  }
  return fields;
}
