// The repository's shape, as data, and the check that compares a list of files with it.
// The entry file (shape.entry.ts) reads the files; everything here is pure, so the test can feed it any tree.
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Order from "effect/Order";
import * as Str from "effect/String";

/** What may sit at the top level, each with the reason it is there. */
export const TOP_LEVEL: Readonly<Record<string, string>> = {
  "AGENTS.md": "the rules every agent reads",
  "CLAUDE.md": "a link to AGENTS.md, for Claude",
  "README.md": "what this is and where things are",
  "GROUNDING.md": "Aaron's strategy",
  "package.json": "the root scripts: the ladder",
  "pnpm-workspace.yaml": "the workspace and its one version catalog",
  "pnpm-lock.yaml": "the exact versions installed",
  "tsconfig.base.json": "the compiler options every TypeScript package extends",
  ".oxlintrc.json": "the lint rules: built-in, Effect's and ours",
  ".gitignore": "what git never tracks",
  ".github": "CI and the pull request template",
  ".agents":
    "the agent kit every agent reads (Amp, Claude Code, Codex): the thread types, the conductor's loop, the review",
  ".claude":
    "Claude Code's settings (the tools it may run without asking, and what it may never run) and links to the kit",
  docs: "docs/roadmap.md, the plan this line follows, and docs/design/blueprint.md, the blueprint's design",
  packages: "the code, one package per component",
  spikes: "throwaway code that proves a risk, deleted when its step graduates it",
};

/** The packages that may exist, each with the reason it is there. */
export const PACKAGES: Readonly<Record<string, string>> = {
  blueprint: "what Capxul does: operations, refusals, events and starting worlds as Effect declarations",
  "blueprint-tools":
    "how the blueprint is written and checked: its language, the delta check, and its indexes' and pages' render",
  world: "what runs where: the Alchemy stacks that create and destroy a world",
  contracts: "the Solidity contracts, their Foundry tests and the seeded chain state",
  "frappe-app": "the Capxul app on every hosted Frappe site",
  "bench-image": "the hosted Frappe bench's image and its check",
  platform: "the shared platform: the bench host on AWS, the Frappe bench, the tunnel, site tokens and the drift check",
  indexer: "the Ponder app that indexes the chain into the world's database",
  "status-feed": "the data files behind the status dashboard",
  lint: "the ladder's own rules and this shape check",
  core: "the Capxul server: a Cloudflare Worker that serves every blueprint operation",
  runner: "the scenario runner: runs scenarios against a world, checks every call and writes run records",
  scenarios: "the acceptance scenarios, each proving one blueprint claim through the door",
  sdk: "the typed client of every blueprint operation, derived from the blueprint, through which callers reach Core",
  cli: "the one Capxul command line: every blueprint operation a command, called through the SDK",
  generate:
    "`pnpm generate`: writes every derived file from its owner, the compiled contracts, the seed and the blueprint",
};

/** The only files allowed under docs/. */
export const DOCS: ReadonlyArray<string> = [
  "docs/roadmap.md",
  "docs/design/blueprint.md",
  "docs/design/handoff.md",
  "docs/design/run-time.md",
  "docs/design/sitrep.md",
  "docs/design/system.md",
  "docs/design/world.md",
];

/** Longest source file allowed, in lines. The lint rule max-lines says the same for TypeScript. */
export const MAX_LINES = 300;

/** Files whose length is checked. Vendored code is not ours to split. */
export const SOURCE = /\.(ts|tsx|mts|js|mjs|cjs|py|sh)$/;
export const VENDORED: ReadonlyArray<string> = ["packages/contracts/lib/"];
/** A folder `pnpm generate` writes. Its files are as long as their owners make them; `pnpm generate:check` keeps them. */
export const GENERATED = "/generated/";

/** The two lists of entry files in .oxlintrc.json, which must name the same paths. */
export interface EntryLists {
  /** The keys of settings.capxul.entries, which gives each entry its reason. */
  readonly reasons: ReadonlyArray<string>;
  /** The files of the override that lets entry files touch the process. */
  readonly override: ReadonlyArray<string>;
}

/**
 * The files of `git ls-files -z` (NUL-separated paths relative to the root), less those deleted from the working tree
 * and not yet from the index. Only what git tracks is listed: nothing is found by walking the disk.
 */
