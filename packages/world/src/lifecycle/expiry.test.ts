// bun test src
import { describe, expect, test } from "bun:test";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { classify, decide, expiryOf, leftoverRepositories, lifetimeAllowed } from "./expiry.ts";

const now = DateTime.makeUnsafe("2026-11-13T10:00:00.000Z");
const at = (output: unknown) => Effect.runSync(classify(now, output));

describe("expiryOf", () => {
  test("adds the lifetime to now, as RFC 3339", () => {
    expect(expiryOf(now, Duration.hours(2))).toBe("2026-11-13T12:00:00.000Z");
    expect(expiryOf(now, Duration.minutes(90))).toBe("2026-11-13T11:30:00.000Z");
  });
});

describe("classify", () => {
  test("a world whose expiry is ahead is live", () => {
    expect(at({ owner: "a", expiresAt: "2026-11-13T10:00:01.000Z" })).toEqual({
      kind: "live", owner: "a", expiresAt: "2026-11-13T10:00:01.000Z", status: null,
    });
  });
  test("a world expires at the very moment of its expiry", () => {
    expect(at({ owner: "a", expiresAt: "2026-11-13T10:00:00.000Z" }).kind).toBe("expired");
    expect(at({ owner: "a", expiresAt: "2026-11-13T09:59:59.999Z" }).kind).toBe("expired");
  });
  test("a parked or half-created world keeps its status and still expires", () => {
    expect(at({ owner: "a", expiresAt: "2026-11-13T09:00:00.000Z", status: "parked" })).toEqual({
      kind: "expired", owner: "a", expiresAt: "2026-11-13T09:00:00.000Z", status: "parked",
    });
    expect(at({ owner: "a", expiresAt: "2026-11-13T11:00:00.000Z", status: "creating" }).kind).toBe("live");
  });
  test("a world that recorded no expiry, or nothing at all, has no expiry", () => {
    expect(at({ owner: "a" })).toEqual({ kind: "no-expiry", owner: "a" });
    expect(at(undefined)).toEqual({ kind: "no-expiry", owner: null });
    expect(at(null)).toEqual({ kind: "no-expiry", owner: null });
  });
  test("an expiry that is not a time is unreadable", () => {
    expect(at({ owner: "a", expiresAt: "next tuesday" }).kind).toBe("unreadable");
    expect(at({ owner: 7 }).kind).toBe("unreadable");
    expect(at("not an object").kind).toBe("unreadable");
  });
  test("other outputs are ignored", () => {
    expect(at({ owner: "a", expiresAt: "2026-11-13T11:00:00.000Z", coreUrl: "https://x", branch: "br-1" }).kind).toBe("live");
  });
});

describe("decide", () => {
  test("only an expired world is destroyed, and never in a dry run", () => {
    expect(decide({ kind: "expired", owner: "a", expiresAt: "t", status: null }, false)).toBe("destroy");
    expect(decide({ kind: "expired", owner: "a", expiresAt: "t", status: null }, true)).toBe("expired, would be destroyed");
    expect(decide({ kind: "live", owner: "a", expiresAt: "t", status: null }, false)).toBe("kept: not expired");
  });
  test("a world whose expiry is missing or unreadable is kept, whatever else is known", () => {
    expect(decide({ kind: "no-expiry", owner: null }, false)).toBe("kept: no expiry recorded");
    expect(decide({ kind: "unreadable", detail: "x" }, false)).toBe("kept: expiry unreadable");
  });
});

describe("leftoverRepositories", () => {
  const names = { prefix: "capxulworld-", shared: ["capxulworld-anvil", "capxulworld-ponder"], platform: "platform" };
  const all = ["capxulworld-anvil", "capxulworld-ponder", "capxulworld-w-gone-core", "capxulworld-w-here-core", "capxulspikepipeline-x", "someone-elses"];
  test("the shared repositories stay while the platform exists", () => {
    expect(leftoverRepositories(all, ["platform", "w-here"], names)).toEqual(["capxulworld-w-gone-core"]);
  });
  test("the shared repositories are leftovers once the platform is gone", () => {
    expect(leftoverRepositories(all, [], names)).toEqual(["capxulworld-anvil", "capxulworld-ponder", "capxulworld-w-gone-core", "capxulworld-w-here-core"]);
  });
  test("a repository that is not this stack's is never a leftover", () => {
    expect(leftoverRepositories(["capxulspikepipeline-x", "someone-elses"], [], names)).toEqual([]);
  });
});

describe("lifetimeAllowed", () => {
  const week = Duration.days(7);
  test("a world may live up to the limit and no longer", () => {
    expect(lifetimeAllowed(Duration.hours(2), week)).toBe(true);
    expect(lifetimeAllowed(Duration.days(7), week)).toBe(true);
    expect(lifetimeAllowed(Duration.sum(Duration.days(7), Duration.millis(1)), week)).toBe(false);
    expect(lifetimeAllowed(Duration.days(8), week)).toBe(false);
  });
  test("a world that would expire at once is refused", () => {
    expect(lifetimeAllowed(Duration.zero, week)).toBe(false);
  });
});
