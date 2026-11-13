import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { StackListing } from "../src/lifecycle/account.ts";
import { inventoryReport, worldStageOf } from "../src/proofs/support.ts";

const empty: StackListing = {
  workers: [],
  containerApplications: [],
  durableObjectNamespaces: [],
  r2Buckets: [],
  hyperdriveConfigurations: [],
  neonBranches: ["CapxulWorld-worlds-db-platform-sh7nntihfyy54kfq/registry"],
  imageRepositories: ["capxulworld-anvil"],
};

describe("the inventory a proof compares", () => {
  test("a resource's name says which world it belongs to", () => {
    assert.strictEqual(worldStageOf("capxulworld-core-w-p-site-a62y5oed4qzsjsaa"), "w-p-site");
    assert.strictEqual(worldStageOf("capxulworld-world-db-w-c1-cvmt2gyrnxlujvgm"), "w-c1");
    assert.strictEqual(worldStageOf("capxulworld-alto-w-p-bundler-wq4us54cjqhl3poh"), "w-p-bundler");
    assert.strictEqual(worldStageOf("CapxulWorld-worlds-db-platform-sh7nntihfyy54kfq/w-p-site2"), "w-p-site2");
    assert.strictEqual(worldStageOf("CapxulWorld-worlds-db-platform-sh7nntihfyy54kfq/registry"), undefined);
  });
  test("another world made or destroyed meanwhile is set aside, and named", () => {
    const other = { ...empty, workers: ["capxulworld-door-w-c1-tm6tn3u7tjlo5mdc"] };
    const report = inventoryReport(empty, other, ["w-p-cli"]);
    assert.strictEqual(report.sameAsBefore, true);
    assert.strictEqual(report.sameAsBeforeAccountWide, false);
    assert.deepStrictEqual(report.otherWorlds, ["w-c1"]);
  });
  test("what is left of the proof's own world, or of no world, still counts", () => {
    const own = { ...empty, r2Buckets: ["capxulworld-chainstate-w-p-cli-ls3i4uvuz2xx24kr"] };
    assert.strictEqual(inventoryReport(empty, own, ["w-p-cli"]).sameAsBefore, false);
    const platform = {
      ...empty,
      neonBranches: [...empty.neonBranches, "CapxulWorld-worlds-db-platform-sh7nntihfyy54kfq/x"],
    };
    assert.strictEqual(inventoryReport(empty, platform, ["w-p-cli"]).sameAsBefore, false);
  });
});
