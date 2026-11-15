// The docs' shape (docs/design/blueprint.md, part 7; docs/design/docs.md): what may live under docs/, where else a
// Markdown file may live, how long a README may be, that every relative link resolves, and that a design note states
// its status. Pure, like shape.ts: the entry file reads the files, so the test can feed it any tree.
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Rec from "effect/Record";
import * as Str from "effect/String";

/** The files that may sit directly under docs/, each with its reason. */
export const DOC_FILES: Readonly<Record<string, string>> = {
  "docs/roadmap.md": "the goal, the phases and the items, read by the status feed",
  "docs/decisions.md": "every decision Aaron agreed, dated, one entry each",
  "docs/grounding.md": "Aaron's strategy",
};

/** The folders under docs/ that hold one Markdown file per page, each with its reason. */
export const DOC_FOLDERS: Readonly<Record<string, string>> = {
  "docs/design": "design notes: one per question, each stating its status near the top",
  "docs/guides": "how-to pages for work across packages, one task each",
};

/** Markdown files outside the usual places, each with its reason. */
export const MARKDOWN_ELSEWHERE: Readonly<Record<string, string>> = {
  ".github/pull_request_template.md": "GitHub reads the pull request template from there",
  "packages/platform/bootstrap/BOOTSTRAP.md": "the one-time bootstrap's runbook, beside the code it runs",
};

/** A README fits on one screen. */
export const MAX_README_LINES = 60;

/**
 * The READMEs that were longer than a screen when the limit came in. The list may only shrink: a README on it that now
 * fits must come off it, one that is gone should, and test/docs.test.ts caps the list's length.
 */
export const LONG_READMES: ReadonlyArray<string> = [
  "packages/blueprint/README.md",
  "packages/cli/README.md",
  "packages/core/README.md",
  "packages/frappe-app/README.md",
  "packages/runner/README.md",
  "packages/scenarios/README.md",
  "packages/sdk/README.md",
  "packages/world/README.md",
  "packages/world/records/spike-bundler/README.md",
  "spikes/bench-clocks/README.md",
  "spikes/containers/README.md",
  "spikes/pipeline/README.md",
  "spikes/pipeline/core/README.md",
  "spikes/pipeline/runner/README.md",
  "spikes/site-speed/README.md",
  "spikes/state/README.md",
  "spikes/world-speed/README.md",
];

/** Design notes that do not yet state their status. The list may only shrink, like LONG_READMES. */
export const UNSTATED_NOTES: ReadonlyArray<string> = ["docs/design/blueprint.md"];

/** Where a design note states its status: a line `Status: open`, `agreed` or `superseded` among its first lines. */
const STATUS = /^Status: \**(open|agreed|superseded)\b/i;
const STATUS_WITHIN = 10;

/** Code that is ours to shape. Vendored code keeps its own docs. */
const VENDORED: ReadonlyArray<string> = ["packages/contracts/lib/"];

export interface DocsInput {
  /** Every file git tracks, relative to the root, with forward slashes. */
  readonly files: ReadonlyArray<string>;
  /** The number of lines of a file. */
  readonly lines: (file: string) => number;
  /** A file's text. */
  readonly read: (file: string) => string;
}

const parts = (file: string): Array<string> => Str.split(file, "/");
const depth = (file: string): number => parts(file).length;
const under = (root: string) => Str.startsWith(`${root}/`);
const isMarkdown = Str.endsWith(".md");
const isReadme = (file: string): boolean => file === "README.md" || Str.endsWith("/README.md")(file);
const ours = (file: string): boolean => !Arr.some(VENDORED, (prefix) => Str.startsWith(prefix)(file));
const markdown = (files: ReadonlyArray<string>): Array<string> => Arr.filter(files, (f) => isMarkdown(f) && ours(f));

const inFolder = (file: string): boolean =>
  Arr.some(Rec.keys(DOC_FOLDERS), (folder) => under(folder)(file) && depth(file) === depth(folder) + 1);

const docsFolder = (files: ReadonlyArray<string>): Array<string> =>
  pipe(
    Arr.filter(files, (file) => under("docs")(file) && !(file in DOC_FILES) && !(isMarkdown(file) && inFolder(file))),
    Arr.map(
      (file) => `docs: "${file}" is not allowed; docs/ holds the files and folders listed in packages/lint/src/docs.ts`,
    ),
  );

