/**
 * The Blueprint page: docs/blueprint-guide.md as written, split into its `## ` sections, with each
 * `<!-- generated: <name> -->` line replaced by a table made from the real blueprint, the status document and the
 * bindings. A marker that names no table here is kept on the page model, and the portal check fails on it.
 */
import { keyOf, type AnyRecord, type Finding } from "@capxul/blueprint-engine";

import type { GuideInput, GuidePage, GuidePart, GuideSection } from "../guide-types.ts";
import type { TableSection } from "../types.ts";
import { head, sourceOf, standOf, titleOf, type Ctx } from "./context.ts";
import { RULE_WORDS } from "./guideWords.ts";
import { bindingOf, guideTables } from "./guideTables.ts";
import { refOf } from "./locate.ts";
import { code, row, tableOf, to, words } from "./table.ts";
import { count, field, list, text } from "./values.ts";
import { split } from "./worlds.ts";

export const GUIDE_PAGE = "blueprint";
const MARKER = /^<!--\s*generated:\s*([a-z-]+)\s*-->$/;

/** Markdown with its marker lines turned into tables; `unknown` collects the markers no table answers. */
const partsOf = (md: string, tables: ReadonlyMap<string, () => TableSection>, unknown: string[]): readonly GuidePart[] => {
  const parts: GuidePart[] = [];
  let buffer: string[] = [];
  const flush = (): void => { const t = buffer.join("\n").trim(); if (t !== "") parts.push({ t: "md", text: t }); buffer = []; };
  for (const line of md.split("\n")) {
    const m = MARKER.exec(line.trim());
    if (!m) { buffer.push(line); continue; }
    flush();
    const make = tables.get(m[1] ?? "");
    if (make) parts.push({ t: "table", table: make() }); else unknown.push(m[1] ?? "");
  }
  flush();
  return parts;
};

const anchorOf = (heading: string): string => heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const guide = (ctx: Ctx): GuidePage => {
  const g = ctx.input.guide ?? null;
  const doc = split(g?.text ?? "");
  const unknown: string[] = [];
  const tables = g ? guideTables(ctx, g, { follow: followTable, followEvals, rules: rulesTable }) : new Map<string, () => TableSection>();
  const sections: GuideSection[] = doc.sections.map((s) => ({ heading: s.heading, anchor: anchorOf(s.heading), parts: partsOf(s.body, tables, unknown) }));
  return {
    ...head(GUIDE_PAGE, "The blueprint", g?.document ?? "docs/blueprint-guide.md", null), type: "guide", commit: ctx.input.commit,
    present: g !== null, intro: partsOf(doc.intro, tables, unknown), sections, unknownMarkers: unknown,
  };
};

// ── the record followed end to end ─────────────────────────────────────────────────────────────

