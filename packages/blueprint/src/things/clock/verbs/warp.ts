// `capxul clock warp` (today `world.clock.warp`): moving a world's clock forward.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { declare, claim, kept } from "@capxul/blueprint-tools";
import { NotImplemented, NotWorldOwner } from "../../../common/refusals.ts";
import { Clock, Instant } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { ClockWarped } from "../events.ts";
import { ClockBackwards } from "../refusals.ts";

// A warp is by a number of seconds or to an instant, forward only, and runs the site's daily job (`Site.DAILY_JOB`)
// once for every day it passes.
export const clockWarp = declare({
  rpc: Rpc.make("world.clock.warp", {
    payload: {
      target: Schema.Union([
        Schema.TaggedStruct("by", { seconds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)) }),
        Schema.TaggedStruct("to", { at: Instant }),
      ]),
    },
    success: Schema.Struct({
      from: Instant,
      clock: Clock,
      /** Company sites that followed the clock. */ sites: Schema.Int,
    }),
    error: Schema.Union([NotWorldOwner, ClockBackwards, NotImplemented]),
  }),
  emits: [{ event: ClockWarped, carries: ({ success }) => ({ from: success.from, to: success.clock.now }) }],
  budget: {
    ms: 30_000,
    excludes: ["waking a parked world"],
    provisional: true,
    basis:
      "a guess for a warp of up to a month that stops at every due instant; spikes/bench-clocks proved the sites follow but timed no warp",
  },
  examples: [
    {
      payload: { target: { _tag: "by", seconds: 7 * 24 * 3600 } },
      success: { from: "2026-11-13T09:00:00Z", clock: { mode: "frozen", now: "2026-11-20T09:00:00Z" }, sites: 1 },
    },
  ],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** What `world.clock.warp` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: clockWarp,
  claims: [
    claim(
      "A warp moves the chain and every site together and runs what fell due.",
      w.founded,
      "world.clock.warp by 7 days answers the clock a week on and one site. chain.head has a timestamp at or after it, and report.run of the Scheduled Job Log filtered to the Capxul app's daily job (Site.DAILY_JOB) shows it ran once for each day, 7 runs more than before. A warp to an earlier time is refused with ClockBackwards and the clock does not move.",
      { refusals: [ClockBackwards], origin: kept("world.clock.warp/c-2bceeaa41942995d"), thinLine: true },
    ),
    claim(
      "Only the world's owner may move the clock; a person of the world is refused and the clock does not move.",
      w.founded,
      "world.clock.warp as dana is refused with NotWorldOwner; world.show shows the clock unchanged.",
      { refusals: [NotWorldOwner] },
    ),
  ],
  dropped: [],
};
