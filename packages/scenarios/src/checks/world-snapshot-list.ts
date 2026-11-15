// The checks of every world.snapshot.list (claims.md, world.snapshot.list 1 to 3): it answers the world asked and its
// snapshots, each named once and in the order they were saved, each in use only by live worlds that hang from it, and
// it records nothing; a caller who is not the owner and a world that does not exist are refused.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import { expect } from "../expectation.ts";
import { heldBefore, type Held } from "../support/inventory.ts";
import { millis, present, same, show } from "../support/expect.ts";
import { operatorName, unchangedRecord, view } from "../support/world.ts";
import { check, checks, type Check } from "./format.ts";

/** The world existed before the call; what it was. */
const existed = (held: Option.Option<Held>) => present("the world before the call", Option.getOrNull(held));

/** The list left the world's record as it was. */
const unchanged = (what: string, held: Option.Option<Held>): Check =>
  check(
    `${what} leaves the record as it was`,
    Effect.flatMap(existed(held), (was) => unchangedRecord(what, was.head, was.owner)),
  );

export const worldSnapshotList = checks<"world.snapshot.list", Option.Option<Held>>({
  before: (asked) => heldBefore(asked.payload.world),
  success: (asked, listed, held) => [
    check("it answers the world asked", same("the world listed", listed.world, asked.payload.world)),
    check(
      "every snapshot is of that world, named once, in the order they were saved",
      Effect.gen(function* () {
        const names = Arr.map(listed.snapshots, (each) => each.snapshot);
        yield* same("the snapshots' names, each once", names, Arr.dedupe(names));
        yield* same(
          "the snapshots' worlds",
          Arr.dedupe(Arr.map(listed.snapshots, (each) => each.world)),
          Arr.isReadonlyArrayEmpty(listed.snapshots) ? [] : [asked.payload.world],
        );
        const times = Arr.map(listed.snapshots, (each) => millis(each.savedAt));
        yield* same("the snapshots' save times, in order", times, Arr.sort(times, Order.Number));
      }),
    ),
    check(
      "every world a snapshot is in use by is live, and is the snapshot's own world or names it as its parent",
      Effect.forEach(
        Arr.flatMap(listed.snapshots, (each) => Arr.map(each.inUseBy, (world) => [each, world] as const)),
        ([snapshot, world]) =>
          Effect.gen(function* () {
            const shown = yield* view(world);
            yield* expect(
              world === snapshot.world ||
                (shown.parent?.world === snapshot.world && shown.parent.snapshot === snapshot.snapshot),
              `${world} is in use of ${snapshot.world}'s ${snapshot.snapshot} but names ${show(shown.parent)} as its parent`,
            );
          }),
        { discard: true },
      ),
    ),
    unchanged("the list", held),
  ],
  refusals: {
    NotWorldOwner: (asked, refused, held) => [
      check(
        "NotWorldOwner names the world and its owner, who is not the caller",
        Effect.gen(function* () {
          const was = yield* existed(held);
          yield* same("NotWorldOwner", [refused.world, refused.owner], [was.world.world, was.world.owner]);
          const caller = yield* operatorName(asked.options);
          yield* expect(caller !== was.world.owner, `the owner ${caller} was refused as not the owner`);
        }),
      ),
      unchanged("the refused list", held),
    ],
    WorldNotFound: (asked, refused, held) => [
      check("WorldNotFound names the world asked", same("its world", refused.world, asked.payload.world)),
      check("no world had that name", expect(Option.isNone(held), `${asked.payload.world} existed before the call`)),
    ],
  },
});
