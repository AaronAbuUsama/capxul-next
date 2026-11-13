// The status document: what has run, per eval. One file, `status/status.json` at the repository root; absent means
// nothing has run. The blueprint derives the eval ids, so an entry for an id it does not derive is refused.

import { Schema } from "effect";
import type { Blueprint } from "./build.ts";

export const Verdict = Schema.Literals(["pass", "fail", "not_run"]);
export type Verdict = typeof Verdict.Type;

const At = Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/)));
const Nonempty = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

export const RunEnvironment = Schema.Struct({
  world: Nonempty,
  storage: Schema.Literals(["json", "postgres"]),
  indexer: Schema.Literals(["inline", "ponder"]),
  stack: Nonempty,
  components: Schema.Record(Schema.String, Nonempty),
  chainId: Schema.optionalKey(Schema.Int),
  databaseSchemaVersion: Schema.optionalKey(Nonempty),
});
export type RunEnvironment = typeof RunEnvironment.Type;

/** Paths are relative to this run's directory, never a URL or a path outside it. */
const RelativePath = Nonempty.pipe(Schema.check(Schema.isPattern(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*[:\\]).+$/)));
export const ScreenEvidence = Schema.Struct({ screen: Nonempty, path: RelativePath, source: Nonempty, assertion: Nonempty });
export type ScreenEvidence = typeof ScreenEvidence.Type;
/** The value a screen source names: `file#pointer`, the pointer per RFC 6901 ("" or "/a/b", with ~1 for "/" and ~0 for "~"),
 * following only own properties. `undefined` when the pointer is malformed or names nothing. */
export const pointerValue = (doc: unknown, pointer: string): unknown => {
  if (pointer !== "" && !pointer.startsWith("/")) return undefined;
  let at = doc;
  for (const token of pointer === "" ? [] : pointer.slice(1).split("/").map((t) => t.replaceAll("~1", "/").replaceAll("~0", "~"))) {
    if (at === null || typeof at !== "object" || !Object.hasOwn(at, token)) return undefined;
    at = (at as Record<string, unknown>)[token];
  }
  return at;
};

/** Written before execution, finalized after it. Missing or running receipts cannot establish completion. */
export const RunReceipt = Schema.Struct({
  version: Schema.Literal(1),
  id: Nonempty,
  state: Schema.Literals(["running", "complete", "incomplete"]),
  commit: Nonempty,
  at: At,
  finishedAt: Schema.optionalKey(At),
  environment: RunEnvironment,
  requested: Schema.Array(Nonempty),
  evals: Schema.Array(Schema.Struct({ id: Nonempty, claim: Nonempty, observes: Schema.optionalKey(Nonempty) })),
  scripts: Schema.Array(Schema.Struct({
    script: Nonempty, exitCode: Schema.NullOr(Schema.Int), signal: Schema.NullOr(Nonempty),
    evals: Schema.optionalKey(Schema.Array(Nonempty)), completed: Schema.optionalKey(Schema.Boolean),
  })),
  prepare: Schema.optionalKey(Schema.Struct({
    argv: Schema.Array(Schema.String), exitCode: Schema.NullOr(Schema.Int), signal: Schema.NullOr(Nonempty), log: Schema.Literal("prepare.log"),
  })),
  screens: Schema.Array(ScreenEvidence),
});
export type RunReceipt = typeof RunReceipt.Type;

/** What is known about one eval: the verdict, the commit it was run at, when, and optionally which run and where its evidence is. */
export const EvalStatus = Schema.Struct({
  verdict: Verdict,
  commit: Nonempty,
  at: At,
  run: Schema.optionalKey(Nonempty),
  evidence: Schema.optionalKey(Nonempty),
  /** The claim as it read when the verdict was recorded. A verdict whose claim has since changed is stale. */
  claim: Schema.optionalKey(Nonempty),
  /** How the claim was to be observed when the verdict was recorded. A verdict whose `observes` has since changed is stale. */
  observes: Schema.optionalKey(Nonempty),
});
export type EvalStatus = typeof EvalStatus.Type;

export const StatusDocument = Schema.Struct({ version: Schema.Literal(1), evals: Schema.Record(Schema.String, EvalStatus) });
export type StatusDocument = typeof StatusDocument.Type;

