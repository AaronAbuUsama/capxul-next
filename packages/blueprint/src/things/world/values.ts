// The concept "world": making, showing, saving and restoring whole worlds, and moving a world's clock. The first
// four are served by the platform's world service (`packages/world`), because they must work while a world is
// parked or does not exist yet. `world.clock.warp` acts inside one running world and is served through its door.
//
// A world's values: the platform's limits on worlds.
import * as Schema from "effect/Schema";

/** The platform's limits on worlds. Agreed by Aaron on 13 November 2026: decisions.md, "Answered by Aaron", 2. */
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
