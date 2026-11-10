/** The Overview: where the book stands, what waits for Aaron, what the book holds, and the concepts. */
import type { ClimbCard, ConceptCard, OverviewPage, Ref } from "../types.ts";
import { catalogueOf } from "./catalogue.ts";
import { findingRows, head, membersOf, ofKind, titleOf, type Ctx } from "./context.ts";
import { EVALS } from "./evalCatalogue.ts";
import { hasPage, refOf } from "./locate.ts";
import { HAND_WRITTEN, questionOf } from "./questions.ts";
import { count, plural } from "./values.ts";

/** No verdict is recorded anywhere yet, so nothing is built and nothing is proven. The ledger replaces this. */
const VERDICTS_PASSED = 0;

const HOLDS: readonly (readonly [string, string])[] = [
  ["operation", "operations"], ["decision", "decisions"], ["table", "tables"], ["event", "events"], ["error", "errors"],
  ["machine", "state machines"], ["rpc", "rpcs"], ["contract", "contracts"], ["flow", "flows"],
  ["workflow", "workflows"], ["journey", "journeys"],
];

export const NAV: readonly Ref[] = [
  { label: "Overview", page: "index", anchor: "" }, { label: "Questions", page: "review", anchor: "" },
  { label: "Concepts", page: "index", anchor: "concepts" }, { label: "Architecture", page: "design", anchor: "" },
  { label: "Build", page: "build", anchor: "" }, { label: "Docs", page: "docs", anchor: "" },
];

const climb = (ctx: Ctx): readonly ClimbCard[] => {
  const { book, direction } = ctx.input;
  const decisions = ofKind(ctx, "decision").length;
  const waiting = ctx.waiting.length;
  return [
    { step: "Specify", status: direction.climb.specify, tone: "blue", big: plural(book.records.size, "record"),
      sub: `${plural(book.problems.length, "problem")}, ${plural(book.gaps.length, "gap")}, ${plural(ctx.input.concepts.length, "concept")}`, bar: "full" },
    { step: "Decide", status: waiting > 0 ? `${count(waiting)} wait for you` : "Nothing waits for you", tone: waiting > 0 ? "orange" : "blue",
      big: plural(decisions, "decision"), sub: `${count(decisions - waiting)} made, ${count(waiting)} waiting`, bar: waiting > 0 ? "split" : "full" },
    { step: "Build", status: direction.climb.build, tone: "grey", big: `${VERDICTS_PASSED} of ${count(ofKind(ctx, "operation").length)}`,
      sub: "operations built", bar: "empty" },
    { step: "Prove", status: direction.climb.prove, tone: "grey", big: `${VERDICTS_PASSED} of ${count(book.evals.length)}`,
      sub: "evals run against real code", bar: "empty" },
  ];
};

const conceptCards = (ctx: Ctx): readonly ConceptCard[] =>
  ctx.input.concepts.flatMap((id) => {
    const c = ctx.input.book.records.get(`concept:${id}`);
    return c ? [{ ref: refOf(c), title: titleOf(c), verdict: ctx.input.direction.verdicts[id] ?? "none",
      operations: membersOf(ctx, id, "operation").length, decisions: membersOf(ctx, id, "decision").length }] : [];
  });

export const overview = (ctx: Ctx): OverviewPage => {
  const { book, direction, commit } = ctx.input;
  const concepts = conceptCards(ctx);
  const paged = [...ctx.byKind].filter(([kind]) => hasPage(kind));
  return {
    ...head("index", "Overview", HAND_WRITTEN, null), type: "overview", commit,
    hero: direction.hero, needsYou: direction.needsYou, banner: direction.banner, climb: climb(ctx),
    verdicts: { given: concepts.filter((c) => c.verdict !== "none").length, of: concepts.length },
    waiting: ctx.waiting.map((d) => questionOf(ctx, d)),
    holds: [...HOLDS.slice(0, 1), ["", "evals"] as const, ...HOLDS.slice(1)].map(([kind, name]) => ({
      big: count(kind === "" ? book.evals.length : ofKind(ctx, kind).length), name, to: kind === "" ? EVALS : catalogueOf(kind),
    })),
    concepts, counts: Object.fromEntries([...ctx.byKind].map(([kind, held]) => [kind, held.length])), evals: book.evals.length,
    problems: findingRows(book.problems), gaps: findingRows(book.gaps), nav: NAV,
    sitemap: Object.fromEntries(paged.map(([kind, held]) => [kind, held.map((r) => r.id)])),
  };
};
