// The checks of every world.create (claims.md, world.create 1 to 6): a new world runs with its clock and a record that
// begins with its birth, the caller owns it and it expires when asked, it is born with its cast, and a refusal says
// why and makes nothing.
import { Cast } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Str from "effect/String";
import { Capxul } from "../client.ts";
import { expect } from "../expectation.ts";
import { usdc } from "../support/chain.ts";
import { hostNow, millis, same, sameAmount, sameInstant } from "../support/expect.ts";
import { isTestAddress } from "../support/signing.ts";
import { LIMITS, noWorld, operatorName, recordOf, view, viewOrNone, type View } from "../support/world.ts";
import { check, checks } from "./format.ts";

const MINUTE = 60_000;
const SECOND = 1000;
/**
 * Every world's cast (claims.md, `fresh`; the blueprint's `Cast`): each role played by the person of its name, and every
 * journey's own people besides, so journeys can run side by side in one world. Whoever plays pat has not finished
 * signing up and has no Safe.
 */
const CAST = Arr.sort(
  [
    ...Arr.map(Cast.CAST_ROLES, (each) => each.role),
    ...Arr.flatMap(Cast.JOURNEY_KEYS, (key) =>
      Arr.map(Cast.journeyCast(key, Cast.CAST_COMPANY).people, (each) => each.person),
    ),
  ],
  Order.String,
);
const UNSAFE: ReadonlyArray<string> = [
  ...Arr.flatMap(Cast.CAST_ROLES, (each) => (each.claimed ? [] : [each.role])),
  ...Arr.flatMap(Cast.JOURNEY_KEYS, (key) =>
    Arr.flatMap(Cast.journeyCast(key, Cast.CAST_COMPANY).people, (each) => (each.claimed ? [] : [each.person])),
  ),
];
const OPENING_USDC = 10_000;

/** `expiresAt` is `minutes` after a call made between `before` and now, within a minute. */
export const expiresAfter = (what: string, expiresAt: string, before: string, minutes: number) =>
  Effect.flatMap(hostNow, (after) =>
    expect(
      millis(expiresAt) >= millis(before) + (minutes - 1) * MINUTE &&
        millis(expiresAt) <= millis(after) + (minutes + 1) * MINUTE,
      `${what} is ${expiresAt}; it must be ${minutes} minutes after the call (${before} to ${after}), within a minute`,
    ),
  );

/** The same instant to the second: a chain's block times are whole seconds. */
const sameSecond = (what: string, actual: string, expected: string) =>
  expect(
    Math.floor(millis(actual) / SECOND) === Math.floor(millis(expected) / SECOND),
    `${what} is ${actual}; it must be ${expected}, to the second`,
  );

/** Each person of the cast, and everyone but pat's Safe with its 10,000 USDC, through the world's door. */
const bornWithCast = (made: View, operator: "first" | "second") =>
  Effect.gen(function* () {
    const people = Arr.sort(
      Arr.map(made.cast, (each) => each.person),
      Order.String,
    );
    yield* same("the cast", people, CAST);
    const signers = Arr.dedupe(Arr.map(made.cast, (each) => Str.toLowerCase(each.signer)));
    yield* same("the cast's distinct signer addresses", signers.length, CAST.length);
    for (const member of made.cast) {
      yield* expect(yield* isTestAddress(member.signer), `${member.person}'s signer is no well-known test key`);
      if (Arr.contains(UNSAFE, member.person)) yield* same(`${member.person}'s Safe`, member.safe, null);
      else if (member.safe === null) yield* expect(false, `${member.person} has no personal Safe`);
      else
        yield* sameAmount(
          `${member.person}'s Safe's USDC`,
          yield* usdc(made, member.safe, { at: made.door, operator }),
          OPENING_USDC,
        );
    }
  });

