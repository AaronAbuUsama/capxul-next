// The blueprint's pages (generated/) are what its declarations render, and its folders read as a layout with no
// problem. `pnpm generate` writes the pages (the toolkit's `renderPages`, given the blueprint); this test fails when one
// on disk differs. Moved from packages/blueprint-tools' tests by item 3.10. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { layoutOf, Ratchets, renderPages, type ThingFile } from "@capxul/blueprint-tools";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import * as Blueprint from "../src/index.ts";

const BLUEPRINT = new URL("../", import.meta.url);
const THINGS = new URL("src/things/", BLUEPRINT);

const files: ReadonlyArray<ThingFile> = Arr.map(
  Arr.filter(readdirSync(THINGS, { recursive: true, encoding: "utf8" }), (path) => Str.endsWith(".ts")(path)),
  (path) => ({ path, text: readFileSync(new URL(path, THINGS), "utf8") }),
);
const layout = layoutOf(files);

test("the blueprint's things read as a layout with no problem", () => {
  assert.deepEqual(layout.problems, []);
  assert.ok(layout.things.length > 0, "no thing was read");
});

test("every page in generated/ is what the sources render, and no other page is there but the ratchets' two", () => {
  const rendered = renderPages(layout, Blueprint);
  for (const { path, text } of rendered) {
    const onDisk = readFileSync(new URL(path, BLUEPRINT), "utf8");
    assert.equal(onDisk, text, `packages/blueprint/${path} is out of date: run \`pnpm generate\``);
  }
  // The glossary's page, the count of its old words and the ratchets' outputs are written beside them, not rendered here.
  const notPages: ReadonlyArray<string> = [
    ...Rec.values(Ratchets.OUTPUTS),
    "generated/glossary.md",
    "generated/old-words.json",
  ];
  const pages = Arr.filter(
    Arr.map(readdirSync(new URL("generated/", BLUEPRINT)), (name) => `generated/${name}`),
    (page) => !Arr.contains(notPages, page),
  );
  assert.deepEqual(
    Arr.sort(pages, Order.String),
    Arr.sort(
      Arr.map(rendered, (page) => page.path),
      Order.String,
    ),
  );
});
