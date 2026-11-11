/**
 * The layout check: three rules that keep the repository findable.
 *
 * 1. The top level is closed: an entry there is on the allowlist, with a reason, or the check fails.
 * 2. No source file is over the limit, except the recorded offenders, and none of those may grow.
 * 3. Every top-level directory and every package has a README.
 *
 * The rules are pure: the entry (`src/main.ts`) reads git and the files and hands them in.
 */

/** What may be at the top level: the entry's name and the one-line reason it is there. */
export type Allowlist = Readonly<Record<string, string>>;

/** A source file and how many lines it has. */
export type SourceFile = { readonly path: string; readonly lines: number };

/** The files over the limit when the limit was introduced: path to the line count it may not exceed. */
export type Oversize = Readonly<Record<string, number>>;

export type Policy = {
  readonly allowed: Allowlist;
  /** The most lines a source file may have. */
  readonly limit: number;
  /** A file counts as source when its name ends with one of these. */
  readonly sourceExtensions: readonly string[];
  /** Paths the size rule skips: designs, the archive, generated and vendored code. A prefix, or `/name/` anywhere in the path. */
  readonly sizeExempt: readonly string[];
  readonly oversize: Oversize;
};

/** What the entry read from the working tree. Paths use `/` and are relative to the repository root. */
export type Tree = {
  /** Every top-level entry git does not ignore, tracked or not. */
  readonly topLevel: readonly string[];
  /** The top-level entries that are directories. */
  readonly topLevelDirs: readonly string[];
  /** The directories directly under `packages/`. */
  readonly packages: readonly string[];
  /** Every file git does not ignore, tracked or not. */
  readonly files: readonly string[];
  /** The line count of one of those files. */
  readonly linesOf: (path: string) => number;
};

export type Problem = { readonly rule: "top-level" | "size" | "readme"; readonly at: string; readonly why: string };
