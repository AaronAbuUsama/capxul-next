// The door of the domain "world": making, showing, listing, saving, restoring and deleting whole worlds' snapshots,
// and moving a world's clock. Its operations by name, its share of the two Rpc groups and its claims, which
// ../domains.ts gathers with every other domain's. Its events and declarations are in operations.ts and, for what an
// operator has (inventory), inventory.ts; its claims in claims.ts and inventory-claims.ts, its refusals in refusals.ts.
import * as RpcGroup from "effect/rpc/RpcGroup";
import type { ClaimsOf } from "../claims/claim.ts";
import * as Claims from "./claims.ts";
import * as Inventory from "./inventory.ts";
import * as InventoryClaims from "./inventory-claims.ts";
import * as World from "./operations.ts";

export * from "./operations.ts";
export * from "./inventory.ts";

/** Its machines, by name (src/machine.ts): none yet. */
export const machines = {} as const;

/** Its operations, by name. */
export const operations = {
  "world.create": World.create,
  "world.clock.warp": World.clockWarp,
  "world.snapshot.save": World.snapshotSave,
  "world.snapshot.restore": World.snapshotRestore,
  "world.show": World.show,
  "world.list": Inventory.list,
  "world.snapshot.list": Inventory.snapshotList,
  "world.snapshot.delete": Inventory.snapshotDelete,
} as const;

/** What the platform's world service serves of it (`PlatformRpcs`). */
export const platformRpcs = RpcGroup.make(
  World.create.rpc,
  World.show.rpc,
  World.snapshotSave.rpc,
  World.snapshotRestore.rpc,
  Inventory.list.rpc,
  Inventory.snapshotList.rpc,
  Inventory.snapshotDelete.rpc,
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
  "world.list": InventoryClaims.list,
  "world.snapshot.list": InventoryClaims.snapshotList,
  "world.snapshot.delete": InventoryClaims.snapshotDelete,
};
