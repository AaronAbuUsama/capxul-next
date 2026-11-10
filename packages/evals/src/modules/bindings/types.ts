/**
 * Bindings: which checks prove which evals. An eval is a claim the blueprint derives; a check is a named step of an executable
 * script, expected to pass. A binding says "this eval holds when all of these checks pass", with the reason in words.
 * A near-miss says "these checks prove part of the eval": it is recorded so the gap is visible and never scores.
 * Nothing here reads a file or runs anything.
 */

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly string[] };

/** The eval holds when every one of `checks` passes. `why` says how the checks establish the whole claim. */
export interface Binding {
  readonly eval: string;
  readonly checks: readonly string[];
  readonly why: string;
}

/** The checks prove part of the eval. It scores nothing; `missing` says what the eval claims beyond them. */
export interface NearMiss {
  readonly eval: string;
  readonly checks: readonly string[];
  readonly missing: string;
}

/** One file of `evals/bindings/`: one area, one script. */
export interface BindingFile {
  readonly source: string;
  readonly area: string;
  /** The script that runs the checks, from the repository root. */
  readonly script: string;
  /** The worlds the script can run against. */
  readonly worlds: readonly string[];
  /** Files, from the repository root, whose key, secret, password and token values must not reach the evidence. */
  readonly secrets: readonly string[];
  readonly bindings: readonly Binding[];
  readonly near: readonly NearMiss[];
}

/** What a script says it checks (its `--list`): the checks that can pass, and the guards that only ever fail. */
export interface ScriptChecks {
  readonly checks: ReadonlySet<string>;
  readonly guards: ReadonlySet<string>;
}

/** Every binding, with its file, and the facts they were validated against. */
export interface Bindings {
  readonly files: readonly BindingFile[];
  readonly byEval: ReadonlyMap<string, { readonly file: BindingFile; readonly binding: Binding }>;
}

/** What the blueprint and the scripts say exists, for validating bindings. */
export interface Known {
  readonly evals: ReadonlySet<string>;
  /** Script path to what it lists. */
  readonly scripts: ReadonlyMap<string, ScriptChecks>;
}

/** What to run: named evals, the evals of a journey or of a milestone, or every eval that has a check. */
export type What =
  | { readonly kind: "evals"; readonly ids: readonly string[] }
  | { readonly kind: "journey"; readonly id: string }
  | { readonly kind: "milestone"; readonly id: string }
  | { readonly kind: "all" };

/** The eval ids that journeys and milestones stand for, read from the blueprint and the plan by the caller. */
export interface Index {
  readonly journey: (id: string) => readonly string[] | null;
  readonly milestone: (id: string) => readonly string[] | null;
}

/** The three lists `gaps` prints. */
export interface Gaps {
  /** Checks that no binding and no near-miss names: nothing in the blueprint says what they prove. */
  readonly checksWithNoEval: readonly string[];
  /** Checks that only a near-miss names: they prove part of a claim. */
  readonly checksInNearMisses: readonly string[];
  /** The evals of the skeleton's journeys that no binding covers, with the near-misses among them marked. */
  readonly evalsWithNoCheck: readonly { readonly id: string; readonly near: boolean }[];
}
