import { extractBlock, parseFields } from "./block.js";
import type { ChangeCard } from "./types.js";

const CARD = "FE_HARNESS_CARD";

export function parseChangeCard(text: string): ChangeCard | null {
  const block = extractBlock(text, CARD);
  if (!block) return null;
  const fields = parseFields(block);
  const goal = fields.get("goal")?.value ?? "";
  const pages = fields.get("pages")?.value ?? "";
  const summary = fields.get("summary")?.value ?? "";
  const acceptance = (fields.get("acceptance")?.items ?? []).filter(Boolean);
  if (!fields.has("outOfScope")) return null;
  const outOfScope = (fields.get("outOfScope")?.items ?? []).filter(
    (item) => item && item !== "（无）",
  );
  if (!goal || !pages || !summary || acceptance.length === 0) return null;
  return { goal, pages, acceptance, outOfScope, summary };
}

export function formatChangeCard(card: ChangeCard): string {
  const scope = card.outOfScope.length
    ? card.outOfScope.map((item) => `- ${item}`)
    : ["- （无）"];
  return [
    CARD,
    `goal: ${card.goal}`,
    `pages: ${card.pages}`,
    "acceptance:",
    ...card.acceptance.map((item) => `- ${item}`),
    "outOfScope:",
    ...scope,
    `summary: ${card.summary}`,
  ].join("\n");
}
