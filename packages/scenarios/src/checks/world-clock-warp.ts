// The checks of every world.clock.warp (claims.md, world.clock.warp 1 and 2): a warp moves the world's clock from
// where it was to where it was asked, every ready site follows, the chain's head is at or after the new time, and the
// record gains its one clock_warped; a warp backwards, or by anyone but the owner, is refused and the clock stays.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { expect } from "../expectation.ts";
import { addSeconds, millis, same, sameInstant } from "../support/expect.ts";
import { entriesOfCall, operatorName, view, whereOf } from "../support/world.ts";
import { nothingRecorded, worldBefore, type Before } from "./common.ts";
import { check, checks, type Asked, type Check } from "./format.ts";
import { steady } from "../support/steady.ts";

/** Where the warp asked the clock to go, from the clock before it. */
const targetOf = (asked: Asked<"world.clock.warp">, from: string): string =>
  "seconds" in asked.payload.target ? addSeconds(from, asked.payload.target.seconds) : asked.payload.target.at;

/** The world's clock is where it was before the call. */
const clockStays = (before: Before): Check =>
  check(
    "the clock does not move",
    Effect.flatMap(view(before.world.world), (now) =>
      same("the clock after the refusal", now.clock, before.world.clock),
    ),
  );

export const worldClockWarp = checks<"world.clock.warp", Before>({
  before: (asked) => worldBefore(asked.options),
  success: (asked, warped, before) => [
    check(
      "it moves the clock from where it was to where it was asked, and world.show shows it there",
      Effect.gen(function* () {
        yield* sameInstant("the warp's from", warped.from, before.world.clock.now);
        yield* sameInstant("the clock after the warp", warped.clock.now, targetOf(asked, before.world.clock.now));
        yield* same("the clock's mode", warped.clock.mode, before.world.clock.mode);
        yield* same("world.show's clock", (yield* view(before.world.world)).clock, warped.clock);
      }),
    ),
    check(
      "every ready site follows",
      same(
        "the sites that followed",
        warped.sites,
        Arr.filter(before.world.companies, (each) => each.site.state === "ready").length,
      ),
    ),
    check(
      "the chain's head is at or after the new time",
      Effect.gen(function* () {
        const capxul = yield* Capxul;
        const head = yield* steady(capxul.chain).head({}, whereOf(asked.options));
        yield* expect(
          millis(head.timestamp) >= millis(warped.clock.now),
          `the chain's head is at ${head.timestamp}, before the clock's ${warped.clock.now}`,
        );
      }),
    ),
    check(
      "the record gains one clock_warped, from where the clock was to where it is",
      Effect.flatMap(entriesOfCall(before.head, before.where), (added) =>
        same(
          "the entries the warp added",
          Arr.map(added, (entry) => [entry.event, entry.carried]),
          [["clock_warped", { from: warped.from, to: warped.clock.now }]],
        ),
      ),
    ),
  ],
  refusals: {
    ClockBackwards: (asked, refused, before) => [
      check(
        "ClockBackwards names the clock now and the time asked, which is not after it",
        Effect.gen(function* () {
          yield* sameInstant("ClockBackwards's now", refused.now, before.world.clock.now);
          yield* sameInstant("ClockBackwards's asked", refused.asked, targetOf(asked, before.world.clock.now));
          yield* expect(millis(refused.asked) <= millis(refused.now), "the time asked is after the clock");
        }),
      ),
      clockStays(before),
      nothingRecorded("the refused warp", before),
    ],
    NotWorldOwner: (asked, refused, before) => [
      check(
        "NotWorldOwner names the world and its owner, and the caller is not the owner",
        Effect.gen(function* () {
          yield* same("NotWorldOwner", [refused.world, refused.owner], [before.world.world, before.world.owner]);
          const caller = asked.options.as ?? (yield* operatorName(asked.options));
          yield* expect(caller !== before.world.owner, `the owner ${caller} was refused as not the owner`);
        }),
      ),
      clockStays(before),
      nothingRecorded("the refused warp", before),
    ],
  },
});
