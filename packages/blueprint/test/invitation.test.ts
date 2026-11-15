// Item 3.10's proof (docs/roadmap.md; docs/design/blueprint.md, parts 5, 9, 10 and 14): every format exists in the
// toolkit, and the invitation is in every one of them: its lifecycle, who may call, spans and logs, its budget, its
// promises, telemetry names and the glossary's words. The delta check runs every format over the blueprint, which
// passes itself to the toolkit (the toolkit imports nothing of it); every other operation sits on each format's
// `unmigrated` list until it is climbed. Written first, by the ✍️ author of 3.10, before it is built: each test fails
// today. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { countOldWords } from "@capxul/blueprint-tools";
import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import * as Blueprint from "../src/index.ts";
import { allClaims, glossary, operations, refusalsOf, StepKinds, type Operation } from "../src/index.ts";
import { arrayOf, blueprint, field, functionFromToolkit, recordOf } from "./format-door.ts";

/** The formats every operation has once it is climbed (docs/design/blueprint.md, part 14, part 1), by name. */
const FORMATS = ["machine", "allowed", "spans", "logs", "budget", "promises", "telemetry"];

/** The invitation's operations, named from their paths (./names.test.ts). */
const INVITATION = ["invitation.send", "invitation.list", "invitation.accept", "invitation.decline"];

/** Refusals no handler decides: a payload its schema rejects, and an operation not switched on yet. */
const UNDECIDED = ["PayloadRejected", "NotImplemented"];

/** Who is refused for not being among an invitation operation's `allowed`, by its refusal's tag; null when no one. */
const REFUSES_OTHERS: { readonly [operation: string]: string | null } = {
  "invitation.send": "CannotManagePeople",
  "invitation.list": null,
  "invitation.accept": "NotYourInvitation",
  "invitation.decline": "NotYourInvitation",
};

/** The waits a budget may leave out (the toolkit's `Wait`). */
const WAITS = ["waking a parked world", "a person signing", "chain confirmation on a public chain"];

const all: { readonly [name: string]: Operation } = operations;

/** The invitation's operation `name`, failing when the blueprint declares none. */
const invitation = (name: string): Operation => {
  const operation = all[name];
  assert.ok(
    operation !== undefined,
    `the blueprint declares no operation ${name}: the invitation's verbs are named from their paths`,
  );
  return operation;
};

/** The format registry the toolkit builds from the blueprint it is given. */
const registry = (): { readonly [format: string]: unknown } =>
  recordOf(
    functionFromToolkit(
      "formats",
      "formats(blueprint) builds the delta check's registry from the blueprint it is given, so the toolkit imports nothing of the blueprint (docs/design/blueprint.md, part 5, next steps, item 4)",
    )(Blueprint),
    "formats(blueprint)",
  );

/** The refusals `operation` declares that a handler decides. */
const decided = (operation: Operation) =>
  Arr.filter(refusalsOf(operation), (refusal) => !Arr.contains(UNDECIDED, refusal.identifier));

test("the delta check's registry, built from the blueprint it is given, holds every format", () => {
  const names = Rec.keys(registry());
  assert.deepEqual(
    Arr.filter(FORMATS, (format) => !Arr.contains(names, format)),
    [],
    `the registry has only ${Arr.join(names, ", ")}`,
  );
});

test("no format's unmigrated list holds an invitation operation, and the delta check finds nothing", () => {
  const formats = registry();
  const listed = Arr.flatMap(Rec.toEntries(formats), ([format, declared]) =>
    Arr.map(
      Arr.filter(
        Arr.filter(arrayOf(field(declared, "unmigrated"), `${format}'s unmigrated list`), Predicate.isString),
        (name) => Arr.contains(INVITATION, name) || Str.startsWith("invite.")(name) || name === "org.member.invite",
      ),
      (name) => `${format}: ${name}`,
    ),
  );
  assert.deepEqual(listed, [], "the invitation's operations are in every format, on no unmigrated list");
  const findings = functionFromToolkit(
    "deltaCheck",
    "the delta check, run over the blueprint it is given",
  )({
    operations: Rec.keys(all),
    formats,
  });
  assert.deepEqual(findings, []);
});

