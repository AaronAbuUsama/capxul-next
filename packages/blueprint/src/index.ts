// The blueprint's one door: every operation with its declaration, and the two Rpc groups that serve them, gathered
// from the generated indexes (src/generated/, written by `pnpm generate` from the thing folders); the pipeline's own
// work, which no Rpc group holds; and the telemetry vocabulary (src/telemetry/). Nothing in this package imports
// infrastructure or an implementation; the language its declarations are written in is the toolkit's,
// `@capxul/blueprint-tools`, and re-exported here where callers use it.
import { gather, namesOf, type Operation } from "@capxul/blueprint-tools";
import * as Arr from "effect/Array";
import * as Rec from "effect/Record";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { domains } from "./generated/domains.ts";
import * as Errors from "./generated/refusals.ts";
import { PlatformSignIn, WorldSignIn } from "./protocol/sign-in.ts";
import { Telemetry } from "./protocol/trace.ts";
import { startingWorlds } from "./starting-points/points.ts";

const every = Rec.values(domains);

/** Every operation, by name, domain by domain. The generic runner looks a call up here. */
export const operations = gather(every, "operations") satisfies { readonly [name: string]: Operation };

export type OperationName = keyof typeof operations;

/** Every machine (a thing's lifecycle), by name, domain by domain: each lifecycle callers see and refusals depend on. */
export const machines = gather(every, "machines");

/**
 * Every name the blueprint declares: operations, refusals, events, outcomes and starting worlds. The lint rule
 * capxul/declared-names refuses each of them written as a string outside the blueprint.
 */
export const declaredNames: ReadonlySet<string> = namesOf(operations, Errors.refusals, startingWorlds);

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

export * from "./protocol/paths.ts";
export * from "./protocol/trace.ts";
export * from "./protocol/headers.ts";
export * from "./protocol/sign-in.ts";
export {
  verb,
  eventNamesOf,
  holdsFactsOf,
  isRefusal,
  Machine,
  outcome,
  refusalsOf,
  type Budget,
  type EventClass,
  type EventOf,
  type Expected,
  type Operation,
} from "@capxul/blueprint-tools";
export * as Errors from "./generated/refusals.ts";
export * as Values from "./generated/values.ts";
export { startingWorlds, type Claim, type ClaimsOf, type Step, type StartingWorld } from "./starting-points/points.ts";
export { MadeCall } from "./starting-points/facts.ts";
export * as Cast from "./starting-points/cast.ts";
export * as Chain from "./common/chain/chain.ts";
export * as Site from "./common/site.ts";
export { allClaims } from "./generated/promises.ts";
export { glossary } from "./glossary.ts";
/** Who may call an operation (roadmap item 5.1): each role, declared once. */
export { roles } from "./common/values.ts";
export { ratchets, unmigrated, type Counter, type Ratchet } from "./ratchets.ts";

/**
 * The refusals no handler decides, so no log is written where they are decided: a payload its operation's schema
 * rejects (the caller's own client refuses it) and an operation not switched on yet.
 */
export const undecided = [Errors.PayloadRejected, Errors.NotImplemented] as const;
/**
 * The pipeline's own work (docs/design/blueprint.md, part 8): every verb no door serves, with its spans, logs, budget
 * and payload. No Rpc group above holds any of it.
 */
export * as Pipeline from "./generated/pipeline.ts";
/** The telemetry vocabulary (docs/design/blueprint.md, part 10), one namespace per file of src/telemetry/. */
export * as Conventions from "./telemetry/conventions.ts";
export * as Envelope from "./telemetry/envelope.ts";
export * as Producers from "./telemetry/producers.ts";
export * as StepKinds from "./telemetry/step-kinds.ts";
export * as Metrics from "./telemetry/metrics.ts";
export * as Datasets from "./telemetry/datasets.ts";
export * as Watch from "./telemetry/watch.ts";
export {
  Approvals,
  Board,
  Budgets,
  Documents,
  Organizations,
  People,
  Record,
  Reports,
  World,
  domains,
} from "./generated/domains.ts";
