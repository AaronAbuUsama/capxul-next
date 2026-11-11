/**
 * The tables the Blueprint page makes from the real blueprint, by the name a `<!-- generated: <name> -->` line gives.
 * Every number here is counted at generation, so the page says what is true at its commit.
 */
import type { AnyRecord } from "@capxul/blueprint-engine";

import type { GuideInput } from "../guide-types.ts";
import type { TableSection } from "../types.ts";
import { membersOf, ofKind, titleOf, type Ctx } from "./context.ts";
import { evalKind, inOrder, kindOf } from "./evalKinds.ts";
import { KIND_WORDS } from "./guideWords.ts";
import { refOf } from "./locate.ts";
import { code, many, row, tableOf, to, words } from "./table.ts";
import { count, objects, records } from "./values.ts";

type Maker = (ctx: Ctx, g: GuideInput) => TableSection;
export interface Makers { readonly follow: Maker; readonly followEvals: Maker; readonly rules: (ctx: Ctx, kind: "problem" | "gap") => TableSection }

/** The binding of an eval, if a file binds it or lists it as a near-miss. */
export const bindingOf = (g: GuideInput, id: string) => {
  for (const f of g.bindings) {
    const b = f.bindings.find((x) => x.eval === id);
    if (b) return { file: f.file, checks: b.checks, words: b.why, near: false };
    const n = f.near.find((x) => x.eval === id);
    if (n) return { file: f.file, checks: n.checks, words: n.missing, near: true };
  }
  return null;
};

const verdictOf = (ctx: Ctx, id: string): string => ctx.input.status?.evals[id]?.verdict ?? "not_run";
const n = (x: number): ReturnType<typeof words> => words(count(x));

const now: Maker = (ctx, g) => {
  const b = ctx.input.blueprint;
  const ops = ofKind(ctx, "operation");
  const kept = ops.filter((o) => ctx.input.frozenOperations.has(o.id)).length;
  const cut = Object.values(g.cut).reduce((a, x) => a + x, 0);
  const bound = g.bindings.flatMap((f) => f.bindings.map((x) => x.eval));
  const verdicts = Object.values(ctx.input.status?.evals ?? {});
  const rows = [
    row([words("Records"), n(b.records.size), code("blueprint/index.ts")]),
    row([words("Concepts"), n(ofKind(ctx, "concept").length), code("blueprint/shared/foundation.ts")]),
    row([words("Operations (CLI commands)"), words(`${count(ops.length)}: ${count(kept)} of the old system's ${count(ctx.input.frozenOperations.size)} and ${count(ops.length - kept)} new`), code("blueprint/<concept>/operations.ts")]),
    row([words("Old operations the cut classifies instead"), words(`${count(cut)}: ${Object.entries(g.cut).map(([fate, x]) => `${count(x)} ${fate}`).join(", ")}`), code("blueprint/shared/cut.ts")]),
    row([words("Decisions"), words(`${count(ofKind(ctx, "decision").length)}, of which ${count(ctx.waiting.length)} ${ctx.waiting.length === 1 ? "waits" : "wait"} for Aaron`), code("blueprint/<concept>/decisions.ts")]),
    row([words("Evals the records imply"), n(b.evals.length), code("packages/blueprint-engine/src/evals.ts")]),
    row([words("Problems"), n(b.problems.length), code("pnpm blueprint")]),
    row([words("Open gaps"), n(b.gaps.length), code("pnpm blueprint")]),
    row([words("Gaps that stand for a recorded reason"), n(b.standing.length), code("decision stands")]),
    row([words("Evals bound to a check"), words(`${count(bound.length)}, plus ${count(g.bindings.reduce((a, f) => a + f.near.length, 0))} near-misses that never score`), code("evals/bindings/")]),
    row([words("Evals with a verdict"), words(`${count(verdicts.length)}: ${count(verdicts.filter((v) => v.verdict === "pass").length)} pass, ${count(verdicts.filter((v) => v.verdict === "fail").length)} fail, ${count(verdicts.filter((v) => v.verdict === "not_run").length)} not run`), code("status/status.json")]),
  ];
  return tableOf("now", "The blueprint at this commit", ["What", "How many", "Where it lives"], rows,
    { caption: `Counted when this page was generated, at commit ${ctx.input.commit}.` });
};

