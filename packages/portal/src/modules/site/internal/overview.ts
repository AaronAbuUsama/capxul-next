/** The Overview: where the blueprint stands, what waits for Aaron, what the blueprint holds, and the concepts. */
import { passing } from "@capxul/blueprint-engine";

import type { ClimbCard, ConceptCard, OverviewPage, Ref } from "../types.ts";
import { catalogueOf } from "./catalogue.ts";
import { findingRows, head, membersOf, ofKind, titleOf, type Ctx } from "./context.ts";
import { EVALS } from "./evalCatalogue.ts";
import { hasPage, refOf } from "./locate.ts";
import { goalSummary } from "./plan.ts";
import { HAND_WRITTEN, inbox } from "./questions.ts";
import { count, plural } from "./values.ts";

/** Empty when none, full when all, split between. */
const barOf = (n: number, of: number): ClimbCard["bar"] => (n === 0 ? "empty" : n === of ? "full" : "split");

const HOLDS: readonly (readonly [string, string])[] = [
  ["operation", "operations"], ["decision", "decisions"], ["table", "tables"], ["event", "events"], ["error", "errors"],
  ["machine", "state machines"], ["rpc", "rpcs"], ["contract", "contracts"], ["flow", "flows"],
  ["workflow", "workflows"], ["journey", "journeys"],
];

export const NAV: readonly Ref[] = [
  { label: "Overview", page: "index", anchor: "" }, { label: "Plan", page: "plan", anchor: "" }, { label: "Questions", page: "review", anchor: "" },
  { label: "Worlds", page: "worlds", anchor: "" }, { label: "Concepts", page: "index", anchor: "concepts" }, { label: "Architecture", page: "design", anchor: "" },
  { label: "Build", page: "build", anchor: "" }, { label: "Docs", page: "docs", anchor: "" },
];

const climb = (ctx: Ctx): readonly ClimbCard[] => {
  const { blueprint, direction } = ctx.input;
  const decisions = ofKind(ctx, "decision").length;
  const waiting = ctx.waiting.length;
  const operations = ofKind(ctx, "operation").length;
  const built = [...ctx.stands.values()].filter((s) => s.stand.stand === "observe" || s.stand.stand === "done").length;
  const proven = passing(ctx.input.status, blueprint.evals.map((e) => e.id));
  return [
    { step: "Specify", status: direction.climb.specify, tone: "blue", big: plural(blueprint.records.size, "record"),
      sub: `${plural(blueprint.problems.length, "problem")}, ${plural(blueprint.gaps.length, "gap")}, ${plural(ctx.input.concepts.length, "concept")}`, bar: "full" },
    { step: "Decide", status: waiting > 0 ? `${count(waiting)} wait for you` : "Nothing waits for you", tone: waiting > 0 ? "orange" : "blue",
      big: plural(decisions, "decision"), sub: `${count(decisions - waiting)} made, ${count(waiting)} waiting`, bar: waiting > 0 ? "split" : "full" },
    { step: "Build", status: direction.climb.build, tone: "grey", big: `${count(built)} of ${count(operations)}`,
      sub: "operations built", bar: barOf(built, operations) },
    { step: "Prove", status: direction.climb.prove, tone: "grey", big: `${count(proven)} of ${count(blueprint.evals.length)}`,
      sub: ctx.input.status === null ? "evals run against real code" : "evals passing against real code", bar: barOf(proven, blueprint.evals.length) },
  ];
};

const conceptCards = (ctx: Ctx): readonly ConceptCard[] =>
  ctx.input.concepts.flatMap((id) => {
    const c = ctx.input.blueprint.records.get(`concept:${id}`);
    return c ? [{ ref: refOf(c), title: titleOf(c), verdict: ctx.input.direction.verdicts[id] ?? "none",
      operations: membersOf(ctx, id, "operation").length, decisions: membersOf(ctx, id, "decision").length }] : [];
  });

export const overview = (ctx: Ctx): OverviewPage => {
  const { blueprint, direction, commit } = ctx.input;
  const concepts = conceptCards(ctx);
  const paged = [...ctx.byKind].filter(([kind]) => hasPage(kind));
  return {
    ...head("index", "Overview", HAND_WRITTEN, null), type: "overview", commit,
    planNote: ctx.input.plan?.plan.notes[ctx.input.plan.plan.notes.length - 1] ?? null, inbox: inbox(ctx).length, planGoal: goalSummary(ctx.input.plan?.files.outline ?? null),
    hero: direction.hero, needsYou: direction.needsYou, banner: direction.banner, climb: climb(ctx),
    verdicts: { given: concepts.filter((c) => c.verdict !== "none").length, of: concepts.length },
    waiting: inbox(ctx),
    holds: [...HOLDS.slice(0, 1), ["", "evals"] as const, ...HOLDS.slice(1)].map(([kind, name]) => ({
      big: count(kind === "" ? blueprint.evals.length : ofKind(ctx, kind).length), name, to: kind === "" ? EVALS : catalogueOf(kind),
    })),
    concepts, counts: Object.fromEntries([...ctx.byKind].map(([kind, held]) => [kind, held.length])), evals: blueprint.evals.length,
    problems: findingRows(blueprint.problems), gaps: findingRows(blueprint.gaps), nav: ctx.input.worlds ? NAV : NAV.filter((r) => r.page !== "worlds"),
    sitemap: Object.fromEntries(paged.map(([kind, held]) => [kind, held.map((r) => r.id)])),
  };
};
