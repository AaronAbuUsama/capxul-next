// The contract's one door: every operation of the blueprint with its declaration, and the two Rpc groups that
// serve them, gathered from the domains (src/domains.ts). Nothing in this package imports infrastructure or an
// implementation.
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { domains } from "./domains.ts";
import { gather } from "./gather.ts";
import type { Operation } from "./operation.ts";
import { PlatformSignIn, Telemetry, WorldSignIn } from "./telemetry.ts";

const every = Rec.values(domains);

/** Every operation, by name, domain by domain. The generic runner looks a call up here. */
export const operations = gather(every, "operations") satisfies { readonly [name: string]: Operation };

export type OperationName = keyof typeof operations;

/**
 * Served by the platform's world service (`packages/world`): what must work while a world is parked or before it
 * exists. Its caller is an operator. `PlatformRpcs.toLayer` does not compile until each has a handler.
 */
export class PlatformRpcs extends RpcGroup.make()
  .merge(...Arr.map(every, (domain) => domain.platformRpcs))
  .middleware(Telemetry)
  .middleware(PlatformSignIn) {}

/**
 * Served by a world's Core, through the world's door: everything that acts inside one running world. Its caller is
 * the world's owner or a person of the world. `WorldRpcs.toLayer` does not compile until each has a handler.
 */
export class WorldRpcs extends RpcGroup.make()
  .merge(...Arr.map(every, (domain) => domain.worldRpcs))
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
export { holdsFactsOf, startingWorlds, type Step, type StartingWorld } from "./starting-worlds.ts";
export { MadeCall } from "./starting/facts.ts";
export * as Chain from "./chain/chain.ts";
export * as Site from "./documents/site.ts";
export { allClaims } from "./claims/all.ts";
export type { Claim, ClaimsOf } from "./claims/claim.ts";
export { Approvals, Board, Budgets, Documents, Organizations, People, Record, Reports, World, domains } from "./domains.ts";
