// The client a scenario is handed. It is derived from the contract's Rpc group, sends every call under its own
// trace id in the contract's trace header, and keeps a log of every call (with what was sent and what came back) so
// the generic checks can find what the server kept about each one and compare it. During the world's warm-up, and
// only then, it sends a call again when Cloudflare's edge answered it instead of the Worker (warmup.ts).
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
import { resendingWhileWarm } from "./warmup.ts";

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
  /** What the caller sent. */
  readonly payload: unknown;
  /** What came back, when the call succeeded. The generic `events` check computes what each event must carry from both. */
  readonly success: Option.Option<unknown>;
  /** How long the call took from the caller's side, network included. */
  readonly ms: number;
  /**
   * How many times a send was repeated while this call was under way, because Cloudflare's edge answered instead
   * of the Worker during the world's warm-up (warmup.ts). Nothing is resent once the warm-up is over.
   */
  readonly resent: number;
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

/** What the client needs to know of a world: where its Core answers, and when its warm-up ends. */
export interface Target {
  readonly url: string;
  /** Epoch milliseconds. Until then, a call Cloudflare's edge answered is sent again, `every` apart. */
  readonly warmUntil: number;
  readonly every: Duration.Duration;
}

/**
 * `Core` and `TraceIds` for one world. Every call made through this `Core` is appended to `log`, whatever its
 * outcome, and then returned to the scenario unchanged.
 */
export const coreOf = (target: Target, log: Ref.Ref<ReadonlyArray<Call>>): Layer.Layer<Core | TraceIds, never, HttpClient.HttpClient> =>
  Layer.unwrap(
    Effect.gen(function* () {
      // One count for the world: a call's share is what was added while it was under way.
      const resent = yield* Ref.make(0);
      const core = Effect.gen(function* () {
        const traces = yield* TraceIds;
        const send = (yield* RpcClient.make(CoreRpcs, { flatten: true })) as unknown as Send;
        const call = (operation: OperationName) => (payload: unknown, options?: { readonly traceId?: string }) =>
          Effect.gen(function* () {
            const traceId = options?.traceId ?? (yield* traces.next);
            const headers = { [TRACE_HEADER]: `00-${traceId}-${yield* hex(16)}-01` };
            const before = yield* Ref.get(resent);
            const [took, exit] = yield* Effect.timed(Effect.exit(send(operation, payload, { headers })));
            const entry: Call = {
              operation,
              traceId,
              outcome: outcomeOf(operation, exit),
              payload,
              success: Exit.isSuccess(exit) ? Option.some(exit.value) : Option.none(),
              ms: Math.round(Duration.toMillis(took)),
              resent: (yield* Ref.get(resent)) - before,
              failure: Exit.isFailure(exit) ? describe(exit.cause) : null,
            };
            yield* Ref.update(log, (calls) => [...calls, entry]);
            return yield* exit;
          });
        return Object.fromEntries(Object.keys(operations).map((name) => [name, call(name as OperationName)])) as unknown as CoreClient;
      });
      return Layer.effect(Core, core).pipe(
        Layer.provide(RpcClient.layerProtocolHttp({ url: target.url, transformClient: resendingWhileWarm(target.warmUntil, target.every, resent) })),
        Layer.provide(RpcSerialization.layerJson),
        Layer.provideMerge(TraceIdsLive),
      );
    }),
  );