const kinds: Maker = (ctx) => {
  const held = [...new Set([...ctx.input.blueprint.records.values()].map((r) => r._kind))];
  const order = Object.keys(KIND_WORDS);
  const rows = held.toSorted((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b, "en")).map((kind) => {
    const w = KIND_WORDS[kind];
    const listed = w?.catalogue ? to({ label: w.catalogue, page: `docs/${w.catalogue}`, anchor: "" }) : words(kind === "concept" ? "Concepts, on the Overview" : "its parent's page");
    return row([code(kind), n(ofKind(ctx, kind).length), words(w?.one ?? "Not explained on this page yet."), listed]);
  });
  return tableOf("kinds", "Every kind of record", ["Kind", "Records", "What one is", "Listed in"], rows,
    { caption: "Each kind is one define function in packages/blueprint-engine/src/records, with an Effect Schema its records are checked against." });
};

const concepts: Maker = (ctx) => {
  const rows = ctx.input.concepts.flatMap((id) => { const c = ctx.input.blueprint.records.get(`concept:${id}`); return c ? [c] : []; }).map((c) => {
    const evals = ctx.input.blueprint.evals.filter((e) => ctx.input.conceptOf.get(e.subject) === c.id).length;
    return row([to(refOf(c)), code(`blueprint/${c.id}/`), many(records(c["dependsOn"]).map(refOf)),
      n(membersOf(ctx, c.id, "operation").length), n(membersOf(ctx, c.id, "table").length), n(membersOf(ctx, c.id, "decision").length), n(evals)]);
  });
  return tableOf("concept-folders", "The concepts and their folders", ["Concept", "Folder", "May depend on", "Operations", "Tables", "Decisions", "Evals"], rows,
    { caption: "In dependency order. A concept may read or call only the concepts it depends on, and never write their tables." });
};

const evalKinds: Maker = (ctx) => {
  const all = ctx.input.blueprint.evals;
  const rows = inOrder(all.map((e) => kindOf(e.id))).map((kind) => {
    const held = all.filter((e) => kindOf(e.id) === kind);
    const info = evalKind(kind);
    return row([to({ label: kind, page: `eval/${kind}`, anchor: "" }, info.name), words([...new Set(held.map((e) => e.level))].join(", ")),
      n(held.length), n(held.filter((e) => verdictOf(ctx, e.id) === "pass").length), words(info.claims || "Not explained on this page yet.")]);
  });
  return tableOf("eval-kinds", "Every kind of eval", ["Kind", "Level", "Evals", "Passing", "What it claims"], rows,
    { caption: `${count(all.length)} evals in all. Each kind links to its catalogue, which lists every one.` });
};

const score: Maker = (ctx, g) => {
  const rows = g.bindings.map((f) => {
    const ids = f.bindings.map((b) => b.eval);
    const of = (v: string): number => ids.filter((id) => verdictOf(ctx, id) === v).length;
    return row([code(f.file), code(f.script), n(ids.length), n(f.near.length), n(of("pass")), n(of("fail")), n(ids.length - of("pass") - of("fail"))]);
  });
  return tableOf("bindings", "The bindings, area by area", ["File", "Script", "Bound evals", "Near-misses", "Pass", "Fail", "No verdict"], rows,
    { caption: "An eval counts only once a bound check has passed in a run. A bound eval with no verdict has not been run at this commit, or its last run did not finish its checks.", empty: "No binding files: nothing is proved yet." });
};