/** A results file: one run's verdicts, with the commit, time and run id they share. */
export const ResultsFile = Schema.Struct({
  commit: Nonempty,
  at: At,
  run: Schema.optionalKey(Nonempty),
  receipt: Schema.optionalKey(RunReceipt),
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
export const parseRunReceipt = (u: unknown): Parsed<RunReceipt> => {
  const parsed = decode(RunReceipt, "run receipt", u);
  if (!parsed.ok) return parsed;
  const r = parsed.value;
  const requested = new Set(r.requested), contracts = new Set(r.evals.map((e) => e.id));
  if (requested.size !== r.requested.length || contracts.size !== r.evals.length || requested.size !== contracts.size || r.evals.some((e) => !requested.has(e.id)))
    return { ok: false, errors: ["receipt contracts must match every requested eval exactly once"] };
  if (r.prepare && (!r.prepare.argv[0] || r.prepare.argv.some((arg) => arg.includes("\0"))))
    return { ok: false, errors: ["preparation argv must name an executable and contain only NUL-free arguments"] };
  const planned = r.scripts.some((s) => s.evals !== undefined || s.completed !== undefined);
  if (planned) {
    const assigned = r.scripts.flatMap((s) => s.evals ?? []);
    if (r.scripts.some((s) => !s.evals?.length || s.completed === undefined) ||
      new Set(r.scripts.map((s) => s.script)).size !== r.scripts.length ||
      new Set(assigned).size !== assigned.length || assigned.some((id) => !requested.has(id)))
      return { ok: false, errors: ["script plans must assign requested evals exactly once and include completion flags"] };
    if (r.scripts.some((s) => s.completed && (s.signal !== null || (s.exitCode !== 0 && s.exitCode !== 1) ||
      (r.prepare && (r.prepare.exitCode !== 0 || r.prepare.signal !== null)))))
      return { ok: false, errors: ["a completed plan requires successful preparation and a normal assertion exit (0 or 1)"] };
    if ((r.state !== "running" && (!r.finishedAt || Date.parse(r.finishedAt) < Date.parse(r.at))) ||
      (r.state === "complete" && assigned.length !== requested.size))
      return { ok: false, errors: ["a finalized run needs a finish time; a complete run must plan every requested eval"] };
  }
  if (r.state === "complete" && (!r.finishedAt || Date.parse(r.finishedAt) < Date.parse(r.at) || r.scripts.some((s) => planned ? !s.completed : s.exitCode !== 0 || s.signal !== null) ||
    (r.prepare && (r.prepare.exitCode !== 0 || r.prepare.signal !== null))))
    return { ok: false, errors: ["a complete run must finish preparation and every script's assertions"] };
  if (r.environment.stack === "postgres-ponder-erpnext-v4" && (r.environment.storage !== "postgres" || r.environment.indexer !== "ponder"))
    return { ok: false, errors: ["the selected stack requires Postgres and Ponder"] };
  return parsed;
};

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
  const defs = new Map(b.evals.map((e) => [e.id, e]));
  if (run.receipt) {
    const receipt = run.receipt;
    const parsed = parseRunReceipt(receipt);
    if (!parsed.ok) return parsed;
    const ids = run.results.map((r) => r.id);
    if (receipt.id !== run.run || receipt.commit !== run.commit || receipt.at !== run.at ||
      new Set(ids).size !== ids.length || ids.length !== receipt.requested.length || receipt.requested.some((id) => !ids.includes(id)))
      return { ok: false, errors: ["receipt and results must name the same run, commit, time and complete requested set"] };
    if (run.results.some((r) => r.verdict === "pass" && (receipt.state === "running" ||
      (receipt.state !== "complete" && (!receipt.finishedAt || !receipt.scripts.some((s) => s.completed && s.evals?.includes(r.id)))))))
      return { ok: false, errors: ["a pass requires a finalized run and its own completed script plan"] };
    for (const script of receipt.scripts.filter((s) => s.completed)) {
      const rows = run.results.filter((r) => script.evals?.includes(r.id));
      if (rows.some((r) => r.verdict === "not_run") || (script.exitCode === 1 && !rows.some((r) => r.verdict === "fail")))
        return { ok: false, errors: ["a completed plan must report every assertion; exit 1 requires an explicit failed eval"] };
    }
    if (receipt.evals.some((e) => defs.get(e.id)?.claim !== e.claim || defs.get(e.id)?.observes !== e.observes))
      return { ok: false, errors: ["receipt eval contracts differ from the blueprint or requested set"] };
  }
  const evals: Record<string, EvalStatus> = { ...(doc?.evals ?? {}) };
  for (const r of run.results) {
    // An older run finishing late cannot replace the intent or outcome of a newer run of this eval.
    if (evals[r.id] && Date.parse(evals[r.id]!.at) > Date.parse(run.at)) continue;
    evals[r.id] = {
      verdict: r.verdict, commit: run.commit, at: run.at, claim: defs.get(r.id)?.claim ?? r.id,
      ...(defs.get(r.id)?.observes === undefined ? {} : { observes: defs.get(r.id)?.observes as string }),
      ...(run.run === undefined ? {} : { run: run.run }), ...(r.evidence === undefined ? {} : { evidence: r.evidence }),
    };
  }
  return { ok: true, value: { version: 1, evals: Object.fromEntries(Object.keys(evals).sort().map((id) => [id, evals[id] as EvalStatus])) } };
};

/** The verdict of an eval: `not_run` when the document is absent or has no entry for it. */
export const verdictOf = (doc: StatusDocument | null, id: string): Verdict => doc?.evals[id]?.verdict ?? "not_run";

/** How many of these evals pass. */
export const passing = (doc: StatusDocument | null, ids: readonly string[]): number =>
  ids.filter((id) => verdictOf(doc, id) === "pass").length;

/**
 * The ids whose verdict no longer speaks for the blueprint: the eval's contract (its claim, and how the claim is
 * observed) changed since the verdict was recorded, the entry records no claim, or the blueprint no longer derives the
 * id (an eval renumbered or removed). An entry recorded before `observes` was kept counts as changed when the eval has one.
 */
export const staleEvals = (b: Pick<Blueprint, "evals">, doc: StatusDocument | null): string[] => {
  const defs = new Map(b.evals.map((e) => [e.id, e]));
  return Object.entries(doc?.evals ?? {})
    .filter(([id, s]) => {
      if (s.verdict === "not_run") return false;
      const e = defs.get(id);
      return !e || s.claim !== e.claim || s.observes !== e.observes;
    })
    .map(([id]) => id)
    .sort();
};

/** The document with every stale verdict taken out, so a stale pass counts as not run. Read verdicts through this. */
export const freshStatus = (b: Pick<Blueprint, "evals">, doc: StatusDocument | null): StatusDocument | null => {
  if (doc === null) return null;
  const stale = new Set(staleEvals(b, doc));
  return { version: 1, evals: Object.fromEntries(Object.entries(doc.evals).filter(([id]) => !stale.has(id))) };
};
