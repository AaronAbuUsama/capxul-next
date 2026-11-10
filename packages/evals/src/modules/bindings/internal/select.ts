/** What to run, as the eval ids it means. */
import type { Bindings, Gaps, Index, Result, ScriptChecks, What } from "../types.ts";

/** `all` is every eval that has a check; the others name evals, which may have none (they then stay `not_run`). */
export const select = (what: What, index: Index, bindings: Bindings): Result<readonly string[]> => {
  if (what.kind === "all") return { ok: true, value: [...bindings.byEval.keys()].sort() };
  if (what.kind === "evals") return { ok: true, value: [...new Set(what.ids)] };
  const ids = what.kind === "journey" ? index.journey(what.id) : index.milestone(what.id);
  return ids === null ? { ok: false, errors: [`no ${what.kind} ${what.id}`] } : { ok: true, value: [...new Set(ids)].sort() };
};

/** The three gap lists: checks with no eval, checks that prove only part of one, and the given evals with no check. */
export const gaps = (bindings: Bindings, scripts: ReadonlyMap<string, ScriptChecks>, wanted: readonly string[]): Gaps => {
  const bound = new Set(bindings.files.flatMap((f) => f.bindings.flatMap((b) => b.checks)));
  const near = new Set(bindings.files.flatMap((f) => f.near.flatMap((n) => n.checks)));
  const nearEvals = new Set(bindings.files.flatMap((f) => f.near.map((n) => n.eval)));
  const all = [...scripts.values()].flatMap((s) => [...s.checks]).sort();
  return {
    checksWithNoEval: all.filter((c) => !bound.has(c) && !near.has(c)),
    checksInNearMisses: all.filter((c) => !bound.has(c) && near.has(c)),
    evalsWithNoCheck: wanted.filter((id) => !bindings.byEval.has(id)).map((id) => ({ id, near: nearEvals.has(id) })),
  };
};
