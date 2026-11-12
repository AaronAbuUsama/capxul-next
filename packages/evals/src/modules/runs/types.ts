/**
 * Runs: what a script printed, what that says about each bound eval, and the files that record it. The rules of truth
 * are here: an eval with no check is `not_run` and never `pass`; a check that failed fails its eval; a check that did not
 * run resets its eval to not_run. Nothing here reads a file, the clock or the process.
 */
import type { Verdict } from "@capxul/blueprint-engine";

/** One `@check` line of a script's output. */
export interface CheckLine {
  readonly name: string;
  readonly verdict: "pass" | "fail";
  /** Milliseconds since the check before it. */
  readonly ms: number;
  readonly detail: string;
}

/** A check's repeats folded: it passed only if it ran and every time it passed. */
export interface Folded {
  readonly name: string;
  readonly verdict: "pass" | "fail";
  readonly times: number;
  readonly ms: number;
  /** The detail of the first failure, or of the last pass. */
  readonly detail: string;
}

/** One eval's verdict from this run, and the checks it rests on. */
export interface Row {
  readonly id: string;
  readonly verdict: Verdict;
  readonly checks: readonly Folded[];
}

export interface Scored {
  /** The verdicts to record: a pass, a fail, or an explicit `not_run` for an asked-for eval with no check. */
  readonly rows: readonly Row[];
  /** Bound evals whose checks did not all run, even if a check failed. The run cannot supply passing evidence. */
  readonly unfinished: readonly { readonly id: string; readonly missing: readonly string[] }[];
}

/** What the run was, for the evidence and the results file. */
export interface RunInfo {
  readonly run: string;
  readonly commit: string;
  /** ISO 8601 with a zone. */
  readonly at: string;
  readonly script: string;
  readonly world: string;
  readonly slug: string;
}
