import assert from "node:assert/strict";
import { test } from "node:test";

import type { Chain } from "../chain/types.ts";
import { testKey } from "../test-keys/service.ts";
import { runProof, type StepResult } from "./service.ts";

test("with no deployment to run against, every step says FAIL and the proof still returns", async () => {
  const seen: StepResult[] = [];
  const results = await runProof({
    chain: {} as Chain,
    record: { version: "v4", chainId: 1, companiesHouse: "0x01", companiesHouseRoles: "0x02", createCall: "0x03", tiers: [], contracts: {} },
    artifacts: { token: {}, installer: {} },
    keys: { deployer: testKey("deployer"), tierService: testKey("tierService"), founder: testKey("founder"), second: testKey("second"), payee: testKey("payee"), stranger: testKey("stranger"), agent: testKey("agent") },
    report: (step) => seen.push(step),
  });
  assert.ok(results.length >= 15);
  assert.ok(results.every((step) => !step.ok));
  assert.equal(seen.length, results.length);
});