const followTable = (ctx: Ctx, g: GuideInput): TableSection => {
  const op = ctx.input.blueprint.records.get(`operation:${g.follow.operation}`);
  const title = `Followed: ${g.follow.operation}, acceptance line ${g.follow.line}`;
  const empty = `The blueprint holds no operation ${g.follow.operation}, so there is nothing to follow; change the operation the page follows in the portal's loader.`;
  if (!op) return tableOf("followed", title, ["Step", "What it holds", "Where"], [], { empty });
  // an as-is line is plain text, a target line is {claim, observes}
  const raw = list(op["acceptance"])[g.follow.line - 1];
  const line = typeof raw === "string" ? { claim: raw, observes: "" } : { claim: text(field(raw, "claim")), observes: text(field(raw, "observes")) };
  const id = `acc:${op.id}/${g.follow.line}`;
  const entry = ctx.input.status?.evals[id];
  const bound = bindingOf(g, id);
  const impl = op["implementedBy"] as AnyRecord | undefined;
  const implRec = impl ? ctx.input.blueprint.records.get(keyOf(impl)) : undefined;
  const stand = standOf(ctx, op);
  const rows = [
    row([words("1. The record"), to(refOf(op), line.claim), code(`${sourceOf(ctx, op)}/`)]),
    row([words("2. What a run observes"), words(line.observes), code(`acceptance[${g.follow.line - 1}].observes`)]),
    row([words("3. What answers it"), implRec ? to(refOf(implRec), titleOf(implRec)) : words("nothing is named"), code("implementedBy")]),
    row([words("4. The eval it implies"), code(id), code("packages/blueprint-engine/src/evals.ts")]),
    row([words("5. The binding"), words(bound ? `${bound.near ? "Near-miss only, never scores. Missing: " : ""}${bound.checks.join(", ")}. ${bound.words}` : "No check is bound to it, so it is not run."), code(bound?.file ?? "evals/bindings/")]),
    row([words("6. The verdict"), words(entry ? `${entry.verdict}, run ${entry.run ?? "unnamed"} at commit ${entry.commit}, ${entry.at}` : "not_run: no run has recorded it"), code("status/status.json")]),
    row([words("7. The evidence"), entry?.evidence ? code(entry.evidence) : words("none recorded"), code("status/runs/")]),
    row([words("8. Where the operation stands"), words(`${stand.stand}: ${stand.why}`), code("packages/blueprint-engine/src/stand.ts")]),
  ];
  return tableOf("followed", title, ["Step", "What it holds", "Where"], rows,
    { caption: "Read top to bottom: the record, the eval the build derives from it, the check that proves it and the verdict a run wrote." });
};

const followEvals = (ctx: Ctx, g: GuideInput): TableSection => {
  const held = ctx.evals.get(`operation:${g.follow.operation}`) ?? [];
  const rows = held.map((e) => {
    const b = bindingOf(g, e.id);
    return row([code(e.id), words(e.claim), words(e.decider), words(b ? (b.near ? "near-miss" : "bound") : "no check"), words(ctx.input.status?.evals[e.id]?.verdict ?? "not_run")]);
  });
  return tableOf("followed-evals", `Every eval on ${g.follow.operation}`, ["Eval", "Claim", "Decided by", "Check", "Verdict"], rows,
    { caption: `${count(rows.length)} evals on the operation itself; the records under it carry more, listed on its page.`, empty: "The operation has no evals." });
};

// ── the rules ──────────────────────────────────────────────────────────────────────────────────

const byRule = (held: readonly Finding[]): ReadonlyMap<string, number> => {
  const out = new Map<string, number>();
  for (const f of held) out.set(f.rule, (out.get(f.rule) ?? 0) + 1);
  return out;
};

const rulesTable = (ctx: Ctx, kind: "problem" | "gap"): TableSection => {
  const b = ctx.input.blueprint;
  const problems = byRule(b.problems), gaps = byRule(b.gaps), standing = byRule(b.standing);
  const known = RULE_WORDS.filter((r) => r.kind === kind);
  const seen = new Set(known.map((r) => r.rule));
  const extra = [...(kind === "problem" ? problems : new Map([...gaps, ...standing])).keys()].filter((r) => !seen.has(r)).sort();
  const rows = [...known, ...extra.map((rule) => ({ rule, kind, means: "Not explained on this page yet: read its detail on the record's page." }))].map((r) =>
    kind === "problem"
      ? row([code(r.rule), words(r.means), words(count(problems.get(r.rule) ?? 0))])
      : row([code(r.rule), words(r.means), words(count(gaps.get(r.rule) ?? 0)), words(count(standing.get(r.rule) ?? 0))]));
  return kind === "problem"
    ? tableOf("problem-rules", "Rules that find problems", ["Rule", "What it means", "Problems now"], rows,
      { caption: `${count(b.problems.length)} problems at this commit. Any problem fails the build.` })
    : tableOf("gap-rules", "Rules that find gaps", ["Rule", "What it means", "Open", "Standing"], rows,
      { caption: `${count(b.gaps.length)} open gaps and ${count(b.standing.length)} that stand for a recorded reason at this commit.` });
};
