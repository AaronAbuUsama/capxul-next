// The concept "world", its inventory: what an operator has on the platform. `world.list` lists the caller's own worlds,
// `world.snapshot.list` a world's saved snapshots and `world.snapshot.delete` removes one no longer needed. All three are
// served by the platform's world service (`packages/world`), as `world.create` and `world.show` are, because they must
// work while a world is parked. A snapshot's database is a branch of its world's, and a world restored from it (or its
// own world, reset to it in place) is a branch of the snapshot's, so a snapshot cannot go while such a world lives.
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as Rpc from "effect/rpc/Rpc";
import { NotImplemented, NotWorldOwner, SnapshotInUse, SnapshotNotFound, WorldNotFound } from "../errors.ts";
import { declare } from "../operation.ts";
import { OperatorName, Seq, SnapshotName, WorldName, WorldView } from "../values.ts";
import { exampleWorld } from "./example.ts";
import { Snapshot, WORLD_LIMITS } from "./operations.ts";

/** A snapshot was deleted: the last entry it adds to its world's record. `recordSeq` is the position it held. */
export class SnapshotDeleted extends Schema.TaggedClass<SnapshotDeleted, { readonly brand: unique symbol }>()(
  "snapshot_deleted",
  {
    world: WorldName,
    snapshot: SnapshotName,
    recordSeq: Seq,
  },
) {}

/** One world as `world.list` answers it: what `world.show` answers of it, and how many snapshots it keeps. */
export const ListedWorld = Schema.Struct({
  ...Struct.pick(WorldView.fields, ["world", "grade", "state", "expiresAt", "door", "parent"]),
  snapshots: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

/** One snapshot as `world.snapshot.list` answers it: as its save answered, and the live worlds that hang from it. */
export const ListedSnapshot = Schema.Struct({
  ...Snapshot.fields,
  /** The live worlds whose database is a branch of the snapshot's: it cannot be deleted while there is one. */
  inUseBy: Schema.Array(WorldName),
});

export const list = declare({
  rpc: Rpc.make("world.list", {
    payload: {},
    success: Schema.Struct({
      /** The caller: only their own worlds are listed. */
      owner: OperatorName,
      /** How many live worlds one owner may have. */
      limit: Schema.Int,
      /** Every live world the caller owns, ordered by name. */
      worlds: Schema.Array(ListedWorld),
    }),
    error: Schema.Union([NotImplemented]),
  }),
  emits: [],
  budget: {
    ms: 2_000,
    excludes: [],
    provisional: true,
    basis:
      "reads the registry's rows of the caller's worlds and the platform's rows of their snapshots, one query each; wakes no world; not measured",
  },
  examples: [
    {
      payload: {},
      success: {
        owner: "ci",
        limit: WORLD_LIMITS.liveWorldsPerOwner,
        worlds: [
          {
            world: exampleWorld.world,
            grade: exampleWorld.grade,
            state: exampleWorld.state,
            expiresAt: exampleWorld.expiresAt,
            door: exampleWorld.door,
            parent: exampleWorld.parent,
            snapshots: 1,
          },
        ],
      },
    },
  ],
});

/** The snapshot `m3` of the example world, as world.snapshot.save's example saved it. */
const saved: typeof Snapshot.Type = {
  world: "town",
  snapshot: "m3",
  recordSeq: 14,
  clock: exampleWorld.clock,
  template: true,
  savedAt: "2026-11-13T10:05:00Z",
  companies: 1,
  migrations: "0004_documents",
};

export const snapshotList = declare({
  rpc: Rpc.make("world.snapshot.list", {
    payload: { world: WorldName },
    success: Schema.Struct({
      world: WorldName,
      /** Every snapshot the world keeps, in the order they were saved. */
      snapshots: Schema.Array(ListedSnapshot),
    }),
    error: Schema.Union([WorldNotFound, NotWorldOwner, NotImplemented]),
  }),
  emits: [],
  budget: {
    ms: 2_000,
    excludes: [],
    provisional: true,
    basis:
      "reads the registry, the platform's rows of the world's snapshots and the branches of the platform's Neon project; wakes no world; not measured",
  },
  examples: [
    {
      payload: { world: "town" },
      success: { world: "town", snapshots: [{ ...saved, inUseBy: ["town3"] }] },
    },
  ],
});

export const snapshotDelete = declare({
  rpc: Rpc.make("world.snapshot.delete", {
    payload: { world: WorldName, snapshot: SnapshotName },
    /** The snapshot deleted, as its save answered it. */
    success: Snapshot,
    error: Schema.Union([WorldNotFound, NotWorldOwner, SnapshotNotFound, SnapshotInUse, NotImplemented]),
  }),
  emits: [
    {
      event: SnapshotDeleted,
      carries: ({ success }) => ({ world: success.world, snapshot: success.snapshot, recordSeq: success.recordSeq }),
    },
  ],
  budget: {
    ms: 15_000,
    excludes: ["waking a parked world"],
    provisional: true,
    basis:
      "deletes a Neon branch with no compute and the chain's state saved under the snapshot's name in the bucket, then writes one record entry; not measured",
  },
  examples: [{ payload: { world: "town", snapshot: "m3" }, success: saved }],
});
