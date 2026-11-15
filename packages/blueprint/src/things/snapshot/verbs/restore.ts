// `capxul snapshot restore` (today `world.snapshot.restore`): a new world made from a snapshot.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { declare, claim, kept, dropped } from "@capxul/blueprint-tools";
import { NotImplemented, NotWorldOwner } from "../../../common/refusals.ts";
import { SnapshotName, WorldName, WorldView } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { created, WorldCreated } from "../../world/events.ts";
import { WorldExists, WorldNotFound, WorldQuotaReached } from "../../world/refusals.ts";
import { Lifetime } from "../../world/values.ts";
import { restoredWorld } from "../examples.ts";
import { ExpiryBeyondSource, SnapshotNotFound } from "../refusals.ts";

export const snapshotRestore = declare({
  rpc: Rpc.make("world.snapshot.restore", {
    payload: { world: WorldName, snapshot: SnapshotName, as: WorldName, lifetimeMinutes: Lifetime },
    success: WorldView,
    error: Schema.Union([
      WorldNotFound,
      SnapshotNotFound,
      NotWorldOwner,
      WorldExists,
      ExpiryBeyondSource,
      WorldQuotaReached,
      NotImplemented,
    ]),
  }),
  emits: [{ event: WorldCreated, carries: ({ success }) => created(success) }],
  budget: {
    ms: 120_000,
    excludes: [],
    provisional: true,
    basis:
      "a branch fork took 10 s (spikes/hosting) and a deploy 39 to 43 s (spikes/containers); restoring sites onto a bench is not measured",
  },
  examples: [
    {
      payload: { world: "town", snapshot: "m3", as: "town3", lifetimeMinutes: 60 },
      success: restoredWorld,
    },
  ],
});

/** Who serves it: the platform's world service (`PlatformRpcs`), so it works while a world is parked. */
export const server = "platform";

/** What `world.snapshot.restore` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: snapshotRestore,
  claims: [
    claim(
      "A restore into a separate world leaves the first world untouched and the two never see each other.",
      w.withSnapshot,
      "world.snapshot.restore of `m3` as a new world answers a different door and the parent. A doc.create and an approval.sign of a held payment in each world (calls `at` the new world's door for the new one) appear in that world's record.export and General Ledger only, and the company Safe's USDC balance (chain.balance at each door) moves only in its own world.",
      { origin: kept("world.snapshot.restore/c-1dd79fdbcb1c0fd7"), thinLine: true },
    ),
    claim(
      "The new world holds what the snapshot saved: its record up to the snapshot, its clock, its people, companies, documents, balances and hats.",
      w.withSnapshot,
      "In the new world (calls `at` its door) record.export lists the first world's entries up to the snapshot's position, entry for entry, then one `world_created` naming the parent; the clock is the snapshot's; the General Ledger and Trial Balance read the same as in the first world at the save, and through each world's chain reads every Safe's USDC balance (chain.balance) and sam's Books hat (chain.wears) read the same as in the first world at the snapshot's block.",
    ),
    claim(
      "Anyone on the platform may restore a template snapshot; only the owner may restore any other.",
      w.withSnapshot,
      "The second operator (`operator: second`) restores `m3` and owns the new world: its owner is the second operator `nothing`'s facts name, and record.export at its door as the second operator answers. Restoring `draft` as the second operator is refused with NotWorldOwner naming the first operator.",
      { refusals: [NotWorldOwner] },
    ),
    claim(
      "A world made from a snapshot cannot outlive the world it came from.",
      w.withSnapshot,
      "A restore whose lifetime ends after the first world's expiry is refused with ExpiryBeyondSource naming the latest expiry allowed, and nothing is made.",
      { refusals: [ExpiryBeyondSource] },
    ),
    claim(
      "A snapshot that does not exist, or a new world's name that is taken, is refused and nothing is made.",
      w.withSnapshot,
      "A restore of `m9` is refused with SnapshotNotFound; a restore as the first world's own name is refused with WorldExists.",
      { refusals: [SnapshotNotFound, WorldExists] },
    ),
  ],
  dropped: [
    dropped(
      "world.snapshot.restore/c-369b1db183b9807f",
      "An in-place restore returns the world to the snapshot and records it.",
      "A world is never rewound in place. Going back is a restore into a new world, which costs a branch fork, keeps the record append-only and needs no epochs.",
    ),
  ],
};
