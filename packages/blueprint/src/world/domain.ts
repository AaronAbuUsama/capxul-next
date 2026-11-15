// The door of the domain "world": making, showing, saving and restoring whole worlds, and moving a world's clock. Its
// operations by name, its share of the two Rpc groups and its claims, which ../domains.ts gathers with every other
// domain's. Its events and declarations are in operations.ts, its claims in claims.ts, its own refusals in refusals.ts.
import * as RpcGroup from "effect/rpc/RpcGroup";
import type { ClaimsOf } from "../claims/claim.ts";
import * as Claims from "./claims.ts";
import * as World from "./operations.ts";

export * from "./operations.ts";

/** Its operations, by name. */
export const operations = {
  "world.create": World.create,
  "world.clock.warp": World.clockWarp,
  "world.snapshot.save": World.snapshotSave,
  "world.snapshot.restore": World.snapshotRestore,
  "world.show": World.show,
} as const;

/** What the platform's world service serves of it (`PlatformRpcs`). */
export const platformRpcs = RpcGroup.make(
  World.create.rpc,
  World.show.rpc,
  World.snapshotSave.rpc,
  World.snapshotRestore.rpc,
);

/** What a world's Core serves of it, through the world's door (`WorldRpcs`). */
export const worldRpcs = RpcGroup.make(World.clockWarp.rpc);

/** The claims of each of its operations. */
export const claims: { readonly [Name in keyof typeof operations]: ClaimsOf } = {
  "world.create": Claims.create,
  "world.clock.warp": Claims.clockWarp,
  "world.snapshot.save": Claims.snapshotSave,
  "world.snapshot.restore": Claims.snapshotRestore,
  "world.show": Claims.show,
};
