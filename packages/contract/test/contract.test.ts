// What the compiler cannot hold about the contract: twelve operations, each declared thing defined once, every
// example's events carrying exactly their event's fields, claims that name only what their operation declares, and
// claims.md matching its sources. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as ApprovalsOps from "../src/approvals/operations.ts";
import { allClaims } from "../src/claims/all.ts";
import { renderClaims } from "../src/claims/render.ts";
import * as DocumentsOps from "../src/documents/operations.ts";
import { operations, PlatformRpcs, WorldRpcs, type OperationName } from "../src/door.ts";
import * as Errors from "../src/errors.ts";
import { refusalsOf, type EventClass, type Operation } from "../src/operation.ts";
import * as OrganizationsOps from "../src/organizations/operations.ts";
import * as RecordOps from "../src/record/operations.ts";
import * as ReportsOps from "../src/reports/operations.ts";
import { startingWorlds } from "../src/starting-worlds.ts";
import * as Telemetry from "../src/telemetry.ts";
import * as Values from "../src/values.ts";
import * as WorldOps from "../src/world/operations.ts";

const names = Object.keys(operations) as Array<OperationName>;
const all: ReadonlyArray<[OperationName, Operation]> = names.map((name) => [name, operations[name]]);

test("the door lists exactly twelve operations, each under its own Rpc's name and served by exactly one group", () => {
  assert.equal(names.length, 12);
  for (const [name, operation] of all) assert.equal(operation.rpc._tag, name);
  const served = [...PlatformRpcs.requests.keys(), ...WorldRpcs.requests.keys()].sort();
  assert.deepEqual(served, [...names].sort());
});

const carriedCodec = (event: EventClass) => Schema.toCodecJson(Schema.Struct(Struct.omit(event.fields, ["_tag"])));

test("every example is a valid call, every outcome has one, and each declared event's carries gives exactly that event's fields", () => {
  for (const [name, operation] of all) {
    assert.ok(operation.examples.length > 0, `${name} has no example`);
    const seen = new Set<string | null>();
    for (const example of operation.examples) {
      assert.ok(Schema.is(operation.rpc.payloadSchema)(example.payload), `${name}: an example's payload is not of its schema`);
      assert.ok(Schema.is(operation.rpc.successSchema)(example.success), `${name}: an example's success is not of its schema`);
      const tag = operation.outcomes.length === 1 && operation.outcomes[0]?.tag === null ? null : (example.success as { _tag: string })._tag;
      seen.add(tag);
      const expected = operation.expected(example);
      assert.ok(Option.isSome(expected), `${name}: expected gave nothing for a valid example`);
      const outcome = operation.outcomes.find((candidate) => candidate.tag === tag);
      assert.deepEqual(expected.value.map((each) => each.event), outcome?.emits, `${name}: the example's events are not its outcome's`);
      for (const { event, carried } of expected.value) {
        const encoded = Schema.encodeUnknownExit(carriedCodec(event), { onExcessProperty: "error" })(carried);
        assert.ok(Exit.isSuccess(encoded), `${name}: what it declares for ${event.identifier} is not exactly ${event.identifier}'s fields`);
      }
    }
    for (const outcome of operation.outcomes) assert.ok(seen.has(outcome.tag), `${name}: no example of outcome ${outcome.tag}`);
    assert.ok(Option.isNone(operation.expected({ payload: { nonsense: true }, success: null })), `${name}: expected accepted a call that is not its own`);
  }
});

test("every budget is declared once, on its operation, and says where its number comes from", () => {
  for (const [name, operation] of all) {
    assert.ok(operation.budget.ms > 0, `${name}: no budget`);
    assert.equal(operation.budgetMs, operation.budget.ms);
    assert.ok(operation.budget.basis.length > 20, `${name}: the budget has no basis`);
  }
});

/** Every value the package exports, with where it is exported from. */
const modules = {
  "errors.ts": Errors, "values.ts": Values, "telemetry.ts": Telemetry, "world/operations.ts": WorldOps,
  "organizations/operations.ts": OrganizationsOps, "documents/operations.ts": DocumentsOps, "approvals/operations.ts": ApprovalsOps,
  "reports/operations.ts": ReportsOps, "record/operations.ts": RecordOps,
};
const exported = Object.entries(modules).flatMap(([file, module]) => Object.entries(module).map(([name, value]) => ({ file, name, value: value as unknown })));

