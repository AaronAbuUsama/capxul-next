// `capxul snapshot list` (today `world.snapshot.list`): a world's saved snapshots.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { verb, claim } from "@capxul/blueprint-tools";
import { NotImplemented, NotWorldOwner } from "../../../common/refusals.ts";
import { WorldName } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { WorldNotFound } from "../../world/refusals.ts";
import { saved } from "../examples.ts";
import { Snapshot } from "../values.ts";

/** One snapshot as `world.snapshot.list` answers it: as its save answered, and the live worlds that hang from it. */
export const ListedSnapshot = Schema.Struct({
  ...Snapshot.fields,
  /** The live worlds whose database is a branch of the snapshot's: it cannot be deleted while there is one. */
  inUseBy: Schema.Array(WorldName),
});

export const snapshotList = verb({
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

/** Who serves it: the platform's world service (`PlatformRpcs`), so it works while a world is parked. */
export const server = "platform";

/** It moves no thing with a lifecycle (the machine format): why. */
export const stateless = "a read: lists a world's snapshots and changes nothing";

/** What `world.snapshot.list` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: snapshotList,
  claims: [
    claim(
      "It lists every snapshot a world keeps, in the order they were saved, each as its save answered.",
      w.quotaFull,
      "After the first operator saves `base`, a template, and then `scratch` of a world they own, world.snapshot.list answers the world and both snapshots in that order, each exactly as world.snapshot.save answered it. The record gains no entry.",
      { thinLine: true },
    ),
    claim(
      "Each snapshot names the live worlds that hang from it.",
      w.quotaFull,
      "After the second operator restores `base` as a world of their own, world.snapshot.list lists `base` in use by that world alone and `scratch` by none.",
    ),
    claim(
      "Only the world's owner may list its snapshots, and only of a world that exists.",
      w.quotaFull,
      "world.snapshot.list by the second operator is refused with NotWorldOwner naming the first operator as owner; of a name with no world, with WorldNotFound naming it.",
      { refusals: [NotWorldOwner, WorldNotFound] },
    ),
  ],
  dropped: [],
};
