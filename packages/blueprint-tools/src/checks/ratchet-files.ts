// The ratchets counted from the repository's files (roadmap item 3.6): R7, the verbs whose examples still sit in their
// thing's `examples.ts`; R8, the long READMEs, the hand-written file maps and the docs not yet folded; R10, the
// non-Effect constructs and runtime dependencies; R20, the glossary's words not yet landed (roadmap item 3.8). Pure: packages/generate (src/ratchet-files.entry.ts) reads the files,
// git's list of them and the effect-only rule's findings, and hands them in; the tests run these on made-up files.
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import type { Entry } from "../language/glossary.ts";

/** What the four counters read, each gathered by packages/generate. */
export interface RepositoryFiles {
  /** Each verb's file, `src/things/<thing>/verbs/<verb>.ts` under packages/blueprint, and its text. */
  readonly verbs: { readonly [path: string]: string };
  /**
   * The READMEs longer than one screen, as the docs' shape keeps them (packages/lint, src/docs.ts, `LONG_READMES`:
   * the shape rung fails a long README not on it, and one on it that fits).
   */
  readonly longReadmes: ReadonlyArray<string>;
  /** Each tracked README.md and page under a package's `docs/`, by its path from the root, and its text. */
  readonly docs: { readonly [path: string]: string };
  /**
   * The findings of `capxul/effect-only` (packages/lint) in the TypeScript the lint does not reach but the roadmap does
   * not exempt (NOT_LINTED): a file, and its findings. In the TypeScript the lint reaches, the rule is an error with no
   * list, so it finds nothing there.
   */
  readonly nonEffect: { readonly [file: string]: number };
  /** Each package's runtime dependencies (`dependencies` of its package.json), by its path. */
  readonly dependencies: { readonly [pkg: string]: ReadonlyArray<string> };
  /** Every tracked file, by its path from the root (git's list). */
  readonly tracked: ReadonlyArray<string>;
  /** The root package.json's scripts, by name. */
  readonly scripts: ReadonlyArray<string>;
}

/**
 * The TypeScript `.oxlintrc.json` ignores that is still Capxul's code, in which R10 counts effect-only's findings:
 * Ponder's files (Ponder requires async handlers) and the contracts' own TypeScript door. The other ignored folders are
 * out of R10: `spikes/` is temporary, the contracts' `lib/` is vendored, and the Frappe app is outside Effect by the
 * roadmap ("Effect everywhere it can be").
 */
export const NOT_LINTED: ReadonlyArray<string> = [
  "packages/contracts/src",
  "packages/indexer",
  "packages/world/ponder",
];

/** How many lines of a doc name a file first, before a file map is counted (R8). */
export const MAP_LINES = 3;

