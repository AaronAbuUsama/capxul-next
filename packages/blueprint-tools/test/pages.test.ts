// The blueprint's pages (packages/blueprint/generated/) are what its declarations render, and its folders read as a
// layout with no problem: every verb declares one operation, its server and its promises. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import * as Str from "effect/String";
import { layoutOf, type ThingFile } from "../src/index.ts";
import { renderClaims } from "../src/render/render.ts";

const BLUEPRINT = new URL("../../blueprint/", import.meta.url);
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

test("every page in generated/ is what the sources render, and no other page is there", () => {
  const rendered = renderClaims(layout);
  for (const { path, text } of rendered) {
    const onDisk = readFileSync(new URL(path, BLUEPRINT), "utf8");
    assert.equal(onDisk, text, `packages/blueprint/${path} is out of date: run \`pnpm claims\``);
  }
  const pages = Arr.map(readdirSync(new URL("generated/", BLUEPRINT)), (name) => `generated/${name}`);
  assert.deepEqual(
    Arr.sort(pages, Order.String),
    Arr.sort(
      Arr.map(rendered, (page) => page.path),
      Order.String,
    ),
  );
});

test("a verb that misses a part of its file is a problem the layout names", () => {
  const broken = layoutOf([
    { path: "ticket/open.ts", text: 'const r = Rpc.make("ticket.open", {});\nexport const open = declare({});\n' },
  ]);
  assert.deepEqual(broken.problems, [
    'ticket/open.ts: a verb exports `server`, "platform" or "world"',
    "ticket/open.ts: a verb exports its `promises`",
    "ticket: a thing has at least one verb",
  ]);
});

test("a name marked @internal, and the reserved ones, are not the package's", () => {
  const { things } = layoutOf([
    {
      path: "ticket/values.ts",
      text:
        "/** @internal Shared by the ticket's verbs. */\nexport const Shared = 1;\nexport const Ticket = 2;\n" +
        "export const subjects = [];\n",
    },
    {
      path: "ticket/open.ts",
      text:
        'const r = Rpc.make("ticket.open", {});\nexport const open = declare({});\nexport const server = "world";\n' +
        "export const promises = {};\n",
    },
  ]);
  const [ticket] = things;
  assert.deepEqual(ticket?.parts["values.ts"]?.exports.values, ["Ticket"]);
  assert.equal(ticket?.parts["values.ts"]?.subjects, true);
  assert.deepEqual(ticket?.verbs[0]?.exports.values, ["open"]);
});
