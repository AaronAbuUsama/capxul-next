// `capxul world create` (today `world.create`): making a world from nothing.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { declare, claim, kept, rewritten, dropped } from "@capxul/blueprint-tools";
import { NotImplemented } from "../../../common/refusals.ts";
import { ClockMode, Grade, Instant, WorldName, WorldView } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { created, WorldCreated } from "../events.ts";
import { exampleWorld } from "../examples.ts";
import { ClockBeforeSeed, GradeNotOffered, WorldExists, WorldQuotaReached } from "../refusals.ts";
import { Lifetime } from "../values.ts";

// It answers once the world runs, not `creating`: a run is one unit (roadmap, "World lifecycle rules", 1), and a
// caller has nothing to do with a world that does not answer. It answers once the new world's Core has answered its
// health check ten times in a row, so a first call `at` it is not answered by Cloudflare's edge. The owner is the
// calling operator; the payload asks for a lifetime in minutes, capped by `WORLD_LIMITS`, and the answer gives the
// expiry in host time. A world begins at host time or at a chosen time, frozen or running at rate 1 (no other rate:
// nothing needs one, and a running clock already drifts across daylight saving), never before `ClockBeforeSeed`.
export const create = declare({
  rpc: Rpc.make("world.create", {
    payload: {
      world: WorldName,
      grade: Grade,
      lifetimeMinutes: Lifetime,
      clock: Schema.Struct({
        mode: ClockMode,
        /** World time to begin at; null for host time. */ startAt: Schema.NullOr(Instant),
      }),
    },
    success: WorldView,
    error: Schema.Union([WorldExists, GradeNotOffered, WorldQuotaReached, ClockBeforeSeed, NotImplemented]),
  }),
  emits: [{ event: WorldCreated, carries: ({ success }) => created(success) }],
  budget: {
    ms: 90_000,
    excludes: [],
    provisional: true,
    basis:
      "spikes/containers deployed a world with published images in 39 to 43 s and spikes/hosting made a Neon branch in 8 to 10 s; migrations, Core and the cast are not measured yet",
  },
  examples: [
    {
      payload: { world: "town", grade: "private", lifetimeMinutes: 60, clock: { mode: "frozen", startAt: null } },
      success: exampleWorld,
    },
  ],
});

/** Who serves it: the platform's world service (`PlatformRpcs`), so it works while a world is parked. */
export const server = "platform";

/** What `world.create` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: create,
  claims: [
    claim(
      "A new world runs with its clock and a record that begins with its birth.",
      w.nothing,
      "world.create with a frozen clock answers state running, clock frozen, record head 1 and no parent. record.export at the new world's door lists exactly one entry, `world_created`, at seq 1, carrying what world.create answered.",
      { origin: kept("world.create/c-52e22ec1e2a6c1cc"), thinLine: true },
    ),
    // Its start is halfway between the seed's last block and host time, which is always before host time, so the
    // promise needs no condition. Still open for R9 (src/ratchets.ts): an `Instant` carries milliseconds but a block's
    // timestamp is whole seconds, and nothing says whether such a start is refused, rounded and answered rounded, or
    // kept in the clock but not on the chain; the journey asks for a whole second, which avoids the question.
    claim(
      "A fresh world can begin before host time, though not before its seeded chain's last block, and an existing world's time cannot be reset.",
      w.nothing,
      "A start before the seeded chain's last block is refused with ClockBeforeSeed naming the earliest start. world.create with a frozen clock starting halfway between that earliest start and host time answers that time as its clock, and chain.head at the new world's door has that timestamp: a new world's chain mines a block at its start. Creating the same name again is refused with WorldExists naming its owner and expiry, and world.show shows the clock unchanged.",
      {
        refusals: [WorldExists, ClockBeforeSeed],
        origin: rewritten(
          "world.create/c-fc7bfdea5dd33f3e",
          "A fresh world can begin before host time, but an existing world's time cannot be reset.",
          "A world's chain is loaded from the seeded chain state, and a chain's time cannot go back past its last block.",
        ),
      },
    ),
    claim(
      "A real world is never made by this operation: asking for one is refused and nothing is made.",
      w.nothing,
      "world.create with grade real is refused with GradeNotOffered; world.show of the name is then refused with WorldNotFound.",
      {
        refusals: [GradeNotOffered],
        origin: rewritten(
          "world.create/c-4ee06f2f1dd89e20",
          "Production is never made without the platform owner's approval.",
          "Grades replace kinds. A real world is made by the platform's own deploy with Aaron's written go-ahead, never by this operation.",
        ),
      },
    ),
    claim(
      "Every world has an owner and an expiry: the caller owns the world it creates, and it expires after the lifetime asked for.",
      w.nothing,
      "world.create with a lifetime of 60 minutes answers the calling operator, the first operator `nothing`'s facts name, as owner and an expiry 60 minutes after the call, within a minute; world.show answers the same. world.create by the second operator answers the second operator as its owner.",
    ),
    claim(
      "A world is born with its cast: each person can call through the door and signs with a known test key, and everyone but pat holds a claimed personal Safe with 10,000 USDC.",
      w.nothing,
      "world.create lists dana, eli, sam, pat and olga, each with a signer address that is one of the well-known test keys; every one but pat has a Safe, and each Safe's balance of the world's USDC (chain.balance at the new world's door) is 10,000. record.export at the new world's door as each person is refused with NotWorldOwner, not NotSignedIn: the door signs each of them in.",
    ),
    // Read where the promise is silent (R9): the refusal's `owner` is the first operator.
    claim(
      "An owner with as many live worlds as allowed is refused, and nothing is made.",
      w.quotaFull,
      "world.create is refused with WorldQuotaReached naming the owner, the live count and the limit; world.show of the name is refused with WorldNotFound.",
      { refusals: [WorldQuotaReached] },
    ),
  ],
  dropped: [
    dropped(
      "world.create/c-51839d5bf812fa32",
      "A `full` world gives each company a site on its own address and a `core` world gives none.",
      "There are no profiles. A company gets its site when it is founded (roadmap step 1.4), in every world.",
    ),
    dropped(
      "world.create/c-43a66f24b447122c",
      "A world made from a template starts with the template's companies on their own addresses.",
      "A world is made from a template by world.snapshot.restore, whose claims cover it.",
    ),
  ],
};
