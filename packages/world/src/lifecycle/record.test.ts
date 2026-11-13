// bun test src
import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { noDurations, render, RunRecord, STEPS } from "./record.ts";

const timeouts = { claim: 1, deploy: 2, migrate: 3, chain: 4, fund: 11, index: 5, core: 6, use: 7, park: 8, destroy: 9, release: 10 };
const record: RunRecord = {
  world: "w-demo",
  owner: "someone",
  forkedFrom: "nothing",
  expiresAt: "2026-11-13T12:00:00.000Z",
  outcome: "passed",
  failure: null,
  worldAfterwards: "destroyed",
  ms: { ...noDurations, claim: 800, deploy: 41000, use: 12, destroy: 13000, create: 83000, total: 97000 },
  timeouts,
};
const decode = (value: unknown) => Effect.runSyncExit(Schema.decodeUnknownEffect(RunRecord)(value));

describe("RunRecord", () => {
  test("a record survives being written and read back", () => {
    const read = Effect.runSync(Schema.decodeUnknownEffect(RunRecord)(JSON.parse(render(record))));
    expect(read).toEqual(record);
  });
  test("every step has a duration field and a declared timeout", () => {
    for (const step of STEPS) {
      expect(Object.keys(record.ms)).toContain(step);
      expect(Object.keys(record.timeouts)).toContain(step);
    }
  });
  test("a step that did not run is null, not missing", () => {
    expect(JSON.parse(render(record)).ms.park).toBeNull();
    const { park: _park, ...withoutPark } = record.ms;
    expect(decode({ ...record, ms: withoutPark })._tag).toBe("Failure");
  });
  test("an unknown outcome or fate is refused", () => {
    expect(decode({ ...record, outcome: "sort of passed" })._tag).toBe("Failure");
    expect(decode({ ...record, worldAfterwards: "probably gone" })._tag).toBe("Failure");
  });
  test("a record without its owner or expiry is refused", () => {
    const { owner: _owner, ...noOwner } = record;
    const { expiresAt: _expiresAt, ...noExpiry } = record;
    expect(decode(noOwner)._tag).toBe("Failure");
    expect(decode(noExpiry)._tag).toBe("Failure");
  });
  test("a failed run carries its reason", () => {
    const failed = { ...record, outcome: "timed out" as const, failure: "StepTimedOut: the use step did not finish", worldAfterwards: "kept until expiry" as const };
    expect(decode(failed)._tag).toBe("Success");
  });
});
