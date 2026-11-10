/** "If this changes": what depends on a record, as the page models carry it. The rule is `impactOf` in `@capxul/book`. */
import { impactOf } from "@capxul/book";

import type { ImpactBlock, ImpactRow, Ref } from "../types.ts";
import type { Ctx } from "./context.ts";
import { refOf } from "./locate.ts";

/** The most dependents a page's twins list, nearest first. A record that more depend on is listed up to here; `tools/impact.ts` has the rest. */
const LISTED = 500;

const EMPTY: ImpactBlock = { total: 0, byKind: [], all: [], complete: true, decisions: 0, decisionsOnDependents: 0, evals: 0 };

const refAt = (ctx: Ctx, key: string): Ref | null => {
  const r = ctx.input.book.records.get(key);
  return r ? refOf(r) : null;
};

/** Every record that depends on the page's record, nearest first, counted by kind. */
export const impactBlock = (ctx: Ctx, key: string): ImpactBlock => {
  const found = impactOf(ctx.input.book, key, { index: ctx.impacts });
  if (!found) return EMPTY;
  const whole = !key.startsWith("decision:");
  const all = found.dependents.filter((d) => whole || d.distance === 1).slice(0, LISTED).flatMap((d): readonly ImpactRow[] => {
    const ref = refAt(ctx, d.key);
    const via = refAt(ctx, d.via);
    return ref && via ? [{ ref, kind: d.kind, field: d.field, via, distance: d.distance }] : [];
  });
  return {
    total: found.dependents.length, complete: whole && found.dependents.length <= LISTED, byKind: Object.entries(found.byKind).sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).map(([kind, count]) => ({ kind, count })),
    all, decisions: found.decisions.direct.length, decisionsOnDependents: found.decisions.onDependents.length, evals: found.evals.length,
  };
};
