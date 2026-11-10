/** Build: every operation with its evals and its stand, first by where it stands, then by concept. */
import { TELEMETRY_RULES, passing } from "@capxul/book";

import type { BuildGaps, BuildPage, Count, OperationRow, Stand } from "../types.ts";
import { head, membersOf, ofKind, operationRow, titleOf, type Ctx } from "./context.ts";
import { EVALS } from "./evalCatalogue.ts";
import { refOf } from "./locate.ts";
import { count } from "./values.ts";

const STANDS: readonly (readonly [Stand, string, string])[] = [
  ["specify", "Still to specify", "still to specify"], ["decide", "Waiting on a decision", "wait on a decision"],
  ["build", "Ready to build", "ready to build"], ["observe", "Proven, not yet seen live", "proven, not seen live"],
  ["done", "Done", "done"],
];

/** The gap rules that name telemetry, and the one that names examples, counted apart from every other gap. */
const gapsOf = (ctx: Ctx): BuildGaps => {
  const gaps = ctx.input.book.gaps;
  const on = (rule: string): number => gaps.filter((g) => g.rule === rule).length;
  const telemetry = TELEMETRY_RULES.map((rule) => ({ rule, count: on(rule) }));
  const examples = on("no-example");
  return { total: gaps.length, telemetry, examples, other: gaps.length - examples - telemetry.reduce((n, t) => n + t.count, 0) };
};

/** The evals whose subject belongs to a concept: records its folder exports. */
const conceptCount = (ctx: Ctx, id: string): Count => {
  const ids = ctx.input.book.evals.filter((e) => ctx.input.conceptOf.get(e.subject) === id).map((e) => e.id);
  return { passing: passing(ctx.input.status, ids), total: ids.length };
};

export const build = (ctx: Ctx): BuildPage => {
  const rows = ofKind(ctx, "operation").map((op) => operationRow(ctx, op));
  const at = (stand: Stand): readonly OperationRow[] => rows.filter((r) => r.stand.stand === stand);
  const here = (anchor: string): { label: string; page: string; anchor: string } => ({ label: anchor, page: "build", anchor });
  const byStand = STANDS.map(([stand, title]) => ({ stand, title, anchor: `stand-${stand}`, rows: at(stand) }));
  const concepts = ctx.input.concepts.flatMap((id) => {
    const c = ctx.input.book.records.get(`concept:${id}`);
    const own = membersOf(ctx, id, "operation").map((op) => operationRow(ctx, op));
    return c && own.length > 0 ? [{ ref: refOf(c), title: titleOf(c), rows: own, passing: conceptCount(ctx, id) }] : [];
  });
  const all = ctx.input.book.evals;
  const total = { passing: passing(ctx.input.status, all.map((e) => e.id)), total: all.length };
  return {
    ...head("build", "Build", "books/target", null), type: "build", operations: rows.length, evals: all.length,
    passing: total, recorded: ctx.input.status !== null, gapCounts: gapsOf(ctx),
    stands: Object.fromEntries(STANDS.map(([stand]) => [stand, at(stand).length])) as Record<Stand, number>,
    tiles: [
      { big: count(rows.length), name: "operations", to: concepts.length > 0 ? here("by-concept") : null },
      ...STANDS.filter(([stand]) => stand === "specify" || stand === "decide" || stand === "build" || at(stand).length > 0)
        .map(([stand, , name]) => ({ big: count(at(stand).length), name, to: at(stand).length > 0 ? here(`stand-${stand}`) : null })),
      { big: `${count(total.passing)} of ${count(all.length)}`, name: "evals passing", to: EVALS },
    ],
    byStand, concepts,
  };
};
