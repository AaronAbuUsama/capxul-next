// The cycle removed (docs/design/blueprint.md, part 5, stage 2b: "the cycle removed so machines import their
// operations and events"; part 7, F7: "operations and events are named by import, not by string"). Today the
// invitation's lifecycle names its operations, events and refusal by their tags, because those declarations import
// its state schemas (see its header). Once the cycle is gone, the machine holds the declarations themselves: each
// start and move is tied to its operation's declaration, sends an event declaration that operation emits, and refuses
// with a refusal declaration that operation declares. How the imports are reordered is the builder's: the operation
// may be the move's `by`, or (part 7's sketch) the one operation whose `moves` holds the move. Written first, by the
// ✍️ author of 3.6's people checks, before it is built: each test fails today. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { eventNamesOf, kindOf } from "@capxul/blueprint-tools";
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import { Errors, machines, operations, People, refusalsOf, type Operation } from "../src/index.ts";
import { field } from "./format-door.ts";

const LIFECYCLE = new URL("../src/things/invitation/lifecycle.ts", import.meta.url);

const all: ReadonlyArray<Operation> = Rec.values(operations);

/** Every operation, refusal and event the blueprint declares, by the name a string would write it with. */
const declaredNames: ReadonlyArray<string> = Arr.dedupe([
  ...Rec.keys(operations),
  ...Rec.keys(Errors.refusals),
  ...Arr.flatMap(all, (operation) => eventNamesOf(operation)),
]);

/** The string literals of `text`, its comments left out. */
const literalsOf = (text: string): ReadonlyArray<string> => {
  const code = pipe(text, Str.replace(/\/\*[\s\S]*?\*\//g, ""), Str.replace(/(^|[^:"'`])\/\/.*$/gm, "$1"));
  return Arr.map(Arr.fromIterable(Str.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)(code)), (match) => match[2] ?? "");
};

/** A start or a move of a machine, as declared. */
type Made = { readonly by?: unknown; readonly event?: unknown; readonly otherwise?: unknown };

/** The operation declaration that makes `made`: its `by` itself, or the one operation whose `moves` holds it. */
const operationOf = (made: Made, where: string): Operation => {
  const own = Arr.findFirst(all, (operation) => operation === made.by);
  if (own._tag === "Some") return own.value;
  const holders = Arr.filter(all, (operation) => {
    const moves = field(operation, "moves");
    return Arr.isArray(moves) && Arr.contains(moves, made);
  });
  assert.equal(
    holders.length,
    1,
    `${where} is made by ${String(made.by)}: neither an operation's declaration nor held by exactly one operation's \`moves\``,
  );
  const [holder] = holders;
  assert.ok(holder !== undefined);
  return holder;
};

/** The invitation's start and each of its moves, by where each is declared. */
const made = (): ReadonlyArray<readonly [string, Made]> => {
  const machine = machines.invitation;
  return [
    ["invitation's start", machine.start],
    ...Arr.map(Rec.toEntries(machine.moves), ([name, move]): readonly [string, Made] => [`invitation.${name}`, move]),
  ];
};

test("the invitation's lifecycle names no operation, event or refusal by a string", () => {
  const written = Arr.filter(literalsOf(readFileSync(LIFECYCLE, "utf8")), (literal) =>
    Arr.contains(declaredNames, literal),
  );
  assert.deepEqual(
    written,
    [],
    "src/things/invitation/lifecycle.ts writes declared names as strings: import their declarations instead",
  );
});

test("the invitation's start and moves are each made by an operation's declaration, the one the domain declares", () => {
  const expected: { readonly [where: string]: unknown } = {
    "invitation's start": People.invitationSend,
    "invitation.accept": People.invitationAccept,
    "invitation.decline": People.invitationDecline,
  };
  for (const [where, each] of made()) {
    const operation = operationOf(each, where);
    assert.equal(kindOf(operation), "verb", `${where}: made by something that is no verb`);
    assert.equal(operation, expected[where], `${where}: made by the wrong operation`);
  }
});

test("each start and move of the invitation sends an event declaration its operation emits", () => {
  for (const [where, each] of made()) {
    assert.equal(
      kindOf(each.event),
      "event",
      `${where} sends ${String(each.event)}, a string, not an event declaration`,
    );
    const operation = operationOf(each, where);
    assert.ok(
      Arr.some(operation.emits, (emitted) => emitted === each.event),
      `${where}: its event is not one its operation emits`,
    );
  }
});

test("each refusal the invitation's moves name is a refusal declaration its operation declares", () => {
  for (const [where, each] of made()) {
    const otherwise = Predicate.isObject(each.otherwise) ? Rec.toEntries({ ...each.otherwise }) : [];
    for (const [state, what] of otherwise) {
      if (what === "unchanged") continue;
      const refusal = field(what, "refusal");
      assert.equal(
        kindOf(refusal),
        "refusal",
        `${where} from ${state}: refuses with ${String(refusal)}, not a refusal declaration`,
      );
      assert.ok(
        Arr.some(refusalsOf(operationOf(each, where)), (declared) => declared === refusal),
        `${where} from ${state}: its operation does not declare that refusal`,
      );
    }
  }
});
