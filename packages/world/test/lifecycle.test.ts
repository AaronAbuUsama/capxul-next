import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Errors } from "@capxul/blueprint";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { durationOf, mintsOf } from "../src/cli/commands.ts";
import { LifetimeTooLong } from "../src/common/failures.ts";
import { describeFailure } from "../src/common/describe.ts";
import { checkName, checkOwner } from "../src/things/world/names.ts";
import { keptUntil } from "../src/things/world/take-down.ts";
import { sameResources } from "../src/proofs/support/conclude.ts";

const now = DateTime.makeUnsafe("2026-11-13T10:00:00.000Z");
const failed = <A, E>(effect: Effect.Effect<A, E>): boolean => effect.pipe(Effect.runSyncExit, Exit.isFailure);

describe("keptUntil", () => {
  const expiresAt = "2026-11-13T18:00:00.000Z";
  test("a kept world stays for the keep asked for", () => {
    assert.strictEqual(keptUntil(now, expiresAt, Duration.minutes(30), Duration.days(1)), "2026-11-13T10:30:00.000Z");
  });
  test("a keep is cut to the declared limit", () => {
    assert.strictEqual(
      keptUntil(now, "2026-11-20T10:00:00.000Z", Duration.days(3), Duration.days(1)),
      "2026-11-14T10:00:00.000Z",
    );
  });
  test("a keep never outlasts the world's own expiry", () => {
    assert.strictEqual(keptUntil(now, expiresAt, Duration.hours(12), Duration.days(1)), expiresAt);
  });
});

describe("the command line's values", () => {
  test("a lifetime is a whole number of seconds, minutes, hours or days", () => {
    assert.deepStrictEqual(Effect.runSync(durationOf("2 hours")), Duration.hours(2));
    assert.deepStrictEqual(Effect.runSync(durationOf("1 day")), Duration.days(1));
    assert.deepStrictEqual(Effect.runSync(durationOf(" 30 minutes ")), Duration.minutes(30));
    assert.ok(durationOf("soon").pipe(failed));
    assert.ok(durationOf("2.5 hours").pipe(failed));
  });
  test("mints are address=amount, comma separated", () => {
    const mints = Effect.runSync(mintsOf("0x70997970C51812dc3A010C7d01b50e0d17dc79C8=250000000, "));
    assert.deepStrictEqual(mints, [{ to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", amount: 250_000_000n }]);
    assert.deepStrictEqual(Effect.runSync(mintsOf("")), []);
    assert.ok(mintsOf("0x7099=1").pipe(failed));
  });
});

describe("names and owners", () => {
  test("a world's name follows the blueprint's WorldName, with or without the stage prefix", () => {
    assert.strictEqual(Effect.runSync(checkName("demo")), "demo");
    assert.strictEqual(Effect.runSync(checkName("w-demo")), "demo");
    assert.ok(checkName("Demo").pipe(failed));
    assert.ok(checkName("a-name-far-too-long").pipe(failed));
  });
  test("an owner follows the blueprint's OperatorName", () => {
    assert.strictEqual(Effect.runSync(checkOwner("ci")), "ci");
    assert.ok(checkOwner("Not Me").pipe(failed));
  });
});

describe("describeFailure", () => {
  test("a failure with a message is its tag and its message", () => {
    const failure = LifetimeTooLong.make({ world: "x", askedMs: 1, mostMs: 0, message: "too long" });
    assert.strictEqual(describeFailure(failure), "LifetimeTooLong: too long");
  });
  test("a contract refusal, which has no message, is its tag and its fields", () => {
    const refusal = Errors.WorldQuotaReached.make({ owner: "ci", live: 5, limit: 5 });
    assert.match(describeFailure(refusal), /^WorldQuotaReached: .*"ci".*5/);
  });
  test("a connection string never survives", () => {
    assert.strictEqual(
      describeFailure({ message: "at postgresql://u:p@host/db failed" }),
      "at <connection string> failed",
    );
  });
});

const listing = (workers: ReadonlyArray<string>, images: ReadonlyArray<string>) => ({
  workers,
  containerApplications: [],
  durableObjectNamespaces: [],
  r2Buckets: [],
  hyperdriveConfigurations: [],
  neonBranches: ["p/registry"],
  imageRepositories: images,
});

describe("sameResources", () => {
  test("the order of names does not matter", () => {
    assert.ok(sameResources(listing(["a", "b"], []), listing(["b", "a"], [])));
  });
  test("a resource left behind is a difference", () => {
    assert.ok(!sameResources(listing(["a"], []), listing(["a", "capxulworld-core-w-x-1"], [])));
  });
  test("the shared image repositories are the platform's, not a world's", () => {
    assert.ok(sameResources(listing(["a"], []), listing(["a"], ["capxulworld-anvil"])));
  });
});
