// The client a scenario is handed. It is derived from the contract's Rpc group, sends every call under its own
// trace id in the contract's trace header, and keeps a log of every call so the generic checks can find what the
// server kept about each one.
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as HttpClient from "effect/http/HttpClient";
import * as RpcClient from "effect/rpc/RpcClient";
import { RpcClientError } from "effect/rpc/RpcClientError";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import { CoreRpcs, isRefusal, operations, TRACE_HEADER, type OperationName } from "../contract/door.ts";
import { describe } from "./failure.ts";
import { Core, TraceIds, type CoreClient } from "./scenario.ts";

/**
 * How a call ended, as the caller saw it: `success`; `refusal`, one of the operation's declared typed errors;
 * `defect`, the server died in the call; `unanswered`, no answer came back at all.
 */
export const CallOutcome = Schema.Literals(["success", "refusal", "defect", "unanswered"]);
export type CallOutcome = typeof CallOutcome.Type;

/** One call a scenario made. */
export interface Call {
  readonly operation: OperationName;
  readonly traceId: string;
  readonly outcome: CallOutcome;
  /** How long the call took from the caller's side, network included. */
  readonly ms: number;
  readonly failure: string | null;
}

const hex = (length: number) =>
  Effect.map(Effect.all(Arr.makeBy(length, () => Random.nextIntBetween(0, 15))), (digits) => digits.map((digit) => digit.toString(16)).join(""));

export const TraceIdsLive = Layer.succeed(TraceIds, { next: hex(32) });

const outcomeOf = (operation: OperationName, exit: Exit.Exit<unknown, unknown>): CallOutcome => {
  if (Exit.isSuccess(exit)) return "success";
  const error = Cause.findErrorOption(exit.cause);
  if (Option.isNone(error)) return "defect";
  if (isRefusal(operations[operation], error.value)) return "refusal";
  return error.value instanceof RpcClientError ? "unanswered" : "defect";
};

/** The Rpc client's untyped face: one function for every operation. `CoreClient` puts the contract's types back. */
type Send = (
  name: OperationName,
  payload: unknown,
  options: { readonly headers: Readonly<Record<string, string>> },
) => Effect.Effect<unknown, unknown>;

/**
 * `Core` and `TraceIds` for one world. Every call made through this `Core` is appended to `log`, whatever its
 * outcome, and then returned to the scenario unchanged.
 */
export const coreOf = (url: string, log: Ref.Ref<ReadonlyArray<Call>>): Layer.Layer<Core | TraceIds, never, HttpClient.HttpClient> =>
  Layer.effect(
    Core,
    Effect.gen(function* () {
      const traces = yield* TraceIds;
      const send = (yield* RpcClient.make(CoreRpcs, { flatten: true })) as unknown as Send;
      const call = (operation: OperationName) => (payload: unknown, options?: { readonly traceId?: string }) =>
        Effect.gen(function* () {
          const traceId = options?.traceId ?? (yield* traces.next);
          const headers = { [TRACE_HEADER]: `00-${traceId}-${yield* hex(16)}-01` };
          const [took, exit] = yield* Effect.timed(Effect.exit(send(operation, payload, { headers })));
          yield* Ref.update(log, (calls) => [
            ...calls,
            {
              operation,
              traceId,
              outcome: outcomeOf(operation, exit),
              ms: Math.round(Duration.toMillis(took)),
              failure: Exit.isFailure(exit) ? describe(exit.cause) : null,
            },
          ]);
          return yield* exit;
        });
      return Object.fromEntries(Object.keys(operations).map((name) => [name, call(name as OperationName)])) as unknown as CoreClient;
    }),
  ).pipe(
    Layer.provide(RpcClient.layerProtocolHttp({ url })),
    Layer.provide(RpcSerialization.layerJson),
    Layer.provideMerge(TraceIdsLive),
  );
