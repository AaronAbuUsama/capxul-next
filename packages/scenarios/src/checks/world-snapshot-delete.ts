// The checks of every world.snapshot.delete (claims.md, world.snapshot.delete 1 to 3): a delete answers the snapshot as
// it was listed, of a snapshot no live world hangs from; the record gains one snapshot_deleted, world.snapshot.list
// lists the others as before and world.show reads as before but for its record head. A snapshot a live world hangs
// from, one that does not exist, a caller who is not the owner and a world that does not exist are refused, and leave
// the record and the snapshots as they were.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { expect } from "../expectation.ts";
import { asSaved, heldBefore, snapshotsOf, type Held } from "../support/inventory.ts";
import { present, same } from "../support/expect.ts";
import { entriesAfter, operatorName, unchangedRecord, view } from "../support/world.ts";
import { check, checks, type Check } from "./format.ts";

/** The world existed before the call; what it was. */
const existed = (held: Option.Option<Held>) => present("the world before the call", Option.getOrNull(held));

/** The snapshot asked for, as world.snapshot.list listed it before the call; none when it was not listed. */
const listedBefore = (was: Held, snapshot: string) =>
  Arr.findFirst(was.snapshots, (each) => each.snapshot === snapshot);

/** A refused delete left the world's record and its snapshots as they were. */
const unchanged = (what: string, held: Option.Option<Held>): ReadonlyArray<Check> => [
  check(
    `${what} leaves the record as it was`,
    Effect.flatMap(existed(held), (was) => unchangedRecord(what, was.head, was.owner)),
  ),
  check(
    `${what} leaves the world's snapshots as they were`,
    Effect.gen(function* () {
      const was = yield* existed(held);
      yield* same(`the snapshots after ${what}`, yield* snapshotsOf(was.world.world, was.owner), was.snapshots);
    }),
  ),
];

export const worldSnapshotDelete = checks<"world.snapshot.delete", Option.Option<Held>>({
  before: (asked) => heldBefore(asked.payload.world),
  success: (asked, deleted, held) => [
    check(
      "it answers the snapshot asked, as world.snapshot.list listed it, in use by no world",
      Effect.gen(function* () {
        const was = yield* existed(held);
        yield* same(
          "the snapshot deleted",
          [deleted.world, deleted.snapshot],
          [asked.payload.world, asked.payload.snapshot],
        );
        const listed = yield* present(
          `${asked.payload.snapshot} in the list before the delete`,
          Option.getOrNull(listedBefore(was, asked.payload.snapshot)),
        );
        yield* same("the snapshot deleted, as listed", deleted, asSaved(listed));
        yield* same("the worlds it was in use by", listed.inUseBy, []);
      }),
    ),
    check(
      "the record gains one entry, snapshot_deleted, carrying the world, the snapshot and the position it held",
      Effect.gen(function* () {
        const was = yield* existed(held);
        const added = yield* entriesAfter(was.head, was.owner);
        yield* same(
          "the entries the delete added",
          Arr.map(added, (entry) => [entry.event, entry.carried]),
          [["snapshot_deleted", { world: deleted.world, snapshot: deleted.snapshot, recordSeq: deleted.recordSeq }]],
        );
      }),
    ),
    check(
      "world.snapshot.list lists every other snapshot as before, and not this one",
      Effect.gen(function* () {
        const was = yield* existed(held);
        yield* same(
          "the snapshots after the delete",
          yield* snapshotsOf(was.world.world, was.owner),
          Arr.filter(was.snapshots, (each) => each.snapshot !== deleted.snapshot),
        );
      }),
    ),
    check(
      "world.show reads as before but for its record head, one higher",
      Effect.gen(function* () {
        const was = yield* existed(held);
        const after = yield* view(was.world.world);
        yield* same(
          "world.show after the delete, but for its record head",
          { ...after, recordHead: 0 },
          {
            ...was.world,
            recordHead: 0,
          },
        );
        yield* same("world.show's record head after the delete", after.recordHead, was.head + 1);
      }),
    ),
  ],
  refusals: {
    SnapshotInUse: (asked, refused, held) => [
      check(
        "SnapshotInUse names the snapshot asked and the live worlds world.snapshot.list said hang from it",
        Effect.gen(function* () {
          const was = yield* existed(held);
          yield* same(
            "SnapshotInUse",
            [refused.world, refused.snapshot],
            [asked.payload.world, asked.payload.snapshot],
          );
          const listed = yield* present(
            `${asked.payload.snapshot} in the list before the delete`,
            Option.getOrNull(listedBefore(was, asked.payload.snapshot)),
          );
          yield* expect(Arr.isReadonlyArrayNonEmpty(refused.worlds), "SnapshotInUse names no world");
          yield* same("the worlds SnapshotInUse names", refused.worlds, listed.inUseBy);
        }),
      ),
      ...unchanged("the refused delete", held),
    ],
    SnapshotNotFound: (asked, refused, held) => [
      check(
        "SnapshotNotFound names the world and the snapshot asked, which world.snapshot.list did not list",
        Effect.gen(function* () {
          const was = yield* existed(held);
          yield* same(
            "SnapshotNotFound",
            [refused.world, refused.snapshot],
            [asked.payload.world, asked.payload.snapshot],
          );
          yield* expect(
            Option.isNone(listedBefore(was, asked.payload.snapshot)),
            `${asked.payload.snapshot} was listed before the call`,
          );
        }),
      ),
      ...unchanged("the refused delete", held),
    ],
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
      ...unchanged("the refused delete", held),
    ],
    WorldNotFound: (asked, refused, held) => [
      check("WorldNotFound names the world asked", same("its world", refused.world, asked.payload.world)),
      check("no world had that name", expect(Option.isNone(held), `${asked.payload.world} existed before the call`)),
    ],
  },
});
