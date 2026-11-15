// Journey: an operator's inventory. The first operator, at the limit of live worlds, lists them, saves two snapshots of
// one, and lists those; the second operator restores the template among them as a world of their own. The first then
// cannot delete the snapshot that world hangs from, nor can anyone delete what is not theirs or does not exist, and
// deletes the other; world.show and world.list show the result.
import { startingWorlds } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { expect, given } from "../expectation.ts";
import { journey, outline } from "../journey.ts";
import { hostNow, millis, present, same } from "../support/expect.ts";
import { asSaved } from "../support/inventory.ts";
import { freshName, type View } from "../support/world.ts";

const MINUTE = 60_000;

const steps = outline({
  worlds: [
    "world.list",
    "the first operator lists the worlds they own, as many as the limit; the second operator's list holds none of them",
  ],
  save: ["world.snapshot.save", "the first operator saves base, a template, then scratch, of a world they filled"],
  restore: ["world.snapshot.restore", "the second operator restores the template base as a world of their own"],
  snapshots: [
    "world.snapshot.list",
    "the owner lists base, in use by the restored world, and scratch, each as saved; another operator and an unknown world are refused",
  ],
  refused: [
    "world.snapshot.delete",
    "base, which a live world hangs from, m9, which was never saved, another operator's delete and an unknown world are refused",
  ],
  delete: ["world.snapshot.delete", "the owner deletes scratch, which is then gone"],
  show: [
    "world.show",
    "the restored world still names base as its parent, and the first world's record holds the save of scratch and its delete",
  ],
  listed: [
    "world.list",
    "the second operator lists the restored world; the first lists their world, with one snapshot, and not the restored one",
  ],
});

/** Minutes from now to two minutes before `source` expires, and at least one. */
const lifetimeWithin = (source: View) =>
  Effect.map(hostNow, (now) => Math.max(1, Math.floor((millis(source.expiresAt) - millis(now)) / MINUTE) - 2));

/** A snapshot of a world, by their names. */
const named = (world: string, snapshot: string) => ({ world, snapshot });

const first = { operator: "first" } as const;
const second = { operator: "second" } as const;

export const worldInventory = journey(
  {
    name: "an operator's inventory",
    story:
      "An operator at the limit lists their worlds and a world's snapshots; a snapshot another operator's world was restored from cannot be deleted, and one no world needs is deleted and gone.",
    given: startingWorlds.quotaFull,
    steps,
  },
  Effect.gen(function* () {
    const facts = yield* given(startingWorlds.quotaFull);
    const theirs = yield* present("a world the first operator filled", Option.getOrNull(Arr.head(facts.filled)));
    const [restoredName, unknown] = yield* Effect.all([freshName("ji"), freshName("none")]);

    yield* steps.worlds.run((op) =>
      Effect.gen(function* () {
        const mine = yield* op.succeeds({}, first);
        const listed = Arr.map(mine.worlds, (each) => each.world);
        yield* same("how many worlds the first operator, at the limit, owns", listed.length, mine.limit);
        for (const filled of facts.filled)
          yield* expect(Arr.contains(listed, filled.world), `${filled.world}, which they filled, is not listed`);
        const others = yield* op.succeeds({}, second);
        yield* same(
          "the first operator's worlds in the second operator's list",
          Arr.intersection(
            Arr.map(others.worlds, (each) => each.world),
            listed,
          ),
          [],
        );
      }),
    );

    const [base, scratch] = yield* steps.save.run((op) =>
      Effect.all([
        op.succeeds({ ...named(theirs.world, "base"), replace: false, template: true }, first),
        op.succeeds({ ...named(theirs.world, "scratch"), replace: false, template: false }, first),
      ]),
    );

    const restored = yield* steps.restore.run((op) =>
      Effect.gen(function* () {
        const lifetimeMinutes = yield* lifetimeWithin(theirs);
        return yield* op.succeeds({ ...named(theirs.world, "base"), as: restoredName, lifetimeMinutes }, second);
      }),
    );
    const parent = { world: theirs.world, snapshot: "base", recordSeq: base.recordSeq };

    yield* steps.snapshots.run((op) =>
      Effect.gen(function* () {
        const listed = yield* op.succeeds({ world: theirs.world }, first);
        yield* same(
          "the snapshots listed, in the order saved, and the worlds each is in use by",
          Arr.map(listed.snapshots, (each) => [each.snapshot, each.inUseBy]),
          [
            ["base", [restored.world]],
            ["scratch", []],
          ],
        );
        yield* same("the snapshots listed, as their saves answered", Arr.map(listed.snapshots, asSaved), [
          base,
          scratch,
        ]);
        yield* op.refused("NotWorldOwner", { world: theirs.world }, second);
        yield* op.refused("WorldNotFound", { world: unknown }, first);
      }),
    );

    yield* steps.refused.run((op) =>
      Effect.gen(function* () {
        const inUse = yield* op.refused("SnapshotInUse", named(theirs.world, "base"), first);
        yield* same("the worlds base is in use by", inUse.worlds, [restored.world]);
        yield* op.refused("SnapshotNotFound", named(theirs.world, "m9"), first);
        yield* op.refused("NotWorldOwner", named(theirs.world, "scratch"), second);
        yield* op.refused("WorldNotFound", named(unknown, "scratch"), first);
      }),
    );

    yield* steps.delete.run((op) =>
      Effect.gen(function* () {
        const deleted = yield* op.succeeds(named(theirs.world, "scratch"), first);
        yield* same("the snapshot deleted", [deleted.snapshot, deleted.template], ["scratch", false]);
        yield* op.refused("SnapshotNotFound", named(theirs.world, "scratch"), first);
      }),
    );

    yield* steps.show.run((op) =>
      Effect.gen(function* () {
        const shown = yield* op.succeeds({ world: restored.world }, second);
        yield* same("the restored world's parent", shown.parent, parent);
        const source = yield* op.succeeds({ world: theirs.world }, first);
        // base's own entry, scratch's save, then scratch's delete: nothing else was recorded since base was saved.
        yield* same("the first world's record head", source.recordHead, base.recordSeq + 3);
      }),
    );

    yield* steps.listed.run((op) =>
      Effect.gen(function* () {
        const others = yield* op.succeeds({}, second);
        const found = yield* present(
          `${restored.world} in the second operator's list`,
          Option.getOrNull(Arr.findFirst(others.worlds, (each) => each.world === restored.world)),
        );
        yield* same("the restored world as listed", [found.parent, found.snapshots], [parent, 0]);
        const mine = yield* op.succeeds({}, first);
        yield* expect(
          !Arr.some(mine.worlds, (each) => each.world === restored.world),
          `${restored.world} is in the first operator's list`,
        );
        const source = yield* present(
          `${theirs.world} in the first operator's list`,
          Option.getOrNull(Arr.findFirst(mine.worlds, (each) => each.world === theirs.world)),
        );
        yield* same(`${theirs.world}'s snapshots`, source.snapshots, 1);
      }),
    );
  }),
);