export const worldCreate = checks<"world.create", { readonly now: string; readonly existing: Option.Option<View> }>({
  before: (asked) => Effect.all({ now: hostNow, existing: viewOrNone(asked.payload.world) }),
  success: (asked, made, before) => {
    const operator = asked.options.operator ?? "first";
    const at = { at: made.door, operator };
    const { payload } = asked;
    return [
      check(
        "it answers the world asked, running, of the grade and clock asked, its record at 1 and no parent",
        same(
          "the new world",
          [made.world, made.state, made.grade, made.clock.mode, made.recordHead, made.parent],
          [payload.world, "running", payload.grade, payload.clock.mode, 1, null],
        ),
      ),
      check(
        "the calling operator owns it",
        Effect.flatMap(operatorName(asked.options), (owner) => same("the owner", made.owner, owner)),
      ),
      check(
        "it expires the lifetime asked for after the call",
        expiresAfter("the expiry", made.expiresAt, before.now, payload.lifetimeMinutes),
      ),
      check(
        "its clock starts where asked, and its chain mined a block then",
        Effect.gen(function* () {
          if (payload.clock.startAt !== null) yield* sameInstant("the clock", made.clock.now, payload.clock.startAt);
          const capxul = yield* Capxul;
          const head = yield* capxul.chain.head({}, at);
          yield* sameSecond("the chain head's timestamp", head.timestamp, made.clock.now);
        }),
      ),
      check(
        "world.show answers what it answered",
        Effect.flatMap(view(made.world), (shown) => same("world.show", shown, made)),
      ),
      check(
        "its record is its birth: one world_created at 1, carrying what it answered",
        Effect.flatMap(recordOf(at), (record) =>
          same(
            "the new world's record",
            [record.head, Arr.map(record.entries, (entry) => [entry.seq, entry.event, entry.carried])],
            [
              1,
              [
                [
                  1,
                  "world_created",
                  {
                    world: made.world,
                    owner: made.owner,
                    grade: made.grade,
                    expiresAt: made.expiresAt,
                    parent: null,
                  },
                ],
              ],
            ],
          ),
        ),
      ),
      check(
        "it is born with its cast: each signs with a well-known test key, and all but pat hold 10,000 USDC",
        bornWithCast(made, operator),
      ),
    ];
  },
  refusals: {
    WorldExists: (asked, refused, before) => [
      check(
        "WorldExists names the world, its owner and its expiry, and the world is unchanged",
        Effect.gen(function* () {
          const shown = yield* view(asked.payload.world);
          yield* same("WorldExists's world and owner", [refused.world, refused.owner], [shown.world, shown.owner]);
          yield* sameInstant("WorldExists's expiry", refused.expiresAt, shown.expiresAt);
          if (Option.isSome(before.existing))
            yield* same("the world's clock after the refusal", shown.clock, before.existing.value.clock);
        }),
      ),
    ],
    GradeNotOffered: (asked, refused) => [
      check("GradeNotOffered names the grade asked", same("its grade", refused.grade, asked.payload.grade)),
      check("nothing is made", noWorld(asked.payload.world)),
    ],
    WorldQuotaReached: (asked, refused) => [
      check(
        "WorldQuotaReached names the calling operator, at the limit",
        Effect.flatMap(operatorName(asked.options), (owner) =>
          same(
            "WorldQuotaReached",
            [refused.owner, refused.live, refused.limit],
            [owner, LIMITS.liveWorldsPerOwner, LIMITS.liveWorldsPerOwner],
          ),
        ),
      ),
      check("nothing is made", noWorld(asked.payload.world)),
    ],
    ClockBeforeSeed: (asked, refused) => [
      check(
        "ClockBeforeSeed names the start asked and an earliest start after it",
        Effect.gen(function* () {
          yield* sameInstant("ClockBeforeSeed's asked", refused.asked, asked.payload.clock.startAt ?? "");
          yield* expect(
            millis(refused.earliest) > millis(refused.asked),
            `ClockBeforeSeed's earliest, ${refused.earliest}, is not after ${refused.asked}`,
          );
        }),
      ),
      check("nothing is made", noWorld(asked.payload.world)),
    ],
  },
});
