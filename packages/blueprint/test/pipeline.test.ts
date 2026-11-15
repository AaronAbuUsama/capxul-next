// The pipeline's own work (docs/design/blueprint.md, part 8), declared as work no door serves: each declaration
// decodes its examples, names only declared step kinds, and keeps its spans and logs under its own name; none is in
// an Rpc group; and the run's budget is a target its breakdown sums to, never a gate. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { shareTotal, spansOf, logsOf, type Work } from "@capxul/blueprint-tools";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { operations, Pipeline, PlatformRpcs, StepKinds, WorldRpcs } from "../src/index.ts";

const every: { readonly [name: string]: Work } = Pipeline.work;
const all = Rec.toEntries(every);

/** The work part 8 and the restack name, by thing and verb. */
const DECLARED = [
  "check.call",
  "check.confirm",
  "check.gate",
  "check.watch",
  "cluster.down",
  "cluster.show",
  "cluster.up",
  "journey.run",
  "ratchet.count",
  "run.prepare",
  "run.start",
  "run.teardown",
  "run.verdict",
  "site.reset",
  "site.save",
  "site.take",
  "starting-point.make",
  "world.destroy",
  "world.renew",
  "world.reset",
  "world.sweep",
];

test("every piece of work part 8 lists is declared, each under its own name", () => {
  assert.deepEqual(Rec.keys(every), DECLARED);
  for (const [name, declared] of all) assert.equal(declared.name, name);
});

test("each declaration decodes: its examples are payloads of its own schema, and it has spans and logs", () => {
  for (const [name, declared] of all) {
    assert.ok(declared.examples.length > 0, `${name}: no example`);
    for (const example of declared.examples)
      assert.ok(Schema.is(declared.payload)(example.payload), `${name}: an example`);
    assert.ok(spansOf(declared).length > 0, `${name}: no span`);
    assert.ok(logsOf(declared).length > 0, `${name}: no log`);
    for (const log of logsOf(declared))
      assert.ok(Rec.keys(log.schema.fields).length > 0, `${name}: the log ${log.name} carries nothing`);
    assert.ok(declared.does.length > 0, `${name}: says not what it does`);
  }
});

test("every step kind a span names is declared in src/telemetry/step-kinds.ts", () => {
  const kinds = Rec.keys(StepKinds.STEP_KINDS);
  for (const [name, declared] of all)
    for (const span of spansOf(declared))
      assert.ok(Arr.contains(kinds, span.kind), `${name}: ${span.name} is of the undeclared kind ${span.kind}`);
});

test("each piece of work's spans and logs are named under its own name, and no name is declared twice", () => {
  const names: Array<string> = [];
  for (const [name, declared] of all)
    for (const each of [...spansOf(declared), ...logsOf(declared)]) {
      assert.ok(Str.startsWith(`${name}.`)(each.name), `${each.name} is not under ${name}`);
      names.push(each.name);
    }
  assert.deepEqual(names, Arr.dedupe(names));
});

test("no piece of work is an operation, or in either Rpc group: nothing serves it at run time", () => {
  const declared: Readonly<Record<string, unknown>> = operations;
  for (const [name] of all) {
    assert.ok(declared[name] === undefined, `${name} is also an operation`);
    assert.ok(!PlatformRpcs.requests.has(name), `${name} is in PlatformRpcs`);
    assert.ok(!WorldRpcs.requests.has(name), `${name} is in WorldRpcs`);
  }
});

test("the run's breakdown sums to its budget, the run's 10 minutes, and names its parts' own budgets", () => {
  const run = Pipeline.runStart;
  assert.equal(run.budget.ms, 10 * 60_000);
  assert.equal(shareTotal(run), run.budget.ms);
  for (const share of run.breakdown) {
    const owner = every[share.part];
    if (owner !== undefined) assert.equal(share.ms, owner.budget.ms, `${share.part}: its share is not its budget`);
  }
  for (const [name, declared] of all)
    if (name !== run.name) assert.deepEqual(declared.breakdown, [], `${name}: only the run breaks its budget down`);
});

test("every budget is a target: provisional until measured, with its basis, and nothing that enforces it", () => {
  for (const [name, declared] of all) {
    assert.deepEqual(Rec.keys(declared.budget), ["ms", "excludes", "provisional", "basis"], name);
    assert.ok(declared.budget.provisional, `${name}: no run has measured it yet`);
    assert.ok(declared.budget.ms > 0 && declared.budget.basis.length > 0, name);
  }
});
