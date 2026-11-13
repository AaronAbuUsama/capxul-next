// The repository's shape, as data, and the check that compares a list of files with it.
// The entry file (shape.entry.ts) reads the files; everything here is pure, so the test can feed it any tree.

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
  docs: "only docs/roadmap.md, the plan this line follows",
  packages: "the code, one package per component",
  spikes: "throwaway code that proves a risk, deleted when its step graduates it",
};

/** The packages that may exist, each with the reason it is there. */
export const PACKAGES: Readonly<Record<string, string>> = {
  blueprint: "what Capxul does: operations, refusals, events and starting worlds as Effect declarations",
  world: "what runs where: the Alchemy stacks that create and destroy a world",
  contracts: "the Solidity contracts, their Foundry tests and the seeded chain state",
  "frappe-app": "the Capxul app on every hosted Frappe site",
  "bench-image": "the hosted Frappe bench's image and its check",
  indexer: "the Ponder app that indexes the chain into the world's database",
  "status-feed": "the data files behind the status dashboard",
  lint: "the ladder's own rules and this shape check",
};

/** The only file allowed under docs/. */
export const DOCS = ["docs/roadmap.md"];

/** Longest source file allowed, in lines. The lint rule max-lines says the same for TypeScript. */
export const MAX_LINES = 300;

/** Files whose length is checked. Vendored code is not ours to split. */
export const SOURCE = /\.(ts|tsx|mts|js|mjs|cjs|py|sh)$/;
export const VENDORED = ["packages/contracts/lib/"];

export interface ShapeInput {
  /** Every file git tracks or would track, relative to the root, with forward slashes. */
  readonly files: ReadonlyArray<string>;
  /** The number of lines of each file that is a source file. */
  readonly lines: (file: string) => number;
}

const unique = (items: ReadonlyArray<string>): Array<string> => [...new Set(items)].sort();

const topLevel = (files: ReadonlyArray<string>): Array<string> =>
  unique(files.map((file) => file.split("/")[0] ?? file))
    .filter((entry) => !(entry in TOP_LEVEL))
    .map((entry) => `top level: "${entry}" is not in the list in packages/lint/src/shape.ts`);

const docs = (files: ReadonlyArray<string>): Array<string> =>
  files
    .filter((file) => file.startsWith("docs/") && !DOCS.includes(file))
    .map((file) => `docs: "${file}" is not allowed; only ${DOCS.join(", ")} lives under docs/`);

const folders = (files: ReadonlyArray<string>, root: string): Array<string> =>
  unique(files.filter((file) => file.startsWith(`${root}/`)).map((file) => file.split("/").slice(0, 2).join("/")));

const looseFiles = (files: ReadonlyArray<string>, root: string): Array<string> =>
  files
    .filter((file) => file.startsWith(`${root}/`) && file.split("/").length === 2)
    .map((file) => `${root}: "${file}" is a loose file; ${root}/ holds only folders`);

const withoutReadme = (files: ReadonlyArray<string>, root: string): Array<string> =>
  folders(files, root)
    .filter((folder) => folder.split("/").length === 2 && files.some((file) => file.startsWith(`${folder}/`)))
    .filter((folder) => !files.includes(`${folder}/README.md`))
    .map((folder) => `${folder}: has no README.md`);

const unknownPackages = (files: ReadonlyArray<string>): Array<string> =>
  folders(files, "packages")
    .filter((folder) => files.some((file) => file.startsWith(`${folder}/`)))
    .map((folder) => folder.slice("packages/".length))
    .filter((name) => !(name in PACKAGES))
    .map((name) => `packages: "${name}" is not in the allowlist in packages/lint/src/shape.ts`);

const tooLong = (input: ShapeInput): Array<string> =>
  input.files
    .filter((file) => file.startsWith("packages/") && SOURCE.test(file))
    .filter((file) => !VENDORED.some((prefix) => file.startsWith(prefix)))
    .filter((file) => input.lines(file) > MAX_LINES)
    .map((file) => `size: "${file}" has ${input.lines(file)} lines; the limit is ${MAX_LINES}`);

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
];