export const trackedFiles = (listing: string, exists: (file: string) => boolean): Array<string> =>
  pipe(
    Arr.dedupe(Str.split(listing, "\0")),
    Arr.filter((file) => file !== "" && exists(file)),
  );

export interface ShapeInput {
  /** Every file git tracks, relative to the root, with forward slashes. */
  readonly files: ReadonlyArray<string>;
  /** The number of lines of each file that is a source file. */
  readonly lines: (file: string) => number;
  readonly entries: EntryLists;
}

const unique = (items: ReadonlyArray<string>): Array<string> => Arr.sort(Arr.dedupe(items), Order.String);
const head = (file: string, parts: number): string => Arr.join(Arr.take(Str.split(file, "/"), parts), "/");
const depth = (file: string): number => Str.split(file, "/").length;
const under = (root: string) => Str.startsWith(`${root}/`);

const topLevel = (files: ReadonlyArray<string>): Array<string> =>
  pipe(
    unique(Arr.map(files, (file) => head(file, 1))),
    Arr.filter((entry) => !(entry in TOP_LEVEL)),
    Arr.map((entry) => `top level: "${entry}" is not in the list in packages/lint/src/shape.ts`),
  );

const docs = (files: ReadonlyArray<string>): Array<string> =>
  pipe(
    Arr.filter(files, (file) => under("docs")(file) && !Arr.contains(DOCS, file)),
    Arr.map((file) => `docs: "${file}" is not allowed; only ${Arr.join(DOCS, ", ")} lives under docs/`),
  );

const folders = (files: ReadonlyArray<string>, root: string): Array<string> =>
  unique(
    Arr.map(
      Arr.filter(files, (file) => under(root)(file) && depth(file) > 2),
      (file) => head(file, 2),
    ),
  );

const looseFiles = (files: ReadonlyArray<string>, root: string): Array<string> =>
  pipe(
    Arr.filter(files, (file) => under(root)(file) && depth(file) === 2),
    Arr.map((file) => `${root}: "${file}" is a loose file; ${root}/ holds only folders`),
  );

const withoutReadme = (files: ReadonlyArray<string>, root: string): Array<string> =>
  pipe(
    Arr.filter(folders(files, root), (folder) => !Arr.contains(files, `${folder}/README.md`)),
    Arr.map((folder) => `${folder}: has no README.md`),
  );

const unknownPackages = (files: ReadonlyArray<string>): Array<string> =>
  pipe(
    Arr.map(folders(files, "packages"), (folder) => Str.slice("packages/".length)(folder)),
    Arr.filter((name) => !(name in PACKAGES)),
    Arr.map((name) => `packages: "${name}" is not in the allowlist in packages/lint/src/shape.ts`),
  );

const tooLong = (input: ShapeInput): Array<string> =>
  pipe(
    Arr.filter(input.files, (file) => under("packages")(file) && SOURCE.test(file)),
    Arr.filter((file) => !Arr.some(VENDORED, (prefix) => Str.startsWith(prefix)(file))),
    Arr.filter((file) => !Str.includes(GENERATED)(file)),
    Arr.filter((file) => input.lines(file) > MAX_LINES),
    Arr.map((file) => `size: "${file}" has ${input.lines(file)} lines; the limit is ${MAX_LINES}`),
  );

const entryLists = ({ reasons, override }: EntryLists): Array<string> => [
  ...Arr.map(
    Arr.difference(reasons, override),
    (path) => `.oxlintrc.json: "${path}" has a reason in settings.capxul.entries but is not in the entry override`,
  ),
  ...Arr.map(
    Arr.difference(override, reasons),
    (path) => `.oxlintrc.json: "${path}" is in the entry override but has no reason in settings.capxul.entries`,
  ),
];

/** Every way the tree differs from the shape, one line each. Empty when the tree is in shape. */
export const shapeProblems = (input: ShapeInput): Array<string> => [
  ...topLevel(input.files),
  ...docs(input.files),
  ...looseFiles(input.files, "packages"),
  ...looseFiles(input.files, "spikes"),
  ...unknownPackages(input.files),
  ...withoutReadme(input.files, "packages"),
  ...withoutReadme(input.files, "spikes"),
  ...tooLong(input),
  ...entryLists(input.entries),
];
