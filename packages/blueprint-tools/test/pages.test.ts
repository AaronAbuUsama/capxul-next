// How the blueprint's folders read as a layout, on made-up things: every verb declares one operation, its server and
// its promises. That the blueprint's own pages are what its declarations render is the blueprint's own test
// (packages/blueprint/test/pages.test.ts). Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import { layoutOf } from "../src/index.ts";

test("a verb that misses a part of its file is a problem the layout names", () => {
  const broken = layoutOf([
    {
      path: "ticket/verbs/open.ts",
      text: 'const r = Rpc.make("ticket.open", {});\nexport const open = verb({});\n',
    },
  ]);
  assert.deepEqual(broken.problems, [
    'ticket/verbs/open.ts: a verb exports `server`, "platform" or "world"',
    "ticket/verbs/open.ts: a verb exports its `promises`",
    "ticket: a thing has at least one verb",
  ]);
});

test("a verb outside verbs/, and a thing's own file inside it, are problems the layout names", () => {
  const misplaced = layoutOf([
    { path: "ticket/close.ts", text: 'export const ticketClose = work({\n  name: "ticket.close",\n});\n' },
    { path: "ticket/verbs/values.ts", text: "export const Ticket = 1;\n" },
    { path: "ticket/verbs/old/close.ts", text: "" },
  ]);
  assert.deepEqual(misplaced.problems, [
    "ticket/close.ts: a verb's file lives in its thing's verbs/ folder",
    "ticket/verbs/values.ts: verbs/ holds only verbs; values.ts sits beside it, in the thing's folder",
    "ticket/verbs/old/close.ts: src/things/ holds one folder per thing, each with its own files and a verbs/ folder",
  ]);
});

test("a verb that is work no door serves reads as work, named by its thing and verb, with no Rpc", () => {
  const read = layoutOf([
    {
      path: "ticket/verbs/close.ts",
      text: 'export const ticketClose = work({\n  name: "ticket.close",\n  does: "",\n});\n',
    },
  ]);
  assert.deepEqual(read.problems, []);
  assert.deepEqual(
    Arr.map(read.things[0]?.works ?? [], (each) => [each.name, each.declaration]),
    [["ticket.close", "ticketClose"]],
  );
  const misnamed = layoutOf([
    {
      path: "ticket/verbs/close.ts",
      text: 'export const ticketClose = work({\n  name: "ticket.shut",\n});\nconst r = Rpc.make("ticket.close", {});\n',
    },
  ]);
  assert.deepEqual(misnamed.problems, [
    "ticket/verbs/close.ts: work no door serves declares no Rpc",
    "ticket/verbs/close.ts: its work is named `ticket.close`, not `ticket.shut`",
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
      path: "ticket/verbs/open.ts",
      text:
        'const r = Rpc.make("ticket.open", {});\nexport const open = verb({});\nexport const server = "world";\n' +
        "export const promises = {};\n",
    },
  ]);
  const [ticket] = things;
  assert.deepEqual(ticket?.parts["values.ts"]?.exports.values, ["Ticket"]);
  assert.equal(ticket?.parts["values.ts"]?.subjects, true);
  assert.deepEqual(ticket?.verbs[0]?.exports.values, ["open"]);
});
