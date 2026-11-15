// Item 3.6's last part (docs/roadmap.md; docs/design/blueprint.md, part 5, stage 2b): the domain `people` moved in
// full. Item 3.10 (./invitation.test.ts) climbed the invitation's four verbs onto every format; this extends the same
// checks to the whole domain, so `member.list` (today `org.member.list`, src/things/member/verbs/list.ts) climbs too:
// named from its path, on no format's `unmigrated` list, who may call it, its spans and logs, its budget, promises,
// telemetry names and the glossary's words. Written first, by the ✍️ author of 3.6's people checks, before it is
// built: each test naming `member.list` fails today. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { countOldWords, formats as formatsOf, WAITS } from "@capxul/blueprint-tools";
import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import * as Blueprint from "../src/index.ts";
import { allClaims, glossary, operations, People, refusalsOf, roles, StepKinds, type Operation } from "../src/index.ts";
import { ratchets } from "../src/ratchets.ts";
import { arrayOf, field, recordOf } from "./format-door.ts";

/** The domain's operations, each named `<thing>.<verb>` from its path (./names.test.ts). */
const PEOPLE = ["invitation.send", "invitation.list", "invitation.accept", "invitation.decline", "member.list"];

/** The name `member.list` has today, which goes once it is named from its path. */
const OLD_NAME = "org.member.list";

/** Refusals no handler decides: a payload its schema rejects, and an operation not switched on yet. */
const UNDECIDED = ["PayloadRejected", "NotImplemented"];

/**
 * Who is refused for not being among a people operation's `allowed`, by its refusal's tag; null when no one. Core
 * refuses a person who is no Director or member of the company with `NotAMember` (packages/core, people/invite.ts,
 * `memberList`), and lets the world's owner see every company.
 */
const REFUSES_OTHERS: { readonly [operation: string]: string | null } = {
  "invitation.send": "CannotManagePeople",
  "invitation.list": null,
  "invitation.accept": "NotYourInvitation",
  "invitation.decline": "NotYourInvitation",
  "member.list": "NotAMember",
};

const all: { readonly [name: string]: Operation } = operations;

/** The domain's operation `name`, failing when the blueprint declares none. */
const operation = (name: string): Operation => {
  const found = all[name];
  assert.ok(
    found !== undefined,
    `the blueprint declares no operation ${name}: the people's verbs are named from their paths`,
  );
  return found;
};

/** The refusals `declared` names that a handler decides. */
const decided = (declared: Operation) =>
  Arr.filter(refusalsOf(declared), (refusal) => !Arr.contains(UNDECIDED, refusal.identifier));

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

test("the domain people is the invitation's four verbs and member.list, each named from its path", () => {
  const names: ReadonlyArray<string> = Rec.keys(People.operations);
  assert.deepEqual(Arr.sort(names, byName), Arr.sort(PEOPLE, byName));
  assert.ok(!(OLD_NAME in all), `the blueprint still declares ${OLD_NAME}: it is member.list, from its path`);
  const r16 = Arr.findFirst(ratchets, (ratchet) => ratchet.id === "R16");
  assert.ok(r16._tag === "Some", "src/ratchets.ts registers no R16");
  const listed = arrayOf(field(r16.value, "unmigrated"), "R16's `unmigrated` list");
  assert.ok(!Arr.contains(listed, OLD_NAME), `R16's list still names ${OLD_NAME}`);
  assert.ok(listed.length <= 16, `R16's list holds ${listed.length} names; with member.list off it holds at most 16`);
});

test("no format's unmigrated list holds a people operation, by its name or its old one", () => {
  const registry = recordOf(formatsOf(Blueprint), "formats(blueprint)");
  const listed = Arr.flatMap(Rec.toEntries(registry), ([format, declared]) =>
    Arr.map(
      Arr.filter(
        Arr.filter(arrayOf(field(declared, "unmigrated"), `${format}'s unmigrated list`), Predicate.isString),
        (name) => Arr.contains(PEOPLE, name) || name === OLD_NAME,
      ),
      (name) => `${format}: ${name}`,
    ),
  );
  assert.deepEqual(listed, [], "the people's operations are in every format, on no unmigrated list");
});

