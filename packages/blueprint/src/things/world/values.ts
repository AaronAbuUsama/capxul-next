// The concept "world": making, showing, saving and restoring whole worlds, and moving a world's clock. The first
// four are served by the platform's world service (`packages/world`), because they must work while a world is
// parked or does not exist yet. `world.clock.warp` acts inside one running world and is served through its door.
// A world's Core cannot create the world it runs in, so the operations are two Rpc groups: `PlatformRpcs` for what
// must work while a world is parked or absent, `WorldRpcs` for everything inside one running world (the clock's warp
// and the history's export included). Platform operations name the world they act on; a world's own operations name
// none, since a client is made for one world's endpoint and a `world` field could only disagree with it.
//
// The platform group runs where the Cloudflare and Neon keys are, because a world takes minutes of Alchemy deploys
// that no Worker can host: `packages/world` serves it in the process that holds them (the runner, in an agent's
// container or in CI, or `world platform serve`), on the machine's loopback, with Core's own sign-in and span
// middlewares. A world's facts (its chain's contracts, its cast, its companies) are rows of its own database; its
// owner and expiry are the registry's. A caller on another machine cannot reach a loopback platform: hosting it is a
// question for Aaron (a running service holding the keys), not built.
//
// A world's values: the platform's limits on worlds.
import * as Schema from "effect/Schema";
import type { WorldView } from "../../common/values.ts";

/** The platform's limits on worlds: at most 7 days and 5 live worlds per owner. Agreed by Aaron on 13 November 2026. */
export const WORLD_LIMITS = { lifetimeMinutes: 7 * 24 * 60, liveWorldsPerOwner: 5 } as const;

/**
 * @internal Shared by `world create` and `snapshot restore`; not exported from the package.
 */
export const Lifetime = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: WORLD_LIMITS.lifetimeMinutes }));

/** @internal The parts of a world a reset puts back, one span each; shared by the world's work, not exported. */
export const ResetPart = Schema.Literals(["index", "database", "chain", "clock", "sites", "api"]);

/** @internal Why a world's work was refused; shared by the world's work, not exported. */
export const WorkRefusal = Schema.Literals([
  "no such world",
  "no such snapshot",
  "not the world's owner",
  "beyond the lifetime limit",
]);

/** @internal What of a world its destroying or sweeping left behind; shared by the world's work, not exported. */
export const WorldPart = Schema.Literals(["api", "objects", "branch", "sites", "registry"]);

/**
 * @internal What world_created carries, for both verbs that make a world.
 */
export const created = (view: typeof WorldView.Type) => ({
  world: view.world,
  owner: view.owner,
  grade: view.grade,
  expiresAt: view.expiresAt,
  parent: view.parent,
});
