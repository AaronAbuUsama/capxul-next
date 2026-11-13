import { strict as assert } from "node:assert";
import { test } from "node:test";
import { shapeProblems } from "../src/shape.ts";

const clean = [
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "docs/roadmap.md",
  ".github/workflows/check.yml",
  "packages/lint/README.md",
  "packages/lint/src/shape.ts",
  "spikes/state/README.md",
  "spikes/state/run.sh",
];
const short = (): number => 10;

test("a tree in shape has no problems", () => {
  assert.deepEqual(shapeProblems({ files: clean, lines: short }), []);
});

test("an entry at the top level that is not listed is a problem", () => {
  const problems = shapeProblems({ files: [...clean, "START-HERE.md", "evals/x.ts"], lines: short });
  assert.deepEqual(problems, [
    'top level: "START-HERE.md" is not in the list in packages/lint/src/shape.ts',
    'top level: "evals" is not in the list in packages/lint/src/shape.ts',
  ]);
});

test("only the roadmap lives under docs", () => {
  const problems = shapeProblems({ files: [...clean, "docs/philosophy.md"], lines: short });
  assert.deepEqual(problems, ['docs: "docs/philosophy.md" is not allowed; only docs/roadmap.md lives under docs/']);
});

test("a package not in the allowlist is a problem", () => {
  const problems = shapeProblems({ files: [...clean, "packages/portal/README.md"], lines: short });
  assert.deepEqual(problems, ['packages: "portal" is not in the allowlist in packages/lint/src/shape.ts']);
});

test("a package or a spike without a README is a problem", () => {
  const problems = shapeProblems({ files: [...clean, "packages/world/src/main.ts", "spikes/pipeline/run.sh"], lines: short });
  assert.deepEqual(problems, ["packages/world: has no README.md", "spikes/pipeline: has no README.md"]);
});

test("loose files under packages or spikes are problems", () => {
  const problems = shapeProblems({ files: [...clean, "packages/README.md", "spikes/README.md"], lines: short });
  assert.deepEqual(problems, [
    'packages: "packages/README.md" is a loose file; packages/ holds only folders',
    'spikes: "spikes/README.md" is a loose file; spikes/ holds only folders',
  ]);
});

test("a source file over 300 lines is a problem, vendored code is not", () => {
  const files = [...clean, "packages/contracts/README.md", "packages/contracts/lib/forge-std/src/Test.sol", "packages/contracts/lib/x.js"];
  const lines = (file: string): number => (file === "packages/lint/src/shape.ts" || file.endsWith("x.js") ? 301 : 10);
  assert.deepEqual(shapeProblems({ files, lines }), [
    'size: "packages/lint/src/shape.ts" has 301 lines; the limit is 300',
  ]);
});
