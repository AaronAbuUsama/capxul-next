// `capxul snapshot delete` (today `world.snapshot.delete`): removing a snapshot no longer needed.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { verb, claim } from "@capxul/blueprint-tools";
import { NotImplemented, NotWorldOwner } from "../../../common/refusals.ts";
import { SnapshotName, WorldName } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { WorldNotFound } from "../../world/refusals.ts";
import { SnapshotDeleted } from "../events.ts";
import { saved } from "../examples.ts";
import { SnapshotInUse, SnapshotNotFound } from "../refusals.ts";
import { Snapshot } from "../values.ts";

export const snapshotDelete = verb({
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

/** Who serves it: the platform's world service (`PlatformRpcs`), so it works while a world is parked. */
export const server = "platform";

/** What `world.snapshot.delete` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: snapshotDelete,
  claims: [
    claim(
      "Deleting a snapshot removes it and records it, and leaves the world and its other snapshots as they were.",
      w.quotaFull,
      "world.snapshot.delete of `scratch` answers it as world.snapshot.list listed it. record.export lists one new entry, `snapshot_deleted`, carrying its world, its name and the record position it held; world.snapshot.list lists `base` alone, as before; world.show reads as before but for its record head, one higher. Deleting `scratch` again is refused with SnapshotNotFound.",
      { refusals: [SnapshotNotFound], thinLine: true },
    ),
    claim(
      "A snapshot a live world hangs from cannot be deleted, and stays as it was.",
      w.quotaFull,
      "world.snapshot.delete of `base`, from which the second operator restored a world, is refused with SnapshotInUse naming that world, as world.snapshot.list's `inUseBy` names it; world.snapshot.list lists `base` unchanged, the record gains no entry, and world.show of the restored world still names `base` as its parent.",
      { refusals: [SnapshotInUse] },
    ),
    claim(
      "Only the world's owner may delete a snapshot, and only one that exists, of a world that exists.",
      w.quotaFull,
      "world.snapshot.delete by the second operator is refused with NotWorldOwner naming the first operator; of a name with no world, with WorldNotFound; of `m9`, which was never saved, with SnapshotNotFound. The record gains no entry and world.snapshot.list lists the same snapshots.",
      { refusals: [NotWorldOwner, WorldNotFound, SnapshotNotFound] },
    ),
  ],
  dropped: [],
};
