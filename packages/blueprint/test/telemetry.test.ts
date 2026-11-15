// The telemetry vocabulary (docs/design/blueprint.md, part 10; src/telemetry/): every attribute of the envelope
// decodes its example and is a convention or ours under `capxul.`; every metric's tags are the envelope's; the twelve
// datasets form their correlation groups; the monitors read declared datasets; the conventions' version is pinned
// once. Run with `pnpm test`.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Exit from "effect/Exit";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { Conventions, Datasets, Envelope, Metrics, Pipeline, Producers, StepKinds, Watch } from "../src/index.ts";

const attributes = Rec.values(Envelope.attributes);

test("the conventions' version is pinned once, and the schema URL carries it", () => {
  assert.match(Conventions.VERSION, /^1\.\d+\.\d+$/);
  assert.equal(Conventions.SCHEMA_URL, `https://opentelemetry.io/schemas/${Conventions.VERSION}`);
});

test("every attribute of the envelope decodes its example, and is a convention or ours under capxul.", () => {
  for (const each of attributes) {
    assert.ok(Exit.isSuccess(Schema.decodeExit(each.schema)(each.example)), `${each.name}: its example`);
    assert.equal(each.convention, !Str.startsWith("capxul.")(each.name), `${each.name}: convention or ours`);
    assert.ok(each.setBy.length > 0, `${each.name}: says not who sets it`);
  }
  const names = Arr.map(attributes, (each) => each.name);
  assert.deepEqual(names, Arr.dedupe(names));
});

test("the session is session.id and a run's shard is capxul.lane, as part 10 settles", () => {
  assert.equal(Envelope.attributes.session.name, "session.id");
  assert.equal(Envelope.attributes.lane.name, "capxul.lane");
  assert.equal(Envelope.attributes.stepKind.name, "capxul.step.kind");
});

test("the step kinds are the ten part 10 lists and `compute`, each named as itself", () => {
  assert.deepEqual(Rec.keys(StepKinds.STEP_KINDS), [
    "database",
    "site",
    "chain",
    "bundler",
    "wait",
    "deploy",
    "branch",
    "container",
    "compute",
    "restore",
    "poll",
  ]);
  for (const [key, value] of Rec.toEntries(StepKinds.StepKind)) assert.equal(key, value);
  for (const kind of Rec.keys(StepKinds.STEP_KINDS)) assert.ok(Schema.is(StepKinds.StepKindValue)(kind));
});

test("every producer has its own service.name", () => {
  const services = Arr.map(Rec.values(Producers.producers), (each) => each.service);
  assert.deepEqual(services, Arr.dedupe(services));
});

test("every metric is ours, named once, with a closed list of the envelope's attributes as its tags", () => {
  const metrics = Rec.values(Metrics.metrics);
  const names = Arr.map(metrics, (each) => each.name);
  assert.deepEqual(names, Arr.dedupe(names));
  for (const name of ["capxul.ratchet.remaining", "capxul.cost.usd"]) assert.ok(Arr.contains(names, name), name);
  for (const each of metrics) {
    assert.ok(Str.startsWith("capxul.")(each.name), each.name);
    for (const tag of each.tags) assert.ok(Rec.has(Envelope.attributes, tag), `${each.name}: ${tag}`);
    assert.deepEqual(each.tags, Arr.dedupe(each.tags), `${each.name}: a tag twice`);
  }
});

test("twelve datasets, and each correlation group binds one traces, one logs and one metrics dataset", () => {
  const datasets = Rec.values(Datasets.datasets);
  assert.equal(datasets.length, 12);
  const names = Arr.map(datasets, (each) => each.name);
  assert.deepEqual(names, Arr.dedupe(names));
  for (const group of ["test", "real", "agents"]) {
    const kinds = Arr.map(
      Arr.filter(datasets, (each) => each.group === group),
      (each) => each.kind,
    );
    assert.deepEqual(kinds, ["otel:traces:v1", "otel:logs:v1", "otel:metrics:v1"], group);
  }
  for (const each of datasets) assert.equal(each.locked, each.kind === "axiom:events:v1", `${each.name}: locked`);
});

test("each monitor reads a declared dataset, and the run's fires past 1.5 times its budget, 15 minutes", () => {
  for (const each of Rec.values(Watch.monitors)) {
    assert.ok(Rec.has(Datasets.datasets, each.reads), `${each.name}: ${each.reads}`);
    for (const by of each.by) assert.ok(Rec.has(Envelope.attributes, by), `${each.name}: ${by}`);
  }
  assert.equal(Watch.monitors.runOverTime.over, Pipeline.runStart.name);
  assert.equal(Watch.monitors.runOverTime.threshold, 15 * 60_000);
  const metricNames = Arr.map(Rec.values(Metrics.metrics), (each) => each.name);
  for (const each of Rec.values(Watch.dashboards))
    for (const shown of each.shows) assert.ok(Arr.contains(metricNames, shown), `${each.name}: ${shown}`);
});
