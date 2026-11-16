// `capxul snapshot save` (today `world.snapshot.save`): saving a world's state under a name.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { verb, claim, kept, span } from "@capxul/blueprint-tools";
import { NotImplemented, NotWorldOwner } from "../../../common/refusals.ts";
import { SnapshotName, WorldName } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { WorldNotFound } from "../../world/refusals.ts";
import { SnapshotSaved } from "../events.ts";
import { saved } from "../examples.ts";
import { SnapshotExists, SnapshotInUse } from "../refusals.ts";
import { Snapshot } from "../values.ts";
import { StepKind } from "../../../telemetry/step-kinds.ts";

// A snapshot is a Neon branch of the world's branch with no compute, the chain's whole state in the world's own R2
// bucket under the snapshot's name, a backup of each of the world's sites on the bench (`bench backup`, kept by the
// site service beside the world's sites), and the platform's row of it. It is named within its world and goes with
// it: the world's destroy deletes the snapshot branches first.
export const snapshotSave = verb({
  rpc: Rpc.make("world.snapshot.save", {
    payload: {
      world: WorldName,
      snapshot: SnapshotName,
      /** Replace a snapshot of this name instead of refusing. */
      replace: Schema.Boolean,
      /** Anyone on the platform may restore from it, not only the world's owner. */
      template: Schema.Boolean,
    },
    success: Snapshot,
    /** SnapshotInUse: `replace` of a snapshot a live world hangs from, which cannot go while that world lives. */
    error: Schema.Union([WorldNotFound, NotWorldOwner, SnapshotExists, SnapshotInUse, NotImplemented]),
  }),
  emits: [
    {
      event: SnapshotSaved,
      carries: ({ success }) => ({
        world: success.world,
        snapshot: success.snapshot,
        recordSeq: success.recordSeq,
        template: success.template,
      }),
    },
  ],
  // Its steps (4.1), as `packages/world` saves a world: the sites' side (their backup, then the point) beside the
  // database and chain side (the index stopped, the branch and the chain's state saved, the index resumed), then kept.
  spans: {
    /** The world's company sites backed up by the bench's site door. */
    sites: span("world.snapshot.save.sites", StepKind.site),
    /** The sites' backup kept as the snapshot's point. */
    point: span("world.snapshot.save.point", StepKind.site),
    /** The world's index stopped, so the branch holds a still index. */
    indexStop: span("world.snapshot.save.index.stop", StepKind.container),
    /** The world's database branched for the snapshot. */
    branch: span("world.snapshot.save.branch", StepKind.branch),
    /** The world's chain state saved by its hub. */
    chain: span("world.snapshot.save.chain", StepKind.container),
    /** The world's index started again. */
    indexResume: span("world.snapshot.save.index.resume", StepKind.container),
    /** The snapshot written to the registry and the world's record. */
    keep: span("world.snapshot.save.keep", StepKind.database),
  },
  budget: {
    ms: 30_000,
    excludes: ["waking a parked world"],
    provisional: true,
    basis:
      "a Neon branch takes 8 to 10 s (spikes/hosting) and saving the chain 0.8 to 2.1 s (spikes/containers); a site's backup is not measured",
  },
  examples: [
    {
      payload: { world: "town", snapshot: "m3", replace: false, template: true },
      success: saved,
    },
  ],
});

/** Who serves it: the platform's world service (`PlatformRpcs`), so it works while a world is parked. */
export const server = "platform";

/** What `world.snapshot.save` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: snapshotSave,
  claims: [
    claim(
      "A snapshot saves everything that makes the world and leaves it untouched.",
      w.paid,
      "world.snapshot.save answers the record position it holds, the clock and one company. Afterwards record.export lists one new entry, `snapshot_saved`, and nothing else changed: world.show, the General Ledger and the USDC balances of the company Safe and every personal Safe (chain.balance) read the same as before. world.snapshot.restore of it is covered by that operation's claims.",
      { origin: kept("world.snapshot.save/c-69e4dbcdf13e3750"), thinLine: true },
    ),
    claim(
      "A name already saved is refused unless replacing is asked for, and the snapshot is unchanged.",
      w.withSnapshot,
      "world.snapshot.save of `m3` without replace is refused with SnapshotExists and the record gains no entry; with replace it answers a new record position.",
      { refusals: [SnapshotExists] },
    ),
    claim(
      "Only the world's owner may save a snapshot, and only of a world that exists.",
      w.fresh,
      "world.snapshot.save by the second operator (`operator: second`) is refused with NotWorldOwner naming the first operator as owner; of a name with no world, with WorldNotFound. The record gains no entry.",
      { refusals: [NotWorldOwner, WorldNotFound] },
    ),
  ],
  dropped: [],
};