test("who may call: each invitation operation names its allowed roles, each declared once, and the refusal for anyone else", () => {
  assert.ok("roles" in blueprint, "the blueprint's door exports no `roles`: each role is declared once (roadmap 5.1)");
  const roles = Rec.values(recordOf(blueprint["roles"], "the blueprint's roles"));
  for (const name of INVITATION) {
    const operation = invitation(name);
    const allowed = arrayOf(field(operation, "allowed"), `${name}'s \`allowed\``);
    assert.ok(allowed.length > 0, `${name} allows no role`);
    for (const role of allowed)
      assert.ok(Arr.contains(roles, role), `${name} allows a role the blueprint does not declare`);
    assert.ok("refusesOthers" in operation, `${name} does not say how it refuses a caller of no allowed role`);
    const refuses: unknown = field(operation, "refusesOthers");
    const expected = REFUSES_OTHERS[name] ?? null;
    assert.equal(
      field(refuses, "identifier") ?? refuses,
      expected,
      `${name} refuses anyone else with the wrong refusal`,
    );
    if (refuses !== null)
      assert.ok(
        Arr.contains(refusalsOf(operation), refuses),
        `${name} refuses others with a refusal it does not declare`,
      );
  }
});

test("spans and logs: each invitation operation declares its spans, its logs, and the log of every refusal it decides", () => {
  for (const name of INVITATION) {
    const operation = invitation(name);
    const spans = Rec.values(recordOf(field(operation, "spans"), `${name}'s \`spans\``));
    const logs = Rec.values(recordOf(field(operation, "logs"), `${name}'s \`logs\``));
    assert.ok(spans.length > 0, `${name} declares no span`);
    const refusals = recordOf(field(operation, "refusals"), `${name}'s \`refusals\`, the log that decides each`);
    for (const refusal of decided(operation)) {
      const deciding = refusals[refusal.identifier];
      assert.ok(deciding !== undefined, `${name}: no log is written where ${refusal.identifier} is decided`);
      assert.ok(Arr.contains(logs, deciding), `${name}: ${refusal.identifier}'s log is not one of its own logs`);
    }
    for (const tag of Rec.keys(refusals))
      assert.ok(
        Arr.some(decided(operation), (refusal) => refusal.identifier === tag),
        `${name}: a log for ${tag}, a refusal it does not decide`,
      );
    for (const log of logs) assert.ok(Predicate.hasProperty(log, "schema"), `${name}: a log without a schema`);
  }
});

test("telemetry names: every span of the invitation is of a declared step kind, and every span and log is named under its operation", () => {
  const kinds = Rec.keys(StepKinds.STEP_KINDS);
  const names: Array<string> = [];
  for (const name of INVITATION) {
    const operation = invitation(name);
    const spans = Rec.values(recordOf(field(operation, "spans"), `${name}'s \`spans\``));
    const logs = Rec.values(recordOf(field(operation, "logs"), `${name}'s \`logs\``));
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

test("the budget format is registered, and each invitation operation meets it", () => {
  assert.ok("budget" in registry(), "the registry has no budget format");
  for (const name of INVITATION) {
    const { budget } = invitation(name);
    assert.ok(budget.ms > 0, `${name}: a budget of ${budget.ms} ms`);
    assert.ok(Str.trim(budget.basis).length > 0, `${name}: a budget with no basis`);
    for (const wait of budget.excludes) assert.ok(Arr.contains(WAITS, wait), `${name}: leaves out ${wait}, not a wait`);
  }
});

test("the promises format is registered, and every refusal an invitation operation decides is in one of its promises", () => {
  assert.ok("promises" in registry(), "the registry has no promises format");
  const promises: { readonly [name: string]: (typeof allClaims)[keyof typeof allClaims] | undefined } = allClaims;
  for (const name of INVITATION) {
    const declared = promises[name];
    assert.ok(declared !== undefined, `${name} has no promises`);
    assert.ok(declared.claims.length > 0, `${name} promises nothing`);
    const promised = Arr.flatMap(declared.claims, (claim) => claim.refusals);
    for (const refusal of decided(invitation(name)))
      assert.ok(Arr.contains(promised, refusal), `${name}: no promise names ${refusal.identifier}`);
  }
});

test("the glossary's words: the invitation's files write no old word", () => {
  const folder = new URL("../src/things/invitation/", import.meta.url);
  const files = Arr.map(
    Arr.filter(readdirSync(folder, { recursive: true, encoding: "utf8" }), (path) => Str.endsWith(".ts")(path)),
    (path) => ({
      path: `packages/blueprint/src/things/invitation/${path}`,
      text: readFileSync(new URL(path, folder), "utf8"),
    }),
  );
  const counted = Arr.filter(Rec.toEntries(countOldWords(glossary, files)), ([, count]) => count > 0);
  assert.deepEqual(
    counted,
    [],
    "old words in src/things/invitation/ (`pnpm words --where <word>` lists them): write the glossary's word",
  );
});
