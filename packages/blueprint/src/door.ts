// The contract's one door: every operation of the thin line with its declaration, and the two Rpc groups that
// serve them. Nothing in this package imports infrastructure or an implementation.
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Approvals from "./approvals/operations.ts";
import * as Documents from "./documents/operations.ts";
import type { Operation } from "./operation.ts";
import * as Organizations from "./organizations/operations.ts";
import * as Record from "./record/operations.ts";
import * as Reports from "./reports/operations.ts";
import { PlatformSignIn, Telemetry, WorldSignIn } from "./telemetry.ts";
import * as World from "./world/operations.ts";

/** Every operation of the thin line, by name, in the journey's order. The generic runner looks a call up here. */
export const operations = {
  "world.create": World.create,
  "org.create": Organizations.create,
  "org.member.grant": Organizations.memberGrant,
  "doc.create": Documents.create,
  "doc.submit": Documents.submit,
  "approval.sign": Approvals.sign,
  "report.run": Reports.run,
  "world.clock.warp": World.clockWarp,
  "record.export": Record.exportRecord,
  "world.snapshot.save": World.snapshotSave,
  "world.snapshot.restore": World.snapshotRestore,
  "world.show": World.show,
} as const satisfies { readonly [name: string]: Operation };

export type OperationName = keyof typeof operations;

/**
 * Served by the platform's world service (`packages/world`): what must work while a world is parked or before it
 * exists. Its caller is an operator. `PlatformRpcs.toLayer` does not compile until each has a handler.
 */
export class PlatformRpcs extends RpcGroup.make(
  World.create.rpc,
  World.show.rpc,
  World.snapshotSave.rpc,
  World.snapshotRestore.rpc,
)
  .middleware(Telemetry)
  .middleware(PlatformSignIn) {}

/**
 * Served by a world's Core, through the world's door: everything that acts inside one running world. Its caller is
 * the world's owner or a person of the world. `WorldRpcs.toLayer` does not compile until each has a handler.
 */
export class WorldRpcs extends RpcGroup.make(
  Organizations.create.rpc,
  Organizations.memberGrant.rpc,
  Documents.create.rpc,
  Documents.submit.rpc,
  Approvals.sign.rpc,
  Reports.run.rpc,
  World.clockWarp.rpc,
  Record.exportRecord.rpc,
)
  .middleware(Telemetry)
  .middleware(WorldSignIn) {}

/** Which server serves an operation, read from the two groups above. */
export const servedBy = (name: OperationName): "platform" | "world" =>
  PlatformRpcs.requests.has(name) ? "platform" : "world";

export * from "./telemetry.ts";
export {
  declare,
  declareOutcomes,
  eventNamesOf,
  isRefusal,
  outcome,
  refusalsOf,
  type Budget,
  type EventClass,
  type EventOf,
  type Expected,
  type Operation,
} from "./operation.ts";
export * as Errors from "./errors.ts";
export * as Values from "./values.ts";
export { startingWorlds, type StartingWorld } from "./starting-worlds.ts";
export { allClaims } from "./claims/all.ts";
export type { Claim, ClaimsOf } from "./claims/claim.ts";
export { Approvals, Documents, Organizations, Record, Reports, World };
