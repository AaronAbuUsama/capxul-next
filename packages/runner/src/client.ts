// The scenarios' `Capxul` for one stage: the SDK's client (`Sdk.layer(Capxul)`) at the stage's two doors, with
// every call recorded for the checks. Each call runs in a root span of its own, so the SDK's caller-side span and
// Core's server spans share one trace id, which the SDK sends in `traceparent`. The log keeps what was sent, what
// came back, the caller's time and how the call ended. During a stage's warm-up, and only then, a call Cloudflare's
// edge answered is sent again (world/warmup.ts).
import { Errors, isRefusal, operations, type OperationName } from "@capxul/blueprint";
import { PLATFORM_PATH, WORLD_PATH } from "@capxul/core";
import { Capxul, type CallOptions, type CapxulClient } from "@capxul/scenarios";
import * as Sdk from "@capxul/sdk";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import { RpcClientError } from "effect/rpc/RpcClientError";
import { describe } from "./failure.ts";
import { resendingWhileWarm } from "./world/warmup.ts";

/**
 * How a call ended, as the caller saw it: `success`; `refusal`, a typed refusal the operation or sign-in declares;
 * `defect`, the server died in the call or answered something undeclared; `unanswered`, no answer came back.
 */
export const CallOutcome = Schema.Literals(["success", "refusal", "defect", "unanswered"]);
export type CallOutcome = typeof CallOutcome.Type;

/** One call, as the caller saw it. */
export interface Call {
  readonly operation: OperationName;
  readonly traceId: string;
  readonly outcome: CallOutcome;
  /** The refusal's tag, for a refused call. */
  readonly refusal: string | null;
  readonly payload: unknown;
  /** What came back, for a call that succeeded. The `events` check computes what each event must carry from it. */
  readonly success: Option.Option<unknown>;
  /** The caller's time for the call, network included: from the call to its answer decoded. */
  readonly callerMs: number;
  /** Sends repeated during the call because the stage's address was not routed yet. */
  readonly resent: number;
  readonly failure: string | null;
}

const isNotSignedIn = Schema.is(Errors.NotSignedIn);
/** No answer came back: the transport failed, or the answer was not the Rpc protocol. The SDK dies with it. */
const isUnanswered = Schema.is(RpcClientError);
const tagOf = (error: unknown): string | null =>
  Predicate.hasProperty(error, "_tag") && Predicate.isString(error._tag) ? error._tag : null;

const classify = (operation: OperationName, exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return { outcome: "success", refusal: null } as const;
  const error = Cause.findErrorOption(exit.cause);
  if (Option.isSome(error))
    return isRefusal(operations[operation], error.value) || isNotSignedIn(error.value)
      ? ({ outcome: "refusal", refusal: tagOf(error.value) } as const)
      : ({ outcome: "defect", refusal: null } as const);
  const died = Cause.findDefect(exit.cause);
  return Result.isSuccess(died) && isUnanswered(died.success)
    ? ({ outcome: "unanswered", refusal: null } as const)
    : ({ outcome: "defect", refusal: null } as const);
};

/** How a call that did not succeed failed, in words (failure.ts). */
const failureOf = (exit: Exit.Exit<unknown, unknown>): string | null =>
  Exit.isSuccess(exit) ? null : describe(exit.cause);

/** What the client needs of a stage: where its Core answers, the doors' tokens, and when its warm-up ends. */
export interface Target {
  readonly url: string;
  readonly doorToken: Redacted.Redacted;
  readonly platformToken: Redacted.Redacted;
  readonly warmUntil: number;
  readonly every: Duration.Duration;
}

/** `client` with every call appended to `log`, whatever its outcome, and answered unchanged. */
const recording = (client: CapxulClient, log: Ref.Ref<ReadonlyArray<Call>>, resent: Ref.Ref<number>): CapxulClient => {
  const each = (name: OperationName) => (payload: unknown, options?: CallOptions) =>
    Effect.gen(function* () {
      const span = yield* Effect.orDie(Effect.currentSpan);
      const before = yield* Ref.get(resent);
      const [took, exit] = yield* Sdk.callByName(client, name, payload, options).pipe(Effect.exit, Effect.timed);
      const call: Call = {
        operation: name,
        traceId: span.traceId,
        ...classify(name, exit),
        payload,
        success: Exit.isSuccess(exit) ? Option.some(exit.value) : Option.none(),
        callerMs: Duration.toMillis(took),
        resent: (yield* Ref.get(resent)) - before,
        failure: failureOf(exit),
      };
      yield* Ref.update(log, (calls) => [...calls, call]);
      return yield* exit;
    }).pipe(Effect.withSpan(`runner.call ${name}`, { root: true }));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one function per operation, built by name from the blueprint's own list, each the recorded call of the operation it is keyed by; the compiler cannot follow the mapping
  return Rec.map(operations, (_operation, name) => each(name)) as unknown as CapxulClient;
};

/** The stage's two doors, reached through an HTTP client that resends what the edge answered during the warm-up. */
const doors = (target: Target, resent: Ref.Ref<number>) =>
  Layer.merge(
    Sdk.platformDoor({ url: `${target.url}${PLATFORM_PATH}`, token: target.platformToken }),
    Sdk.worldDoor({ url: `${target.url}${WORLD_PATH}`, token: target.doorToken }),
  ).pipe(
    Layer.provide(
      Layer.effect(
        HttpClient.HttpClient,
        Effect.map(Effect.service(HttpClient.HttpClient), (client) =>
          resendingWhileWarm(target.warmUntil, target.every, resent)(client),
        ),
      ),
    ),
  );

/** `Capxul` for one stage, every call recorded in `log`. */
export const capxulFor = (
  target: Target,
  log: Ref.Ref<ReadonlyArray<Call>>,
): Layer.Layer<Capxul, never, HttpClient.HttpClient> =>
  Layer.unwrap(
    Effect.map(Ref.make(0), (resent) =>
      Layer.effect(
        Capxul,
        Effect.map(Effect.service(Capxul), (client) => recording(client, log, resent)),
      ).pipe(Layer.provide(Sdk.layer(Capxul)), Layer.provide(doors(target, resent))),
    ),
  );
