// Every package has its generated map, or is on the shrinking list of packages without one.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mapProblems, UNMAPPED } from "../src/maps.ts";

const mapped = ["packages/a/README.md", "packages/a/src/x.ts", "packages/a/generated/index.md"];

test("a package with its map has no problems", () => {
  assert.deepEqual(mapProblems(mapped), []);
});

test("a package with no map is a problem unless it is on the shrinking list", () => {
  assert.deepEqual(mapProblems([...mapped, "packages/b/README.md"]), [
    'map: "packages/b" has no generated/index.md; run `pnpm generate` and commit it',
  ]);
  const listed = UNMAPPED[0] ?? "";
  assert.deepEqual(mapProblems([...mapped, `${listed}/README.md`]), []);
});

test("a package on the list that has its map must come off it", () => {
  const listed = UNMAPPED[0] ?? "";
  assert.deepEqual(mapProblems([`${listed}/README.md`, `${listed}/generated/index.md`]), [
    `map: "${listed}" has its generated/index.md; take it off UNMAPPED in packages/lint/src/maps.ts`,
  ]);
});

test("the list of packages without a map only shrinks", () => {
  assert.ok(UNMAPPED.length <= 3, "UNMAPPED may only shrink: lower this ceiling with it");
});