/** A list item or a table row that opens with a file's path in backticks: one line of a file map. */
const MAP_LINE = /^\s*(?:[-*]|\|)\s*`[^`\s]+\.[a-z]{1,5}`/;

/** An import from a thing's `examples.ts`. */
const FROM_EXAMPLES = /from\s+["'][^"']*\/examples\.ts["']/;

/** A runtime dependency that is Effect or Capxul's own. */
const isEffect = (name: string): boolean =>
  name === "effect" || Str.startsWith("@effect/")(name) || Str.startsWith("@capxul/")(name);

const lines = (text: string): ReadonlyArray<string> => Str.split(Str.trimEnd(text), "\n");

/** A counter's answer: its count and the items behind it, one each. */
export interface Counted {
  readonly count: number;
  readonly items: ReadonlyArray<string>;
}

const each = (items: ReadonlyArray<string>): Counted => ({ count: items.length, items });

/** R7: the verbs whose examples still sit in their thing's `examples.ts` (part 13: until stage 2b folds it). */
export const verbsWithExamplesApart = (files: RepositoryFiles): Counted =>
  each(
    Arr.sort(
      Arr.filter(Rec.keys(files.verbs), (path) => FROM_EXAMPLES.test(files.verbs[path] ?? "")),
      Str.Order,
    ),
  );

/**
 * R8: each README over one screen (`longReadmes`), each doc that is a hand-written file map (MAP_LINES or more of its lines name a
 * file first), and each doc of `unfolded`, the ratchet's own list of docs not yet folded into a declaration or a
 * generated page. A README that is both long and a map counts twice: they are two gaps.
 */
export const longOrMappedDocs = (files: RepositoryFiles, unfolded: ReadonlyArray<string>): Counted => {
  const paths = Arr.sort(Rec.keys(files.docs), Str.Order);
  const maps = Arr.flatMap(paths, (path) => {
    const n = Arr.filter(lines(files.docs[path] ?? ""), (line) => MAP_LINE.test(line)).length;
    return n >= MAP_LINES ? [`map: ${path} (${String(n)} lines name a file)`] : [];
  });
  return each([
    ...Arr.map(files.longReadmes, (path) => `long: ${path}`),
    ...maps,
    ...Arr.map(unfolded, (path) => `not folded: ${path}`),
  ]);
};

/**
 * R10: effect-only's findings outside the lint's reach (one per finding), and each runtime dependency of a package
 * that is not Effect nor Capxul's own (one per package and dependency). Both counts are the roadmap's, agreed on 13
 * November 2026.
 */
export const nonEffectCode = (files: RepositoryFiles): Counted => {
  const constructs: ReadonlyArray<string> = Arr.sort(Rec.keys(files.nonEffect), Str.Order);
  const packages: ReadonlyArray<string> = Arr.sort(Rec.keys(files.dependencies), Str.Order);
  const dependencies = Arr.flatMap(packages, (pkg) => {
    const names: ReadonlyArray<string> = Arr.sort(files.dependencies[pkg] ?? [], Str.Order);
    return Arr.flatMap(names, (name) => (isEffect(name) ? [] : [`dependency: ${pkg}: ${name}`]));
  });
  return {
    count: Arr.reduce(constructs, 0, (total, file) => total + (files.nonEffect[file] ?? 0)) + dependencies.length,
    items: [
      ...Arr.map(constructs, (file) => `construct: ${file}: ${String(files.nonEffect[file] ?? 0)}`),
      ...dependencies,
    ],
  };
};

/** An old word written as code that is a bare file name (`door.ts`): no folder, no space, an extension. */
const FILE_NAME = /^[\w.-]+\.[a-z]{1,5}$/;

const baseName = (path: string): string => Arr.last(Str.split(path, "/")).pipe(Option.getOrElse(() => path));

/**
 * R20: each glossary word whose landing place is not there yet, and each tracked file still named by an old word.
 * A `lands` that is a path under `packages/` counts once while no tracked file sits under it; a `lands` that is a
 * `pnpm` command counts once while the root package.json has no script of its name. Any other `lands` (a CLI flag) is
 * the CLI's to land (roadmap item 3.9), and is not counted here. Each tracked file whose name is an old word written as
 * code (`door.ts`, `door.py`) counts once, until it is renamed.
 */
export const wordsNotLanded = (files: RepositoryFiles, glossary: ReadonlyArray<Entry>): Counted => {
  const places = Arr.flatMap(glossary, ({ word, lands }) => {
    if (lands === undefined) return [];
    if (Str.startsWith("packages/")(lands))
      return Arr.some(files.tracked, Str.startsWith(`${lands}/`)) ? [] : [`not landed: ${word}: ${lands}`];
    const script = /^pnpm (\S+)$/.exec(lands)?.[1];
    return script === undefined || Arr.contains(files.scripts, script) ? [] : [`not landed: ${word}: ${lands}`];
  });
  const oldNames = Arr.flatMap(glossary, ({ word, replaces }) =>
    Arr.flatMap(replaces, (old) =>
      typeof old !== "string" && old.kind === "code" && FILE_NAME.test(old.text) ? [[old.text, word] as const] : [],
    ),
  );
  const tracked: ReadonlyArray<string> = Arr.sort(files.tracked, Str.Order);
  const renames = Arr.flatMap(tracked, (path) =>
    Arr.flatMap(oldNames, ([old, word]) => (baseName(path) === old ? [`not renamed: ${path} (${word})`] : [])),
  );
  return each([...places, ...renames]);
};