test("who may call: each people operation names its allowed roles, each declared once, and the refusal for anyone else", () => {
  const declaredRoles: ReadonlyArray<string> = Rec.values(roles);
  for (const name of PEOPLE) {
    const declared = operation(name);
    const allowed = arrayOf(field(declared, "allowed"), `${name}'s \`allowed\``);
    assert.ok(allowed.length > 0, `${name} allows no role`);
    for (const role of allowed)
      assert.ok(
        Arr.contains(declaredRoles, role),
        `${name} allows ${String(role)}, a role the blueprint does not declare`,
      );
    assert.ok("refusesOthers" in declared, `${name} does not say how it refuses a caller of no allowed role`);
    const refuses: unknown = field(declared, "refusesOthers");
    assert.equal(
      field(refuses, "identifier") ?? refuses,
      REFUSES_OTHERS[name] ?? null,
      `${name} refuses anyone else with the wrong refusal`,
    );
    if (refuses !== null)
      assert.ok(
        Arr.contains(refusalsOf(declared), refuses),
        `${name} refuses others with a refusal it does not declare`,
      );
  }
  const listing = operation("member.list");
  assert.ok(
    Arr.contains(arrayOf(field(listing, "allowed"), "member.list's `allowed`"), roles.operator),
    "member.list does not allow the world's operator, who sees every company's people",
  );
});

test("spans and logs: each people operation declares its spans, its logs, and the log of every refusal it decides", () => {
  for (const name of PEOPLE) {
    const declared = operation(name);
    const spans = Rec.values(recordOf(field(declared, "spans"), `${name}'s \`spans\``));
    const logs = Rec.values(recordOf(field(declared, "logs"), `${name}'s \`logs\``));
    assert.ok(spans.length > 0, `${name} declares no span`);
    const refusals = recordOf(field(declared, "refusals"), `${name}'s \`refusals\`, the log that decides each`);
    for (const refusal of decided(declared)) {
      const deciding = refusals[refusal.identifier];
      assert.ok(deciding !== undefined, `${name}: no log is written where ${refusal.identifier} is decided`);
      assert.ok(Arr.contains(logs, deciding), `${name}: ${refusal.identifier}'s log is not one of its own logs`);
    }
    for (const tag of Rec.keys(refusals))
      assert.ok(
        Arr.some(decided(declared), (refusal) => refusal.identifier === tag),
        `${name}: a log for ${tag}, a refusal it does not decide`,
      );
    for (const log of logs) assert.ok(Predicate.hasProperty(log, "schema"), `${name}: a log without a schema`);
  }
});

test("telemetry names: every span of the people is of a declared step kind, and every span and log is named under its operation", () => {
  const kinds = Rec.keys(StepKinds.STEP_KINDS);
  const names: Array<string> = [];
  for (const name of PEOPLE) {
    const declared = operation(name);
    const spans = Rec.values(recordOf(field(declared, "spans"), `${name}'s \`spans\``));
    const logs = Rec.values(recordOf(field(declared, "logs"), `${name}'s \`logs\``));
    for (const span of spans) {
      const kind = field(span, "kind");
      assert.ok(
        Predicate.isString(kind) && Arr.contains(kinds, kind),
        `${name}: a span of kind ${String(kind)}, not a step kind`,
      );
    }
    for (const each of [...spans, ...logs]) {
      const named = field(each, "name");
      assert.ok(
        Predicate.isString(named) && Str.startsWith(`${name}.`)(named),
        `${name}: ${String(named)} is not named under it`,
      );
      names.push(named);
    }
  }
  assert.deepEqual(names, Arr.dedupe(names), "a span or log name is declared twice");
});

test("budget: each people operation has one, with a basis, leaving out only declared waits", () => {
  for (const name of PEOPLE) {
    const { budget } = operation(name);
    assert.ok(budget.ms > 0, `${name}: a budget of ${budget.ms} ms`);
    assert.ok(Str.trim(budget.basis).length > 0, `${name}: a budget with no basis`);
    for (const wait of budget.excludes) assert.ok(Arr.contains(WAITS, wait), `${name}: leaves out ${wait}, not a wait`);
  }
});

test("promises: every refusal a people operation decides is in one of its promises", () => {
  const promises: { readonly [name: string]: (typeof allClaims)[keyof typeof allClaims] | undefined } = allClaims;
  for (const name of PEOPLE) {
    const declared = promises[name];
    assert.ok(declared !== undefined, `${name} has no promises`);
    assert.ok(declared.claims.length > 0, `${name} promises nothing`);
    const promised = Arr.flatMap(declared.claims, (claim) => claim.refusals);
    for (const refusal of decided(operation(name)))
      assert.ok(Arr.contains(promised, refusal), `${name}: no promise names ${refusal.identifier}`);
  }
});

test("the glossary's words: member.list's file writes no old word", () => {
  const path = "packages/blueprint/src/things/member/verbs/list.ts";
  const text = readFileSync(new URL("../src/things/member/verbs/list.ts", import.meta.url), "utf8");
  const counted = Arr.filter(Rec.toEntries(countOldWords(glossary, [{ path, text }])), ([, count]) => count > 0);
  assert.deepEqual(
    counted,
    [],
    `old words in ${path} (\`pnpm words --where <word>\` lists them): write the glossary's word`,
  );
});
