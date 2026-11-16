// The machines a bench may run on (src/machines.ts): every machine declares every cap, each with a source that is a
// GitHub Actions run, a file in the repository, or `estimate`; and the deploy's numbers come from the one chosen.
import * as assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import * as Rec from "effect/Record";
import { machineEnvironment, type Machine, MACHINES, POOL_MAX, STAGING_BENCH } from "../src/machines.ts";

const CAPS: ReadonlyArray<keyof Machine> = [
  "cpus",
  "memoryGib",
  "monthlyUsd",
  "sitesAtOnce",
  "blankPool",
  "companyPool",
];
const ROOT = new URL("../../../", import.meta.url);

const sourced = (source: string): boolean =>
  source === "estimate" || /^run [0-9]+$/.test(source) || existsSync(new URL(source, ROOT));

test("every machine has every cap, each a positive number with a source", () => {
  for (const [host, machine] of Rec.toEntries(MACHINES)) {
    const declared: Machine = machine;
    for (const cap of CAPS) {
      const { value, source } = declared[cap];
      assert.ok(Number.isFinite(value) && value > 0, `${host} ${cap}: ${String(value)}`);
      assert.ok(sourced(source), `${host} ${cap}: "${source}" is not a run, a file or "estimate"`);
    }
    assert.ok(declared.blankPool.value <= POOL_MAX && declared.companyPool.value <= POOL_MAX, host);
  }
});

test("the staging bench is a declared machine, and the door's environment comes from it", () => {
  const machine: Machine = MACHINES[STAGING_BENCH.host];
  assert.deepEqual(machineEnvironment(STAGING_BENCH.host), {
    BENCH_HOST_TYPE: STAGING_BENCH.host,
    BENCH_SITES_AT_ONCE: `${machine.sitesAtOnce.value}`,
    DOOR_BLANK_POOL_SIZE: `${machine.blankPool.value}`,
    DOOR_COMPANY_POOL_SIZE: `${machine.companyPool.value}`,
  });
});
