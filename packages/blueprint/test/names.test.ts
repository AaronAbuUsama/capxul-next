// The name comes from the path, and is checked (docs/design/blueprint.md, part 13, "Amended", point 3; roadmap item
// 3.10). A verb's operation is named `<thing>.<verb>` from its path, so the command is `capxul <thing> <verb>`, the
// SDK call `<thing>.<verb>` and the span `<thing>.<verb>`. The verbs whose name differs today sit on ratchet R16's
// list in src/ratchets.ts, which may only shrink; the invitation's four are renamed first, as 3.10's proof. Written
// first, by the ✍️ author of 3.10, before it is built: each test fails today. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { layoutOf, verbsOf, type ThingFile } from "@capxul/blueprint-tools";
import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import { machines, operations } from "../src/index.ts";
import { ratchets } from "../src/ratchets.ts";
import { arrayOf, field } from "./format-door.ts";

const THINGS = new URL("../src/things/", import.meta.url);
const files: ReadonlyArray<ThingFile> = Arr.map(
  Arr.filter(readdirSync(THINGS, { recursive: true, encoding: "utf8" }), (path) => Str.endsWith(".ts")(path)),
  (path) => ({ path, text: readFileSync(new URL(path, THINGS), "utf8") }),
);
const verbs = verbsOf(layoutOf(files));

/** The most names R16's list may hold: today's 21 that differ, less the invitation's 4. Set by 3.10; may only fall. */
const CEILING = 17;

/** The invitation's verbs, each named from its path. */
const INVITATION = ["invitation.send", "invitation.list", "invitation.accept", "invitation.decline"];

/** R16, as the registry declares it. */
const r16 = Arr.findFirst(ratchets, (ratchet) => ratchet.id === "R16");

/** R16's list: the names allowed to differ from their path today. */
const listed = (): ReadonlyArray<string> => {
  assert.ok(r16._tag === "Some", "src/ratchets.ts registers no R16, the names that differ from their path");
  return Arr.filter(arrayOf(field(r16.value, "unmigrated"), "R16's `unmigrated` list"), Predicate.isString);
};

test("R16 is registered, counted, with an `unmigrated` list of at most 17 names", () => {
  assert.ok(r16._tag === "Some", "src/ratchets.ts registers no R16, the names that differ from their path");
  assert.notEqual(r16.value.count, "not yet counted", "R16 is counted by its list, today");
  const list = listed();
  assert.ok(list.length <= CEILING, `R16's list holds ${list.length} names; it may hold at most ${CEILING}`);
  assert.deepEqual(list, Arr.dedupe(list), "R16's list names an operation more than once");
});

test("every verb's operation is named <thing>.<verb> from its path, or is on R16's list", () => {
  const list = listed();
  const differing = Arr.filter(verbs, (verb) => verb.operation !== `${verb.thing}.${verb.verb}`);
  const unlisted = Arr.filter(differing, (verb) => !Arr.contains(list, verb.operation));
  assert.deepEqual(
    Arr.map(unlisted, (verb) => `things/${verb.path}: named ${verb.operation}, not ${verb.thing}.${verb.verb}`),
    [],
  );
  const stale = Arr.filter(list, (name) => !Arr.some(differing, (verb) => verb.operation === name));
  assert.deepEqual(
    stale,
    [],
    "R16's list names operations that are no verb's or already match their path: remove them",
  );
});

test("R16's list holds none of the invitation's verbs: they are named from their paths", () => {
  const list = listed();
  const invitation = Arr.filter(verbs, (verb) => verb.thing === "invitation");
  assert.deepEqual(
    Arr.filter(invitation, (verb) => Arr.contains(list, verb.operation)),
    [],
    "R16's list names an invitation verb",
  );
  assert.deepEqual(
    Arr.sort(
      Arr.map(invitation, (verb) => verb.operation),
      (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
    ),
    Arr.sort([...INVITATION], (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const names: ReadonlyArray<string> = Rec.keys(operations);
  for (const name of INVITATION) assert.ok(Arr.contains(names, name), `the blueprint declares no operation ${name}`);
});

test("the invitation's lifecycle names its operations by their path names", () => {
  const machine = machines.invitation;
  const named = [machine.start.by, ...Arr.map(Rec.values(machine.moves), (move) => move.by)];
  assert.deepEqual(
    Arr.filter(named, (name: string) => !Arr.contains(INVITATION, name)),
    [],
    "the invitation's machine is started or moved by an operation not named from its path",
  );
});
