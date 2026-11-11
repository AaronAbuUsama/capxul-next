/** The Overview: where the blueprint stands, what waits for Aaron, what the blueprint holds, and the concepts. */
import { passing } from "@capxul/blueprint-engine";

import type { ClimbCard, ConceptCard, OverviewPage, Ref } from "../types.ts";
import { catalogueOf } from "./catalogue.ts";
import { findingRows, head, membersOf, ofKind, titleOf, type Ctx } from "./context.ts";
import { EVALS } from "./evalCatalogue.ts";
import { hasPage, refOf } from "./locate.ts";
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
  { label: "Overview", page: "index", anchor: "" }, { label: "Questions", page: "review", anchor: "" },
  { label: "Worlds", page: "worlds", anchor: "" }, { label: "Blueprint", page: "blueprint", anchor: "" }, { label: "Concepts", page: "index", anchor: "concepts" }, { label: "Architecture", page: "design", anchor: "" },
  { label: "Build", page: "build", anchor: "" }, { label: "Docs", page: "docs", anchor: "" },
];

const climb = (ctx: Ctx): readonly ClimbCard[] => {
  const { blueprint } = ctx.input;
  const decisions = ofKind(ctx, "decision").length;
  const waiting = inbox(ctx).length;
  const operations = ofKind(ctx, "operation").length;
  const built = [...ctx.stands.values()].filter((s) => s.stand.stand === "observe" || s.stand.stand === "done").length;
  const proven = passing(ctx.input.status, blueprint.evals.map((e) => e.id));
  return [
    { step: "Specify", status: `${plural(blueprint.problems.length, "problem")}, ${plural(blueprint.gaps.length, "gap")}`, tone: "blue", big: plural(blueprint.records.size, "record"),
      sub: `${plural(blueprint.problems.length, "problem")}, ${plural(blueprint.gaps.length, "gap")}, ${plural(ctx.input.concepts.length, "concept")}`, bar: "full" },
    { step: "Decide", status: waiting > 0 ? `${count(waiting)} wait for you` : "Nothing waits for you", tone: waiting > 0 ? "orange" : "blue",
      big: plural(waiting, "question"), sub: `${plural(decisions, "decision")} in the blueprint`, bar: waiting > 0 ? "split" : "full" },
    { step: "Build", status: `${count(built)} at observe or done`, tone: "grey", big: `${count(built)} of ${count(operations)}`,
      sub: "operations at observe or done", bar: barOf(built, operations) },
    { step: "Prove", status: `${count(proven)} passing`, tone: "grey", big: `${count(proven)} of ${count(blueprint.evals.length)}`,
      sub: "evals with recorded passing verdicts", bar: barOf(proven, blueprint.evals.length) },
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
    inbox: inbox(ctx).length,
    hero: direction.hero, needsYou: direction.needsYou, banner: direction.banner, climb: climb(ctx),
    verdicts: { given: concepts.filter((c) => c.verdict !== "none").length, of: concepts.length },
    waiting: inbox(ctx),
    holds: [...HOLDS.slice(0, 1), ["", "evals"] as const, ...HOLDS.slice(1)].map(([kind, name]) => ({
      big: count(kind === "" ? blueprint.evals.length : ofKind(ctx, kind).length), name, to: kind === "" ? EVALS : catalogueOf(kind),
    })),
    concepts, counts: Object.fromEntries([...ctx.byKind].map(([kind, held]) => [kind, held.length])), evals: blueprint.evals.length,
    problems: findingRows(blueprint.problems), gaps: findingRows(blueprint.gaps), nav: NAV.filter((r) => (r.page !== "worlds" || ctx.input.worlds) && (r.page !== "blueprint" || ctx.input.guide)),
    sitemap: Object.fromEntries(paged.map(([kind, held]) => [kind, held.map((r) => r.id)])),
  };
};
