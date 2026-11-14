// The checks of every world.snapshot.restore (claims.md, world.snapshot.restore 1 to 5, world.show 1, record.export
// 1): a restore makes a separate world, owned by the caller, at a door of its own, holding the source's cast,
// companies and record up to the snapshot, then its own world_created naming its parent, and leaves the source
// untouched; a restore that cannot be made is refused and makes nothing.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { expect } from "../expectation.ts";
import { hostNow, millis, present, same, sameInstant } from "../support/expect.ts";
import {
  companiesOf,
  headOf,
  LIMITS,
  noWorld,
  operatorName,
  ownerOf,
  recordOf,
  view,
  viewOrNone,
  type Entry,
  type View,
} from "../support/world.ts";
import { check, checks } from "./format.ts";
import { expiresAfter } from "./world-create.ts";

interface Source {
  readonly world: View;
  readonly entries: ReadonlyArray<Entry>;
  readonly head: number;
}

interface Before {
  readonly now: string;
  readonly source: Option.Option<Source>;
  readonly target: Option.Option<View>;
}

const sourceOf = (world: string) =>
  Effect.gen(function* () {
    const found = yield* viewOrNone(world);
    if (Option.isNone(found)) return Option.none<Source>();
    const record = yield* recordOf(yield* ownerOf(found.value));
    return Option.some({ world: found.value, entries: record.entries, head: record.head });
  });

const theSource = (before: Before) => present("the source world before the call", Option.getOrNull(before.source));

const pick = (entries: ReadonlyArray<Entry>) => Arr.map(entries, (each) => [each.seq, each.event, each.carried]);

export const worldSnapshotRestore = checks<"world.snapshot.restore", Before>({
  before: (asked) =>
    Effect.all({ now: hostNow, source: sourceOf(asked.payload.world), target: viewOrNone(asked.payload.as) }),
  success: (asked, made, before) => {
    const at = { at: made.door, operator: asked.options.operator ?? "first" };
    const { payload } = asked;
    return [
      check(
        "it answers the name asked, running, owned by the caller, at a door of its own, naming its source and snapshot",
        Effect.gen(function* () {
          const source = yield* theSource(before);
          yield* same("the new world", [made.world, made.state], [payload.as, "running"]);
          yield* same("its owner", made.owner, yield* operatorName(asked.options));
          yield* expect(made.door !== source.world.door, `the new world answers the source's door, ${made.door}`);
          const parent = yield* present("the new world's parent", made.parent);
          yield* same("its parent", [parent.world, parent.snapshot], [payload.world, payload.snapshot]);
        }),
      ),
      check(
        "it expires the lifetime asked for after the call, and not after its source",
        Effect.gen(function* () {
          const source = yield* theSource(before);
          yield* expiresAfter("the expiry", made.expiresAt, before.now, payload.lifetimeMinutes);
          yield* expect(
            millis(made.expiresAt) <= millis(source.world.expiresAt),
            `the new world expires at ${made.expiresAt}, after its source's ${source.world.expiresAt}`,
          );
        }),
      ),
      check(
        "it holds its source's cast and companies",
        Effect.flatMap(theSource(before), (source) =>
          same(
            "the cast and companies",
            [made.cast, companiesOf(made)],
            [source.world.cast, companiesOf(source.world)],
          ),
        ),
      ),
      check(
        "its record is its source's up to the snapshot, entry for entry, then one world_created naming its parent",
        Effect.gen(function* () {
          const source = yield* theSource(before);
          const parent = yield* present("the new world's parent", made.parent);
          const record = yield* recordOf(at);
          yield* same("its lineage", record.lineage, made.parent);
          yield* same("its head", [record.head, made.recordHead], [parent.recordSeq + 1, parent.recordSeq + 1]);
          yield* same(
            `its entries up to ${parent.recordSeq}, against its source's`,
            pick(Arr.take(record.entries, parent.recordSeq)),
            pick(Arr.take(source.entries, parent.recordSeq)),
          );
          const last = yield* present("its last entry", Option.getOrNull(Arr.last(record.entries)));
          yield* same(
            "its last entry",
            [last.seq, last.event, last.carried],
            [
              parent.recordSeq + 1,
              "world_created",
              {
                world: made.world,
                owner: made.owner,
                grade: made.grade,
                expiresAt: made.expiresAt,
                parent: made.parent,
              },
            ],
          );
        }),
      ),
      check(
        "world.show of it names its parent",
        Effect.flatMap(view(made.world), (shown) => same("world.show's parent", shown.parent, made.parent)),
      ),
      check(
        "its source is untouched: the source's record gained nothing",
        Effect.gen(function* () {
          const source = yield* theSource(before);
          yield* same("the source's record head", yield* headOf(yield* ownerOf(source.world)), source.head);
        }),
      ),
    ];
  },
  refusals: {
    SnapshotNotFound: (asked, refused) => [
      check(
        "SnapshotNotFound names the world and the snapshot asked",
        same("SnapshotNotFound", [refused.world, refused.snapshot], [asked.payload.world, asked.payload.snapshot]),
      ),
      check("nothing is made", noWorld(asked.payload.as)),
    ],
    WorldExists: (asked, refused, before) => [
      check(
        "WorldExists names the world of that name, its owner and its expiry, and it is unchanged",
        Effect.gen(function* () {
          const was = yield* present("the world of that name before the call", Option.getOrNull(before.target));
          yield* same("WorldExists", [refused.world, refused.owner], [was.world, was.owner]);
          yield* sameInstant("WorldExists's expiry", refused.expiresAt, was.expiresAt);
          const now = yield* view(asked.payload.as);
          yield* same(
            "the world of that name, but for its record head",
            { ...now, recordHead: 0 },
            {
              ...was,
              recordHead: 0,
            },
          );
        }),
      ),
    ],
    ExpiryBeyondSource: (asked, refused, before) => [
      check(
        "ExpiryBeyondSource names the source, its expiry as the latest allowed, and the expiry asked",
        Effect.gen(function* () {
          const source = yield* theSource(before);
          yield* same("ExpiryBeyondSource's source", refused.source, source.world.world);
          yield* sameInstant("ExpiryBeyondSource's latest", refused.latest, source.world.expiresAt);
          yield* expiresAfter("ExpiryBeyondSource's asked", refused.asked, before.now, asked.payload.lifetimeMinutes);
          yield* expect(millis(refused.asked) > millis(refused.latest), "the expiry asked is not after the latest");
        }),
      ),
      check("nothing is made", noWorld(asked.payload.as)),
    ],
    NotWorldOwner: (asked, refused, before) => [
      check(
        "NotWorldOwner names the source and its owner, who is not the caller",
        Effect.gen(function* () {
          const source = yield* theSource(before);
          yield* same("NotWorldOwner", [refused.world, refused.owner], [source.world.world, source.world.owner]);
          const caller = yield* operatorName(asked.options);
          yield* expect(caller !== source.world.owner, `the owner ${caller} was refused as not the owner`);
        }),
      ),
      check("nothing is made", noWorld(asked.payload.as)),
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
      check("nothing is made", noWorld(asked.payload.as)),
    ],
    WorldNotFound: (asked, refused) => [
      check("WorldNotFound names the source asked", same("its world", refused.world, asked.payload.world)),
      check("nothing is made", noWorld(asked.payload.as)),
    ],
  },
});
