// `capxul world show` (today `world.show`): one world as it is now.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { verb, claim, kept } from "@capxul/blueprint-tools";
import { NotImplemented } from "../../../common/refusals.ts";
import { WorldName, WorldView } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { exampleWorld } from "../examples.ts";
import { WorldNotFound } from "../refusals.ts";

export const show = verb({
  rpc: Rpc.make("world.show", {
    payload: { world: WorldName },
    success: WorldView,
    error: Schema.Union([WorldNotFound, NotImplemented]),
  }),
  emits: [],
  budget: {
    ms: 2_000,
    excludes: [],
    provisional: true,
    basis:
      "reads the registry and the world's database; spikes/hosting measured 350 to 450 ms for a query that wakes a Neon branch",
  },
  examples: [{ payload: { world: "town" }, success: exampleWorld }],
});

/** Who serves it: the platform's world service (`PlatformRpcs`), so it works while a world is parked. */
export const server = "platform";

/** It moves no thing with a lifecycle (the machine format): why. */
export const stateless = "a read: shows one world and changes nothing";

/** What `world.show` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: show,
  claims: [
    claim(
      "A world restored into another names its parent.",
      w.restored,
      "world.show of the restored world answers parent with the first world, `m3` and the record position `m3` holds.",
      { origin: kept("world.show/c-6aa449b0c9f7abaf"), thinLine: true },
    ),
    claim(
      "A world made from nothing names no parent, and a name with no world is refused.",
      w.nothing,
      "world.show of a world world.create has just made answers parent null. world.show of a name no world has is refused with WorldNotFound.",
      { refusals: [WorldNotFound] },
    ),
    claim(
      "It shows a world's owner, grade, expiry, clock, record head, cast and companies, each company with its site's state.",
      w.founded,
      "world.show answers the owner, grade, expiry, door, chain id, contracts and cast that the call that made the world answered (the `world` fact), a record head that matches record.export's, and northwind with its site ready at its own address.",
    ),
  ],
  dropped: [],
};
