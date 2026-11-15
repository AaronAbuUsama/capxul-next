// The concept "world", its inventory: what an operator has on the platform. `world.list` lists the caller's own worlds,
// `world.snapshot.list` a world's saved snapshots and `world.snapshot.delete` removes one no longer needed. All three are
// served by the platform's world service (`packages/world`), as `world.create` and `world.show` are, because they must
// work while a world is parked. A snapshot's database is a branch of its world's, and a world restored from it (or its
// own world, reset to it in place) is a branch of the snapshot's, so a snapshot cannot go while such a world lives.
//
// `capxul world list` (today `world.list`): the caller's own worlds.
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as Rpc from "effect/rpc/Rpc";
import { declare, claim } from "@capxul/blueprint-tools";
import { NotImplemented } from "../../../common/refusals.ts";
import { OperatorName, WorldView } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { exampleWorld } from "../examples.ts";
import { WORLD_LIMITS } from "../values.ts";

/** One world as `world.list` answers it: what `world.show` answers of it, and how many snapshots it keeps. */
export const ListedWorld = Schema.Struct({
  ...Struct.pick(WorldView.fields, ["world", "grade", "state", "expiresAt", "door", "parent"]),
  snapshots: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
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

/** Who serves it: the platform's world service (`PlatformRpcs`), so it works while a world is parked. */
export const server = "platform";

/** It moves no thing with a lifecycle (the machine format): why. */
export const stateless = "a read: lists the caller's worlds and changes nothing";

/** What `world.list` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: list,
  claims: [
    claim(
      "An operator lists exactly the worlds they own, each as world.show shows it, with how many snapshots it keeps.",
      w.quotaFull,
      "world.list by the first operator answers them as its owner, the limit of live worlds and every world `quota-full` filled, as many worlds as the limit; each with the grade, state, expiry, door and parent world.show answers, an owner who is the caller, and as many snapshots as world.snapshot.list lists. world.list by the second operator holds none of the first operator's worlds.",
      { thinLine: true },
    ),
    claim(
      "A world restored from another operator's template is listed by its new owner alone, naming where it came from.",
      w.quotaFull,
      "After the second operator restores the first operator's template `base`, world.list by the second operator holds the new world, its parent the first operator's world and `base`; the first operator's list does not hold it, and lists their world with one snapshot once `scratch` is deleted.",
    ),
  ],
  dropped: [],
};
