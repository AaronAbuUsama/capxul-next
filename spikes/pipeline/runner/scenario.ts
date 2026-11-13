// What a scenario is, and the two things it is handed: a typed client of Core derived from the contract, and a
// source of trace ids. A scenario holds no check of events, spans or speed: the runner applies those to every call.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Rpc from "effect/rpc/Rpc";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import type { OperationName, operations } from "../contract/door.ts";

type RpcOf<Name extends OperationName> = (typeof operations)[Name]["rpc"];

/**
 * One function per operation in the contract, named as the contract names it. A call fails with the operation's
 * typed refusals, or with `RpcClientError` when the call never got an answer; a server defect comes back as a defect.
 * Every call is sent under its own trace id: the next one from `TraceIds`, or the one given in `traceId`.
 */
export type CoreClient = {
  readonly [Name in OperationName]: (
    payload: Rpc.PayloadConstructor<RpcOf<Name>>,
    options?: { readonly traceId?: string },
  ) => Effect.Effect<Rpc.Success<RpcOf<Name>>, Rpc.Error<RpcOf<Name>> | RpcClientError>;
};

/** The world's Core, through its door. */
export class Core extends Context.Service<Core, CoreClient>()("capxul/runner/Core") {}

/** Fresh trace ids (32 hex characters). A trace id names exactly one call. */
export class TraceIds extends Context.Service<TraceIds, { readonly next: Effect.Effect<string> }>()("capxul/runner/TraceIds") {}

/** What a scenario fails with when the world did not behave as the acceptance claim says. */
export class ExpectationFailed extends Schema.TaggedError<ExpectationFailed>()("ExpectationFailed", {
  message: Schema.String,
}) {}

/** Fails the scenario with `message` unless `holds`. */
export const expect = (holds: boolean, message: string): Effect.Effect<void, ExpectationFailed> =>
  holds ? Effect.void : Effect.fail(new ExpectationFailed({ message }));

export interface Scenario {
  /** Unique among the scenarios of one run; it names the run record. */
  readonly name: string;
  /** Runs against one fresh world. Any failure or defect fails the scenario. */
  readonly run: Effect.Effect<void, unknown, Core | TraceIds>;
}

/** A scenario file's default export. */
export const scenario = (name: string, run: Scenario["run"]): Scenario => ({ name, run });

export const isScenario = (value: unknown): value is Scenario =>
  typeof value === "object" && value !== null && "name" in value && typeof value.name === "string" && "run" in value && Effect.isEffect(value.run);
