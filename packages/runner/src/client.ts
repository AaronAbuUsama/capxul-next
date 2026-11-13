// The runner's client of Core: the blueprint's Rpc groups over HTTP, every call sent under its own trace id and kept
// in a log, with what was sent and what came back, so the generic checks can compare it with what Core kept. During
// a stage's warm-up, and only then, a call Cloudflare's edge answered is sent again (world/warmup.ts). It supplies
// the scenarios' `Capxul` until the SDK does (roadmap step 1.9).
import { Errors, isRefusal, operations, PERSON_HEADER, TRACE_HEADER, type OperationName } from "@capxul/blueprint";
import { CoreRpcs } from "@capxul/core";
import { Capxul, type CallOptions, type CapxulClient, type Failure } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Formatter from "effect/Formatter";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Random from "effect/Random";
import * as Rec from "effect/Record";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as HttpClient from "effect/http/HttpClient";
import * as RpcClient from "effect/rpc/RpcClient";
import { RpcClientError } from "effect/rpc/RpcClientError";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
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
  /** The caller's time for the call, network included: from the send to the answer decoded. */
  readonly callerMs: number;
  /** Sends repeated during the call because the stage's address was not routed yet. */
  readonly resent: number;
  readonly failure: string | null;
}

/** 32 hex digits, a W3C trace id: the name of exactly one call. */
export const traceId: Effect.Effect<string> = Effect.map(
  Effect.all(Arr.makeBy(32, () => Random.nextIntBetween(0, 15))),
  (digits) =>
    Arr.join(
      Arr.map(digits, (digit) => digit.toString(16)),
      "",
    ),
);

const isNotSignedIn = Schema.is(Errors.NotSignedIn);
/** No answer came back: the transport failed, or the answer was not the Rpc protocol. */
const isUnanswered = Schema.is(RpcClientError);
const tagOf = (error: unknown): string | null =>
  Predicate.hasProperty(error, "_tag") && Predicate.isString(error._tag) ? error._tag : null;

const classify = (operation: OperationName, exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return { outcome: "success", refusal: null } as const;
  const error = Cause.findErrorOption(exit.cause);
  if (Option.isNone(error)) return { outcome: "defect", refusal: null } as const;
  if (isRefusal(operations[operation], error.value) || isNotSignedIn(error.value))
    return { outcome: "refusal", refusal: tagOf(error.value) } as const;
  return isUnanswered(error.value)
    ? ({ outcome: "unanswered", refusal: null } as const)
    : ({ outcome: "defect", refusal: null } as const);
};

/** How a call that did not succeed failed, in words: a typed refusal with every field it carries, else the cause. */
const failureOf = (exit: Exit.Exit<unknown, unknown>): string | null => {
  if (Exit.isSuccess(exit)) return null;
  const error = Cause.findErrorOption(exit.cause);
  return Option.isSome(error) && Predicate.isObject(error.value) && Predicate.hasProperty(error.value, "_tag")
    ? Formatter.format({ ...error.value })
    : describe(exit.cause);
};

/** Sends one call by name. The blueprint's own types are put back by `CapxulClient`. */
export type Send = (
  operation: OperationName,
  payload: unknown,
  options?: CallOptions,
) => Effect.Effect<unknown, Failure | RpcClientError>;

/** What the client needs of a stage: where its Core answers, and when its warm-up ends. */
export interface Target {
  readonly url: string;
  readonly warmUntil: number;
  readonly every: Duration.Duration;
}

/** Every call made through `send` is appended to `log`, whatever its outcome, and returned unchanged. */
export const sender = (target: Target, log: Ref.Ref<ReadonlyArray<Call>>) =>
  Effect.gen(function* () {
    const resent = yield* Ref.make(0);
    const client = yield* RpcClient.make(CoreRpcs, { flatten: true }).pipe(
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- one client per stage: its protocol is that stage's address
      Effect.provide(
        RpcClient.layerProtocolHttp({
          url: target.url,
          transformClient: resendingWhileWarm(target.warmUntil, target.every, resent),
        }).pipe(Layer.provide(RpcSerialization.layerJson)),
      ),
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the flat client is called by name for any operation; `CapxulClient` restores each operation's own types
    const untyped = client as unknown as (
      tag: string,
      payload: unknown,
      options: object,
    ) => Effect.Effect<unknown, Failure | RpcClientError>;
    const send: Send = (operation, payload, options) =>
      Effect.gen(function* () {
        const id = yield* traceId;
        const parent = Arr.join(Arr.take(Arr.fromIterable(yield* traceId), 16), "");
        const person = options?.as === undefined ? {} : { [PERSON_HEADER]: options.as };
        const headers = { [TRACE_HEADER]: `00-${id}-${parent}-01`, ...person };
        const before = yield* Ref.get(resent);
        const [took, exit] = yield* untyped(operation, payload, { headers }).pipe(Effect.exit, Effect.timed);
        const call: Call = {
          operation,
          traceId: id,
          ...classify(operation, exit),
          payload,
          success: Exit.isSuccess(exit) ? Option.some(exit.value) : Option.none(),
          callerMs: Duration.toMillis(took),
          resent: (yield* Ref.get(resent)) - before,
          failure: failureOf(exit),
        };
        yield* Ref.update(log, (calls) => Arr.append(calls, call));
        return yield* exit;
      });
    return send;
  });

/**
 * The scenarios' `Capxul` for one stage. A call that got no answer is a defect to the scenario (its interface has
 * no transport failure); the log still records it as unanswered.
 */
export const capxulFor = (
  target: Target,
  log: Ref.Ref<ReadonlyArray<Call>>,
): Layer.Layer<Capxul, never, HttpClient.HttpClient> =>
  Layer.effect(
    Capxul,
    Effect.map(sender(target, log), (send) => {
      const each = (name: OperationName) => (payload: unknown, options?: CallOptions) =>
        send(name, payload, options).pipe(Effect.catchIf(isUnanswered, Effect.die));
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one function per operation, built by name from the blueprint's own list; the compiler cannot follow the mapping
      return Rec.map(operations, (_operation, name) => each(name)) as unknown as CapxulClient;
    }),
  );
