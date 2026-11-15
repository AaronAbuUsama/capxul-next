// The checks of every world.snapshot.save (claims.md, world.snapshot.save 1 to 3): a snapshot holds the world's record
// position, clock and companies and leaves the world untouched but for its one snapshot_saved; a name already saved,
// a caller who is not the owner and a world that does not exist are refused, and the record gains nothing.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { expect } from "../expectation.ts";
import { usdc } from "../support/chain.ts";
import { present, same } from "../support/expect.ts";
import {
  entriesOfCall,
  operatorName,
  ownerOf,
  personalSafes,
  recordOf,
  unchangedRecord,
  view,
  viewOrNone,
  type View,
  type Who,
} from "../support/world.ts";
import { check, checks, type Check } from "./format.ts";

interface Saved {
  readonly world: View;
  readonly owner: Who;
  readonly head: number;
  readonly balances: ReadonlyArray<string>;
}

const balancesOf = (world: View, owner: Who) =>
  Effect.forEach(personalSafes(world), (safe) => usdc(world, safe, owner));

const before = (world: string) =>
  Effect.gen(function* () {
    const found = yield* viewOrNone(world);
    if (Option.isNone(found)) return Option.none<Saved>();
    const owner = yield* ownerOf(found.value);
    const record = yield* recordOf(owner);
    const balances = yield* balancesOf(found.value, owner);
    return Option.some({ world: found.value, owner, head: record.head, balances });
  });

/** The world existed before the call; `then` reads what it was. */
const existed = (saved: Option.Option<Saved>) => present("the world before the call", Option.getOrNull(saved));

/** The world's record gained nothing. */
const unchanged = (what: string, saved: Option.Option<Saved>): Check =>
  check(
    `${what} leaves the record as it was`,
    Effect.flatMap(existed(saved), (was) => unchangedRecord(what, was.head, was.owner)),
  );

export const worldSnapshotSave = checks<"world.snapshot.save", Option.Option<Saved>>({
  before: (asked) => before(asked.payload.world),
  success: (asked, saved, was) => [
    check(
      "it answers the world, the name and the template asked",
      same(
        "the snapshot",
        [saved.world, saved.snapshot, saved.template],
        [asked.payload.world, asked.payload.snapshot, asked.payload.template],
      ),
    ),
    check(
      "it holds the record's position, the clock and the companies before the save",
      Effect.flatMap(existed(was), (it) =>
        same(
          "what the snapshot holds",
          [saved.recordSeq, saved.clock, saved.companies],
          [it.head, it.world.clock, it.world.companies.length],
        ),
      ),
    ),
    check(
      "the record gains one entry, snapshot_saved, carrying what the save answered",
      Effect.gen(function* () {
        const it = yield* existed(was);
        const added = yield* entriesOfCall(it.head, it.owner);
        yield* same(
          "the entries the save added",
          Arr.map(added, (entry) => [entry.event, entry.carried]),
          [
            [
              "snapshot_saved",
              { world: saved.world, snapshot: saved.snapshot, recordSeq: saved.recordSeq, template: saved.template },
            ],
          ],
        );
      }),
    ),
    check(
      "nothing else changes: world.show but for its record head, and every personal Safe's USDC",
      Effect.gen(function* () {
        const it = yield* existed(was);
        const after = yield* view(it.world.world);
        yield* same(
          "world.show after the save, but for its record head",
          { ...after, recordHead: 0 },
          {
            ...it.world,
            recordHead: 0,
          },
        );
        yield* same("world.show's record head after the save", after.recordHead, it.head + 1);
        yield* same("the personal Safes' USDC after the save", yield* balancesOf(it.world, it.owner), it.balances);
      }),
    ),
  ],
  refusals: {
    SnapshotExists: (asked, refused, was) => [
      check(
        "SnapshotExists names the world and the snapshot asked",
        same("SnapshotExists", [refused.world, refused.snapshot], [asked.payload.world, asked.payload.snapshot]),
      ),
      check("a replace was not asked for", expect(!asked.payload.replace, "a save asked to replace was refused")),
      unchanged("the refused save", was),
    ],
    NotWorldOwner: (asked, refused, was) => [
      check(
        "NotWorldOwner names the world and its owner, who is not the caller",
        Effect.gen(function* () {
          const it = yield* existed(was);
          yield* same("NotWorldOwner", [refused.world, refused.owner], [it.world.world, it.world.owner]);
          const caller = yield* operatorName(asked.options);
          yield* expect(caller !== it.world.owner, `the owner ${caller} was refused as not the owner`);
        }),
      ),
      unchanged("the refused save", was),
    ],
    WorldNotFound: (asked, refused, was) => [
      check("WorldNotFound names the world asked", same("its world", refused.world, asked.payload.world)),
      check("no world had that name", expect(Option.isNone(was), `${asked.payload.world} existed before the call`)),
    ],
  },
});
