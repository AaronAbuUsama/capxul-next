import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Str from "effect/String";
import { shapeProblems, trackedFiles } from "../src/shape.ts";

const clean = [
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "docs/roadmap.md",
  ".github/workflows/check.yml",
  "packages/lint/README.md",
  "packages/lint/src/shape.ts",
  "spikes/hosting/README.md",
  "spikes/hosting/run.sh",
];
const short = (): number => 10;
const read = (): string => "";
const entries = { reasons: ["packages/lint/src/shape.entry.ts"], override: ["packages/lint/src/shape.entry.ts"] };
const longShape = (file: string): number =>
  file === "packages/lint/src/shape.ts" || Str.endsWith("x.js")(file) ? 301 : 10;

test("a tree in shape has no problems", () => {
  assert.deepEqual(shapeProblems({ files: clean, lines: short, read, entries }), []);
});

test("an entry at the top level that is not listed is a problem", () => {
  const problems = shapeProblems({ files: [...clean, "START-HERE.md", "evals/x.ts"], lines: short, read, entries });
  assert.deepEqual(problems, [
    'top level: "START-HERE.md" is not in the list in packages/lint/src/shape.ts',
    'top level: "evals" is not in the list in packages/lint/src/shape.ts',
  ]);
});

test("only the listed files and folders live under docs", () => {
  const problems = shapeProblems({ files: [...clean, "docs/philosophy.md"], lines: short, read, entries });
  assert.deepEqual(problems, [
    'docs: "docs/philosophy.md" is not allowed; docs/ holds the files and folders listed in packages/lint/src/docs.ts',
  ]);
});

test("a package not in the allowlist is a problem", () => {
  const problems = shapeProblems({ files: [...clean, "packages/portal/README.md"], lines: short, read, entries });
  assert.deepEqual(problems, ['packages: "portal" is not in the allowlist in packages/lint/src/shape.ts']);
});

test("a package or a spike without a README is a problem", () => {
  const problems = shapeProblems({
    files: [...clean, "packages/world/src/main.ts", "spikes/pipeline/run.sh"],
    lines: short,
    read,
    entries,
  });
  assert.deepEqual(problems, ["packages/world: has no README.md", "spikes/pipeline: has no README.md"]);
});

test("loose files under packages or spikes are problems", () => {
  const problems = shapeProblems({
    files: [...clean, "packages/README.md", "spikes/README.md"],
    lines: short,
    read,
    entries,
  });
  assert.deepEqual(problems, [
    'packages: "packages/README.md" is a loose file; packages/ holds only folders',
    'spikes: "spikes/README.md" is a loose file; spikes/ holds only folders',
  ]);
});

test("a source file over 300 lines is a problem, vendored code is not", () => {
  const files = [
    ...clean,
    "packages/contracts/README.md",
    "packages/contracts/lib/forge-std/src/Test.sol",
    "packages/contracts/lib/x.js",
  ];
  assert.deepEqual(shapeProblems({ files, lines: longShape, read, entries }), [
    'size: "packages/lint/src/shape.ts" has 301 lines; the limit is 300',
  ]);
});

test("the two lists of entry files must name the same paths", () => {
  const lists = { reasons: ["a.entry.ts", "b.entry.ts"], override: ["b.entry.ts", "c.entry.ts"] };
  assert.deepEqual(shapeProblems({ files: clean, lines: short, read, entries: lists }), [
    '.oxlintrc.json: "a.entry.ts" has a reason in settings.capxul.entries but is not in the entry override',
    '.oxlintrc.json: "c.entry.ts" is in the entry override but has no reason in settings.capxul.entries',
  ]);
});

test("the files are git's list, less what was deleted from the working tree", () => {
  const listing = "AGENTS.md\0packages/lint/src/shape.ts\0packages/lint/gone.ts\0";
  assert.deepEqual(
    trackedFiles(listing, (file) => file !== "packages/lint/gone.ts"),
    ["AGENTS.md", "packages/lint/src/shape.ts"],
  );
});
