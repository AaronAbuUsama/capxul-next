import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { classify, decide, expiryOf, leftoverRepositories, lifetimeAllowed } from "../src/lifecycle/expiry.ts";

const now = DateTime.makeUnsafe("2026-11-13T10:00:00.000Z");
const at = (output: unknown) => Effect.runSync(classify(now, output));

describe("expiryOf", () => {
  test("adds the lifetime to now, as RFC 3339", () => {
    assert.strictEqual(expiryOf(now, Duration.hours(2)), "2026-11-13T12:00:00.000Z");
    assert.strictEqual(expiryOf(now, Duration.minutes(90)), "2026-11-13T11:30:00.000Z");
  });
});

describe("classify", () => {
  test("a world whose expiry is ahead is live", () => {
    assert.deepStrictEqual(at({ owner: "a", expiresAt: "2026-11-13T10:00:01.000Z" }), {
      kind: "live",
      owner: "a",
      expiresAt: "2026-11-13T10:00:01.000Z",
      status: null,
    });
  });
  test("a world expires at the very moment of its expiry", () => {
    assert.strictEqual(at({ owner: "a", expiresAt: "2026-11-13T10:00:00.000Z" }).kind, "expired");
    assert.strictEqual(at({ owner: "a", expiresAt: "2026-11-13T09:59:59.999Z" }).kind, "expired");
  });
  test("a parked or half-created world keeps its status and still expires", () => {
    assert.deepStrictEqual(at({ owner: "a", expiresAt: "2026-11-13T09:00:00.000Z", status: "parked" }), {
      kind: "expired",
      owner: "a",
      expiresAt: "2026-11-13T09:00:00.000Z",
      status: "parked",
    });
    assert.strictEqual(at({ owner: "a", expiresAt: "2026-11-13T11:00:00.000Z", status: "creating" }).kind, "live");
  });
  test("a world that recorded no expiry, or nothing at all, has no expiry", () => {
    assert.deepStrictEqual(at({ owner: "a" }), { kind: "no-expiry", owner: "a" });
    assert.deepStrictEqual(at(undefined), { kind: "no-expiry", owner: null });
    assert.deepStrictEqual(at(null), { kind: "no-expiry", owner: null });
  });
  test("an expiry that is not a time is unreadable", () => {
    assert.strictEqual(at({ owner: "a", expiresAt: "next tuesday" }).kind, "unreadable");
    assert.strictEqual(at({ owner: 7 }).kind, "unreadable");
    assert.strictEqual(at("not an object").kind, "unreadable");
  });
  test("other outputs are ignored", () => {
    assert.strictEqual(
      at({ owner: "a", expiresAt: "2026-11-13T11:00:00.000Z", coreUrl: "https://x", branch: "br-1" }).kind,
      "live",
    );
  });
});

describe("decide", () => {
  test("only an expired world is destroyed, and never in a dry run", () => {
    assert.strictEqual(decide({ kind: "expired", owner: "a", expiresAt: "t", status: null }, false), "destroy");
    assert.strictEqual(
      decide({ kind: "expired", owner: "a", expiresAt: "t", status: null }, true),
      "expired, would be destroyed",
    );
    assert.strictEqual(decide({ kind: "live", owner: "a", expiresAt: "t", status: null }, false), "kept: not expired");
  });
  test("a world whose expiry is missing or unreadable is kept, whatever else is known", () => {
    assert.strictEqual(decide({ kind: "no-expiry", owner: null }, false), "kept: no expiry recorded");
    assert.strictEqual(decide({ kind: "unreadable", detail: "x" }, false), "kept: expiry unreadable");
  });
});

describe("leftoverRepositories", () => {
  const names = { prefix: "capxulworld-", shared: ["capxulworld-anvil", "capxulworld-ponder"], platform: "platform" };
  const all = [
    "capxulworld-anvil",
    "capxulworld-ponder",
    "capxulworld-w-gone-core",
    "capxulworld-w-here-core",
    "capxulspikepipeline-x",
    "someone-elses",
  ];
  test("the shared repositories stay while the platform exists", () => {
    assert.deepStrictEqual(leftoverRepositories(all, ["platform", "w-here"], names), ["capxulworld-w-gone-core"]);
  });
  test("the shared repositories are leftovers once the platform is gone", () => {
    assert.deepStrictEqual(leftoverRepositories(all, [], names), [
      "capxulworld-anvil",
      "capxulworld-ponder",
      "capxulworld-w-gone-core",
      "capxulworld-w-here-core",
    ]);
  });
  test("a repository that is not this stack's is never a leftover", () => {
    assert.deepStrictEqual(leftoverRepositories(["capxulspikepipeline-x", "someone-elses"], [], names), []);
  });
});

describe("lifetimeAllowed", () => {
  const week = Duration.days(7);
  test("a world may live up to the limit and no longer", () => {
    assert.strictEqual(lifetimeAllowed(Duration.hours(2), week), true);
    assert.strictEqual(lifetimeAllowed(Duration.days(7), week), true);
    assert.strictEqual(lifetimeAllowed(Duration.sum(Duration.days(7), Duration.millis(1)), week), false);
    assert.strictEqual(lifetimeAllowed(Duration.days(8), week), false);
  });
  test("a world that would expire at once is refused", () => {
    assert.strictEqual(lifetimeAllowed(Duration.zero, week), false);
  });
});
