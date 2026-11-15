// The toolkit stands alone (docs/design/blueprint.md, part 5, next steps, item 4; roadmap item 3.10): it imports
// nothing of the blueprint, not by relative path (`../../../blueprint/src/index.ts`) nor by name; the blueprint passes
// itself to the checks, so whatever checks the blueprint's own declarations lives in the blueprint's tests and entries.
// And the blueprint's pages are written inside `pnpm generate`, not by a command of their own. Written first, by the
// ✍️ author of 3.10, before it is built: each test fails today. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Str from "effect/String";

const PACKAGE = new URL("../", import.meta.url);

/** Every TypeScript file of the toolkit under `folder`, by its path in the package, with its text. */
const filesUnder = (folder: string) =>
  Arr.map(
    Arr.filter(readdirSync(new URL(folder, PACKAGE), { recursive: true, encoding: "utf8" }), (path) =>
      Str.endsWith(".ts")(path),
    ),
    (path) => ({ path: `${folder}${path}`, text: readFileSync(new URL(`${folder}${path}`, PACKAGE), "utf8") }),
  );

/** Where a file imports the blueprint: a specifier into packages/blueprint/, or the package by its name. */
const BLUEPRINT_IMPORT = /(?:from|import)\s*\(?\s*"(?:[./]*\/blueprint\/[^"]*|@capxul\/blueprint(?:\/[^"]*)?)"/g;

test("nothing of the toolkit, its code or its tests, imports the blueprint", () => {
  const importing = Arr.flatMap([...filesUnder("src/"), ...filesUnder("test/")], ({ path, text }) =>
    Arr.map(Arr.fromIterable(Str.matchAll(BLUEPRINT_IMPORT)(text)), (match) => `${path}: ${match[0]}`),
  );
  assert.deepEqual(importing, [], "the blueprint passes itself to the checks; the toolkit imports nothing of it");
});

test("the toolkit's package has no command of its own for the pages: `pnpm generate` writes them", () => {
  const manifest = readFileSync(new URL("package.json", PACKAGE), "utf8");
  assert.ok(
    !Str.includes('"claims":')(manifest),
    "packages/blueprint-tools still has `pnpm claims`, writing the pages",
  );
  const generate = readFileSync(new URL("../generate/src/main.ts", PACKAGE), "utf8");
  assert.ok(
    /\brender(?:Claims|Pages)\b/.test(generate),
    "packages/generate/src/main.ts renders no blueprint page: `pnpm generate` writes packages/blueprint/generated/<thing>.md",
  );
});
