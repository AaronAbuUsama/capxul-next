/** The Worlds page: the readable design document first, then the operations, journeys, decisions and tables that make the worlds design. */
import type { AnyRecord } from "@capxul/blueprint-engine";

import type { Brief, Section, WorldsPage } from "../types.ts";
import { brief, head, operationRow, type Ctx } from "./context.ts";

/** The records of one kind whose ids are listed, in the listed order; an id the blueprint lacks is skipped (the portal check names it). */
const named = (ctx: Ctx, kind: string, ids: readonly string[]): readonly AnyRecord[] =>
  ids.flatMap((id) => { const r = ctx.input.blueprint.records.get(`${kind}:${id}`); return r ? [r] : []; });

/** A document as its opening text and its `## ` sections. */
export const split = (text: string): { readonly title: string; readonly intro: string; readonly sections: readonly Section[] } => {
  const lines = text.split("\n");
  const title = (lines.find((l) => l.startsWith("# ")) ?? "# Worlds").slice(2).trim();
  const parts: { heading: string; body: string[] }[] = [];
  const intro: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith("```")) inFence = !inFence;
    if (!inFence && line.startsWith("## ")) parts.push({ heading: line.slice(3).trim(), body: [] });
    else if (parts.length > 0) parts[parts.length - 1]?.body.push(line);
    else if (!line.startsWith("# ")) intro.push(line);
  }
  return { title, intro: intro.join("\n").trim(), sections: parts.map((p) => ({ heading: p.heading, body: p.body.join("\n").trim() })) };
};

export const worlds = (ctx: Ctx): WorldsPage => {
  const w = ctx.input.worlds ?? null;
  const doc = split(w?.text ?? "");
  const briefs = (kind: string, ids: readonly string[]): readonly Brief[] => named(ctx, kind, ids).map(brief);
  return {
    ...head("worlds", "Worlds", w?.document ?? "docs/design/worlds-platform.md", null), type: "worlds", commit: ctx.input.commit, present: w !== null,
    intro: doc.intro, sections: doc.sections,
    operations: named(ctx, "operation", w?.operations ?? []).map((op) => operationRow(ctx, op)),
    journeys: briefs("journey", w?.journeys ?? []), decisions: briefs("decision", w?.decisions ?? []), tables: briefs("table", w?.tables ?? []),
  };
};
