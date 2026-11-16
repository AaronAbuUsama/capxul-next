import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { noDurations, renderRecord, RunRecord } from "../src/common/record.ts";
import { STEPS } from "../src/stack/names.ts";

const timeouts = {
  admit: 16,
  claim: 1,
  grant: 17,
  register: 14,
  branch: 15,
  deploy: 2,
  migrate: 3,
  chain: 4,
  fund: 11,
  bundler: 12,
  index: 5,
  core: 6,
  site: 12,
  use: 7,
  park: 8,
  unsite: 13,
  destroy: 9,
  release: 10,
};
const record: RunRecord = {
  world: "w-demo",
  owner: "someone",
  forkedFrom: "nothing",
  expiresAt: "2026-11-13T12:00:00.000Z",
  outcome: "passed",
  failure: null,
  worldAfterwards: "destroyed",
  keptUntil: null,
  ms: { ...noDurations, claim: 800, deploy: 41000, use: 12, destroy: 13000, create: 83000, total: 97000 },
  timeouts,
};
const render = (value: RunRecord) => Effect.runSync(renderRecord(value));
const decode = (value: unknown) => Effect.runSyncExit(Schema.decodeUnknownEffect(RunRecord)(value));

describe("RunRecord", () => {
  test("a record survives being written and read back", () => {
    const read = Effect.runSync(Schema.decodeUnknownEffect(RunRecord)(JSON.parse(render(record))));
    assert.deepStrictEqual(read, record);
  });
  test("every step has a duration field and a declared timeout", () => {
    for (const step of STEPS) {
      assert.ok(step in record.ms);
      assert.ok(step in record.timeouts);
    }
  });
  test("a step that did not run is null, not missing", () => {
    assert.match(render(record), /"park": null/);
    const { park: _park, ...withoutPark } = record.ms;
    assert.strictEqual(decode({ ...record, ms: withoutPark })._tag, "Failure");
  });
  test("an unknown outcome or fate is refused", () => {
    assert.strictEqual(decode({ ...record, outcome: "sort of passed" })._tag, "Failure");
    assert.strictEqual(decode({ ...record, worldAfterwards: "probably gone" })._tag, "Failure");
  });
  test("a record without its owner or expiry is refused", () => {
    const { owner: _owner, ...noOwner } = record;
    const { expiresAt: _expiresAt, ...noExpiry } = record;
    assert.strictEqual(decode(noOwner)._tag, "Failure");
    assert.strictEqual(decode(noExpiry)._tag, "Failure");
  });
  test("a failed run carries its reason", () => {
    const failed = {
      ...record,
      outcome: "timed out" as const,
      failure: "StepTimedOut: the use step did not finish",
      worldAfterwards: "kept" as const,
      keptUntil: "2026-11-13T11:00:00.000Z",
    };
    assert.strictEqual(decode(failed)._tag, "Success");
  });
});
