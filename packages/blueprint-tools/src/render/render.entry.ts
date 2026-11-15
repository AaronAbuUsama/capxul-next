// `pnpm claims`: writes the blueprint's pages (packages/blueprint/generated/) from its declarations. Run it after
// changing a promise, a starting point or a verb's declaration; a test fails while a page differs from its sources.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import * as Arr from "effect/Array";
import * as Str from "effect/String";
import { layoutOf } from "./layout.ts";
import { renderClaims } from "./render.ts";

const blueprint = new URL("../../../blueprint/", import.meta.url);
const things = new URL("src/things/", blueprint);
const files = Arr.map(
  Arr.filter(readdirSync(things, { recursive: true, encoding: "utf8" }), (path) => Str.endsWith(".ts")(path)),
  (path) => ({ path, text: readFileSync(new URL(path, things), "utf8") }),
);
const layout = layoutOf(files);
if (layout.problems.length > 0) throw new Error(`the blueprint's layout:\n${Arr.join(layout.problems, "\n")}`);
for (const { path, text } of renderClaims(layout)) writeFileSync(new URL(path, blueprint), text);