const identifierOf = (value: unknown): string | undefined => {
  if (typeof value !== "function") return undefined;
  const candidate = value as { identifier?: unknown; key?: unknown };
  if (typeof candidate.identifier === "string") return `schema ${candidate.identifier}`;
  if (typeof candidate.key === "string") return `service ${candidate.key}`;
  return undefined;
};

test("no event, outcome, refusal or service is defined twice", () => {
  const byName = new Map<string, Set<unknown>>();
  for (const { value } of exported) {
    const id = identifierOf(value);
    if (id !== undefined) byName.set(id, (byName.get(id) ?? new Set()).add(value));
  }
  const twice = [...byName].filter(([, values]) => values.size > 1).map(([id]) => id);
  assert.deepEqual(twice, [], `defined more than once: ${twice.join(", ")}`);
});

test("every refusal is declared in errors.ts and nowhere else, and every operation refuses only with those", () => {
  const declared = new Set<unknown>(Object.values(Errors.refusals));
  for (const [tag, refusal] of Object.entries(Errors.refusals)) assert.equal(refusal.identifier, tag);
  for (const { file, name, value } of exported) {
    const isError = typeof value === "function" && value.prototype instanceof Error && identifierOf(value) !== undefined;
    if (isError) assert.ok(declared.has(value), `${file} defines the refusal ${name} outside errors.ts`);
  }
  for (const [name, operation] of all) {
    for (const refusal of refusalsOf(operation)) assert.ok(declared.has(refusal), `${name} refuses with ${refusal.identifier}, not from errors.ts`);
  }
});

test("starting worlds are declared once, and every claim and step names only declared things", () => {
  const worlds = Object.values(startingWorlds);
  assert.equal(new Set(worlds.map((world) => world.name)).size, worlds.length, "two starting worlds share a name");
  for (const world of worlds) {
    if (world.from !== null) assert.ok(worlds.includes(world.from), `${world.name} is made from an undeclared world`);
    for (const step of world.steps) assert.ok(step.operation === "wait" || step.operation in operations, `${world.name}: ${step.operation}`);
  }
  for (const name of names) {
    const { operation, claims } = allClaims[name];
    assert.equal(operation, operations[name], `${name}'s claims are of another operation`);
    assert.equal(claims.filter((claim) => claim.thinLine).length, 1, `${name} has not exactly one thin line claim`);
    const refuses = new Set<unknown>(refusalsOf(operation));
    for (const claim of claims) {
      assert.ok(worlds.includes(claim.given), `${name}: "${claim.says}" starts from an undeclared world`);
      for (const refusal of claim.refusals) assert.ok(refuses.has(refusal), `${name}: "${claim.says}" names ${refusal.identifier}, which ${name} does not declare`);
    }
  }
});

test("claims.md is what the sources render", () => {
  const onDisk = readFileSync(new URL("../claims.md", import.meta.url), "utf8");
  assert.equal(onDisk, renderClaims(), "claims.md is out of date: run `pnpm claims`");
});

test("order.md names only declared starting worlds and every operation once", () => {
  const order = readFileSync(new URL("../order.md", import.meta.url), "utf8");
  const rows = order.split("\n").filter((line) => /^\| \d+ \|/.test(line));
  assert.equal(rows.length, 12);
  const declared = new Set(Object.values(startingWorlds).map((world) => world.name));
  const listed = rows.map((row) => row.split("|")[2]?.trim().replaceAll("`", ""));
  assert.deepEqual([...listed].sort(), [...names].sort());
  for (const row of rows) {
    const given = row.split("|")[4]?.match(/`([a-z-]+)`/g) ?? [];
    assert.ok(given.length > 0, `no starting world in: ${row}`);
    for (const name of given) assert.ok(declared.has(name.replaceAll("`", "")), `order.md names ${name}, which is not declared`);
  }
});
