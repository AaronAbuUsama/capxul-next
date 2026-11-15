import { strict as assert } from "node:assert";
import { test } from "node:test";
import { docProblems, LONG_READMES, linkTargets, MAX_README_LINES, resolve, UNSTATED_NOTES } from "../src/docs.ts";

const note = "# A note\n\nStatus: agreed, 15 November 2026.\n";
const texts: Readonly<Record<string, string>> = {
  "docs/design/a.md": note,
  "README.md": "See [the roadmap](docs/roadmap.md) and [a note](docs/design/a.md#why).",
};
const read = (file: string): string => texts[file] ?? "";
const short = (): number => 10;
const clean = ["README.md", "docs/roadmap.md", "docs/design/a.md", "packages/lint/README.md"];
const problems = (
  files: ReadonlyArray<string>,
  lines: (file: string) => number = short,
  text: (file: string) => string = read,
) => docProblems({ files: [...clean, ...files], lines, read: text });

test("docs in shape have no problems", () => {
  assert.deepEqual(problems([]), []);
});

test("docs/ holds only its listed files and one level of its listed folders", () => {
  assert.deepEqual(problems(["docs/decisions.md", "docs/guides/run-a-world.md"]), []);
  assert.deepEqual(problems(["docs/notes.md", "docs/design/old/a.md", "docs/guides/a.txt"]), [
    'docs: "docs/notes.md" is not allowed; docs/ holds the files and folders listed in packages/lint/src/docs.ts',
    'docs: "docs/design/old/a.md" is not allowed; docs/ holds the files and folders listed in packages/lint/src/docs.ts',
    'docs: "docs/guides/a.txt" is not allowed; docs/ holds the files and folders listed in packages/lint/src/docs.ts',
  ]);
});

test("Markdown lives in a README, a package's docs/, records/, generated/ or a listed place", () => {
  const fine = [
    "packages/world/docs/reset.md",
    "packages/world/records/run-1/notes.md",
    "packages/world/generated/index.md",
    "packages/platform/bootstrap/BOOTSTRAP.md",
    "packages/blueprint/decisions.md",
    ".claude/skills/conductor/SKILL.md",
    "packages/contracts/lib/forge-std/CONTRIBUTING.md",
  ];
  assert.deepEqual(problems(fine), []);
  assert.deepEqual(problems(["packages/world/notes.md", "packages/world/docs/deep/a.md"]), [
    'markdown: "packages/world/notes.md" is not where a doc may live: a README.md, packages/<name>/docs/, docs/, records/ or generated/',
    'markdown: "packages/world/docs/deep/a.md" is not where a doc may live: a README.md, packages/<name>/docs/, docs/, records/ or generated/',
  ]);
});

const long = (file: string): number => (file === "packages/lint/README.md" ? MAX_README_LINES + 1 : 10);

test("a README longer than a screen is a problem unless it is on the shrinking list", () => {
  assert.deepEqual(problems([], long), [
    `readme: "packages/lint/README.md" has ${MAX_README_LINES + 1} lines; a README fits on a screen of ${MAX_README_LINES}`,
  ]);
});

test("a README on the list that now fits must come off it", () => {
  const listed = LONG_READMES[0] ?? "";
  const rest = (file: string): number => (file === listed ? 10 : MAX_README_LINES + 1);
  const found = docProblems({ files: [...LONG_READMES], lines: rest, read });
  assert.deepEqual(found, [
    `readme: "${listed}" fits on a screen; take it off LONG_READMES in packages/lint/src/docs.ts`,
  ]);
});

test("the shrinking lists only shrink", () => {
  assert.ok(LONG_READMES.length <= 3, "LONG_READMES may only shrink: lower this ceiling with it");
  assert.ok(UNSTATED_NOTES.length <= 1, "UNSTATED_NOTES may only shrink: lower this ceiling with it");
});

test("every relative link resolves to a file or folder git tracks", () => {
  const broken: Readonly<Record<string, string>> = {
    ...texts,
    "docs/grounding.md": "Use [the roadmap](docs/roadmap.md) and [CI](https://x.test/a).",
  };
  assert.deepEqual(
    problems(["docs/grounding.md"], short, (file) => broken[file] ?? ""),
    ['link: "docs/grounding.md" links to "docs/roadmap.md", which git does not track'],
  );
});

test("links are read outside code, without their anchor", () => {
  assert.deepEqual(linkTargets("[a](b.md#c) `[x](y)` [m](mailto:z) [h](#top)\n```\n[p](q)\n```"), ["b.md"]);
  assert.equal(resolve("docs/design/a.md", "../roadmap.md"), "docs/roadmap.md");
  assert.equal(resolve("packages/world/README.md", "/AGENTS.md"), "AGENTS.md");
  assert.equal(resolve("README.md", "./packages/lint"), "packages/lint");
});

test("a design note states its status near its top", () => {
  const unstated: Readonly<Record<string, string>> = { ...texts, "docs/design/b.md": "# B\n\nNo status here.\n" };
  assert.deepEqual(
    problems(["docs/design/b.md"], short, (file) => unstated[file] ?? ""),
    ['design: "docs/design/b.md" does not say "Status: open", "agreed" or "superseded" in its first 10 lines'],
  );
});
