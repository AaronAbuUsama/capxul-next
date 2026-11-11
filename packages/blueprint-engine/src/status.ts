// The status document: what has run, per eval. One file, `status/status.json` at the repository root; absent means
// nothing has run. The blueprint derives the eval ids, so an entry for an id it does not derive is refused.

import { Schema } from "effect";
import type { Blueprint } from "./build.ts";

export const Verdict = Schema.Literals(["pass", "fail", "not_run"]);
export type Verdict = typeof Verdict.Type;

const At = Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/)));
const Nonempty = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

/** What is known about one eval: the verdict, the commit it was run at, when, and optionally which run and where its evidence is. */
export const EvalStatus = Schema.Struct({
  verdict: Verdict,
  commit: Nonempty,
  at: At,
  run: Schema.optionalKey(Nonempty),
  evidence: Schema.optionalKey(Nonempty),
  /** The claim as it read when the verdict was recorded. A verdict whose claim has since changed is stale. */
  claim: Schema.optionalKey(Nonempty),
});
export type EvalStatus = typeof EvalStatus.Type;

export const StatusDocument = Schema.Struct({ version: Schema.Literal(1), evals: Schema.Record(Schema.String, EvalStatus) });
export type StatusDocument = typeof StatusDocument.Type;

/** A results file: one run's verdicts, with the commit, time and run id they share. */
export const ResultsFile = Schema.Struct({
  commit: Nonempty,
  at: At,
  run: Schema.optionalKey(Nonempty),
  results: Schema.Array(Schema.Struct({ id: Nonempty, verdict: Verdict, evidence: Schema.optionalKey(Nonempty) })),
});
export type ResultsFile = typeof ResultsFile.Type;

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly string[] };

const decode = <S extends Schema.Top>(schema: S, what: string, u: unknown): Parsed<S["Type"]> => {
  const r = Schema.decodeUnknownResult(schema as never)(u, { errors: "all" }) as
    { _tag: "Success"; success: S["Type"] } | { _tag: "Failure"; failure: { message: string } };
  return r._tag === "Success"
    ? { ok: true, value: r.success }
    : { ok: false, errors: [`${what}: ${r.failure.message.replace(/\s+/g, " ")}`] };
};

export const parseStatus = (u: unknown): Parsed<StatusDocument> => decode(StatusDocument, "status document", u);
export const parseResults = (u: unknown): Parsed<ResultsFile> => decode(ResultsFile, "results file", u);

/** The ids in a status document that the blueprint does not derive. */
export const unknownEvals = (b: Pick<Blueprint, "evals">, doc: StatusDocument): string[] => {
  const known = new Set(b.evals.map((e) => e.id));
  return Object.keys(doc.evals).filter((id) => !known.has(id)).sort();
};

/** The document with a run's results written in. Refuses the whole run when it names an eval the blueprint does not derive. */
export const mergeResults = (b: Pick<Blueprint, "evals">, doc: StatusDocument | null, run: ResultsFile): Parsed<StatusDocument> => {
  const known = new Set(b.evals.map((e) => e.id));
  const unknown = run.results.filter((r) => !known.has(r.id)).map((r) => r.id);
  if (unknown.length > 0) return { ok: false, errors: unknown.map((id) => `${id}: the blueprint derives no such eval`) };
  const claims = new Map(b.evals.map((e) => [e.id, e.claim]));
  const evals: Record<string, EvalStatus> = { ...(doc?.evals ?? {}) };
  for (const r of run.results)
    evals[r.id] = {
      verdict: r.verdict, commit: run.commit, at: run.at, claim: claims.get(r.id) ?? r.id,
      ...(run.run === undefined ? {} : { run: run.run }), ...(r.evidence === undefined ? {} : { evidence: r.evidence }),
    };
  return { ok: true, value: { version: 1, evals: Object.fromEntries(Object.keys(evals).sort().map((id) => [id, evals[id] as EvalStatus])) } };
};

/** The verdict of an eval: `not_run` when the document is absent or has no entry for it. */
export const verdictOf = (doc: StatusDocument | null, id: string): Verdict => doc?.evals[id]?.verdict ?? "not_run";

/** How many of these evals pass. */
export const passing = (doc: StatusDocument | null, ids: readonly string[]): number =>
  ids.filter((id) => verdictOf(doc, id) === "pass").length;

/**
 * The ids whose verdict no longer speaks for the blueprint: the eval's claim changed since the verdict was recorded,
 * the entry records no claim, or the blueprint no longer derives the id (an eval renumbered or removed).
 */
export const staleEvals = (b: Pick<Blueprint, "evals">, doc: StatusDocument | null): string[] => {
  const claims = new Map(b.evals.map((e) => [e.id, e.claim]));
  return Object.entries(doc?.evals ?? {})
    .filter(([id, s]) => s.verdict !== "not_run" && (!claims.has(id) || s.claim !== claims.get(id)))
    .map(([id]) => id)
    .sort();
};

/** The document with every stale verdict taken out, so a stale pass counts as not run. Read verdicts through this. */
export const freshStatus = (b: Pick<Blueprint, "evals">, doc: StatusDocument | null): StatusDocument | null => {
  if (doc === null) return null;
  const stale = new Set(staleEvals(b, doc));
  return { version: 1, evals: Object.fromEntries(Object.entries(doc.evals).filter(([id]) => !stale.has(id))) };
};