/** Where a Markdown file may live outside docs/ and the top level. */
const placed = (file: string): boolean =>
  depth(file) === 1 ||
  under("docs")(file) ||
  isReadme(file) ||
  file in MARKDOWN_ELSEWHERE ||
  // Everything inside the blueprint is the blueprint session's; its own layout check covers it.
  under("packages/blueprint")(file) ||
  Str.includes("/records/")(file) ||
  Str.includes("/generated/")(file) ||
  (under("packages")(file) && depth(file) === 4 && parts(file)[2] === "docs");

const misplaced = (files: ReadonlyArray<string>): Array<string> =>
  pipe(
    Arr.filter(markdown(files), (file) => !placed(file)),
    Arr.map(
      (file) =>
        `markdown: "${file}" is not where a doc may live: a README.md, packages/<name>/docs/, docs/, records/ or generated/`,
    ),
  );

const readmes = (input: DocsInput): Array<string> => {
  const long = Arr.filter(markdown(input.files), (f) => isReadme(f) && input.lines(f) > MAX_README_LINES);
  return [
    ...Arr.map(
      Arr.filter(long, (file) => !Arr.contains(LONG_READMES, file)),
      (file) => `readme: "${file}" has ${input.lines(file)} lines; a README fits on a screen of ${MAX_README_LINES}`,
    ),
    ...Arr.map(
      Arr.filter(LONG_READMES, (file) => Arr.contains(input.files, file) && !Arr.contains(long, file)),
      (file) => `readme: "${file}" fits on a screen; take it off LONG_READMES in packages/lint/src/docs.ts`,
    ),
  ];
};

/** The relative link targets of a Markdown text, outside code. */
export const linkTargets = (text: string): Array<string> =>
  pipe(
    text,
    Str.replace(/```[\s\S]*?```/g, ""),
    Str.replace(/`[^`\n]*`/g, ""),
    Str.matchAll(/\]\(([^)\s]+)\)/g),
    Arr.fromIterable,
    Arr.map((match) => Str.split(Str.split(match[1] ?? "", "#")[0] ?? "", "?")[0] ?? ""),
    Arr.filter((target) => target !== "" && !/^[a-z][a-z+.-]*:/i.test(target)),
  );

/** A path joined to the folder of a file, with `.` and `..` resolved. */
export const resolve = (from: string, target: string): string => {
  const start = Str.startsWith("/")(target) ? [] : Arr.dropRight(parts(from), 1);
  const steps = Arr.filter(Str.split(target, "/"), (step) => step !== "" && step !== ".");
  return Arr.join(
    Arr.reduce(steps, start, (path, step) => (step === ".." ? Arr.dropRight(path, 1) : [...path, step])),
    "/",
  );
};

const links = (input: DocsInput): Array<string> => {
  const exists = (path: string): boolean =>
    Arr.contains(input.files, path) || Arr.some(input.files, (file) => under(path)(file));
  return Arr.flatMap(markdown(input.files), (file) =>
    pipe(
      linkTargets(input.read(file)),
      Arr.filter((target) => !exists(resolve(file, target))),
      Arr.map((target) => `link: "${file}" links to "${target}", which git does not track`),
    ),
  );
};

const statuses = (input: DocsInput): Array<string> => {
  const notes = Arr.filter(input.files, (f) => under("docs/design")(f) && inFolder(f) && !isReadme(f));
  const stated = (file: string): boolean =>
    Arr.some(Arr.take(Str.split(input.read(file), "\n"), STATUS_WITHIN), (line) => STATUS.test(line));
  return [
    ...Arr.map(
      Arr.filter(notes, (file) => !stated(file) && !Arr.contains(UNSTATED_NOTES, file)),
      (file) =>
        `design: "${file}" does not say "Status: open", "agreed" or "superseded" in its first ${STATUS_WITHIN} lines`,
    ),
    ...Arr.map(
      Arr.filter(UNSTATED_NOTES, (file) => Arr.contains(notes, file) && stated(file)),
      (file) => `design: "${file}" states its status; take it off UNSTATED_NOTES in packages/lint/src/docs.ts`,
    ),
  ];
};

/** Every way the docs differ from their shape, one line each. Empty when they are in shape. */
export const docProblems = (input: DocsInput): Array<string> => [
  ...docsFolder(input.files),
  ...misplaced(input.files),
  ...readmes(input),
  ...links(input),
  ...statuses(input),
];