const bound: Maker = (ctx, g) => {
  const rows = g.bindings.flatMap((f) => f.bindings.map((b) => {
    const entry = ctx.input.status?.evals[b.eval];
    return row([code(b.eval), code(f.area), words(b.checks.join(", ")), words(entry ? `${entry.verdict} at ${entry.commit}` : "not_run: no run recorded")]);
  }));
  return tableOf("bound-evals", "Every bound eval and its verdict", ["Eval", "Area", "Checks that prove it", "Verdict"], rows, { empty: "No eval is bound yet." });
};

const standing: Maker = (ctx) => {
  const held = new Map<string, { gaps: number; rules: Set<string> }>();
  for (const s of ctx.input.blueprint.standing) {
    const e = held.get(s.decision) ?? { gaps: 0, rules: new Set<string>() };
    e.gaps++; e.rules.add(s.rule); held.set(s.decision, e);
  }
  const rows = [...held].sort((a, b) => b[1].gaps - a[1].gaps || a[0].localeCompare(b[0], "en")).slice(0, 12).map(([id, e]) => {
    const d = ctx.input.blueprint.records.get(`decision:${id}`) as AnyRecord | undefined;
    return row([d ? to(refOf(d), titleOf(d)) : code(id), n(e.gaps), words([...e.rules].sort().join(", "))]);
  });
  return tableOf("standing", "Decisions holding the most standing gaps", ["Decision", "Gaps it holds", "Rules"], rows,
    { caption: `${count(held.size)} decisions hold the ${count(ctx.input.blueprint.standing.length)} standing gaps; the twelve that hold the most are here.`, empty: "No gap stands for a recorded reason." });
};

const unchecked: Maker = (ctx, g) => {
  const ds = ofKind(ctx, "decision");
  const offList = ds.filter((d) => !objects(d["options"]).some((o) => o["label"] === d["chosen"])).length;
  const live = ctx.input.blueprint.evals.filter((e) => e.level === "L4").length;
  const done = ofKind(ctx, "operation").filter((o) => ctx.stands.get(`operation:${o.id}`)?.stand.stand === "done").length;
  const yes = (b: boolean): string => (b ? "yes" : "no");
  const rows = [
    row([words("Folders of generated code (src/generated)"), n(g.repo.generatedFolders), code("packages/*/src/generated")]),
    row([words("Live (L4) evals the build derives"), n(live), code("packages/blueprint-engine/src/evals.ts")]),
    row([words("Operations at the done stand"), n(done), code("packages/blueprint-engine/src/stand.ts")]),
    row([words("pnpm test runs pnpm blueprint"), words(yes(g.repo.testRunsBlueprint)), code("package.json")]),
    row([words("pnpm test runs pnpm frozen"), words(yes(g.repo.testRunsFrozen)), code("package.json")]),
    row([words("CI workflows in the repository"), n(g.repo.ciWorkflows), code(".github/workflows/")]),
    row([words("Decisions whose choice is not one of their options"), n(offList), code("blueprint/**/decisions.ts")]),
  ];
  return tableOf("checked-today", "Checked again on every generation", ["Fact", "Now", "Read from"], rows,
    { caption: "The statements above, counted from the repository each time this page is made: when one changes, this table shows it before the words are updated." });
};

/** Every table the page can make, by marker name. */
export const guideTables = (ctx: Ctx, g: GuideInput, m: Makers): ReadonlyMap<string, () => TableSection> => new Map<string, () => TableSection>([
  ["now", () => now(ctx, g)], ["kinds", () => kinds(ctx, g)], ["concepts", () => concepts(ctx, g)],
  ["follow", () => m.follow(ctx, g)], ["follow-evals", () => m.followEvals(ctx, g)], ["eval-kinds", () => evalKinds(ctx, g)],
  ["score", () => score(ctx, g)], ["bound", () => bound(ctx, g)], ["problems", () => m.rules(ctx, "problem")], ["gaps", () => m.rules(ctx, "gap")],
  ["standing", () => standing(ctx, g)], ["unchecked", () => unchecked(ctx, g)],
]);

