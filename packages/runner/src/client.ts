// The scenarios' `Capxul` for one stage: the SDK's client (`Sdk.layer(Capxul)`) at the stage's two doors, with
// every call recorded for the checks. Each call runs in a root span of its own, so the SDK's caller-side span and
// Core's server spans share one trace id, which the SDK sends in `traceparent`. The log keeps what was sent, what
// came back, the caller's time and how the call ended. During a stage's warm-up, and only then, a call Cloudflare's
// edge answered is sent again (world/warmup.ts). With `via` `cli` (`--via=cli`), every operation goes through the
// command line instead: the `capxul` command that makes the call, run in this process at the same doors, with the
// same credentials and the same HTTP client (packages/cli, `callVia`). The chain reads, which are not operations and
// have no command, still go through the SDK.
import { CHAIN_PATH, Errors, isRefusal, operations, WORLD_PATH, type OperationName } from "@capxul/blueprint";
import * as Cli from "@capxul/cli";
import { CallTraces, Capxul, type CallOptions, type CapxulClient } from "@capxul/scenarios";
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
 * `rejected`, its payload was not of its schema, so the caller's client never sent it (`PayloadRejected`); `defect`,
 * the server died in the call or answered something undeclared; `unanswered`, no answer came back.
 */
export const CallOutcome = Schema.Literals(["success", "refusal", "rejected", "defect", "unanswered"]);
export type CallOutcome = typeof CallOutcome.Type;

/** One call, as the caller saw it. */
export interface Call {
  readonly operation: OperationName;
  readonly traceId: string;
  /** Another world's door the call went to (`CallOptions.at`); null for the stage's own. */
  readonly at: string | null;
  readonly outcome: CallOutcome;
  /** The refusal's tag, for a refused call. */
  readonly refusal: string | null;
  /** The person the call acted as (`CallOptions.as`), and the operator whose credential signed it. */
  readonly as?: string | null;
  readonly operator?: "first" | "second";
  readonly payload: unknown;
  /** What came back, for a call that succeeded. The `events` check computes what each event must carry from it. */
  readonly success: Option.Option<unknown>;
  /** The refusal itself, for a refused call: a starting world's maker hands it on as the call's answer. */
  readonly error?: Option.Option<unknown>;
  /** The caller's time for the call, network included: from the call to its answer decoded. */
  readonly callerMs: number;
  /** Sends repeated during the call because the stage's address was not routed yet. */
  readonly resent: number;
  readonly failure: string | null;
}

const isNotSignedIn = Schema.is(Errors.NotSignedIn);
const isPayloadRejected = Schema.is(Errors.PayloadRejected);
/** No answer came back: the transport failed, or the answer was not the Rpc protocol. The SDK dies with it. */
const isUnanswered = Schema.is(RpcClientError);
const tagOf = (error: unknown): string | null =>
  Predicate.hasProperty(error, "_tag") && Predicate.isString(error._tag) ? error._tag : null;

const classify = (operation: OperationName, exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return { outcome: "success", refusal: null } as const;
  const error = Cause.findErrorOption(exit.cause);
  if (Option.isSome(error) && isPayloadRejected(error.value))
    return { outcome: "rejected", refusal: "PayloadRejected" } as const;
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
  /** Where the world's Core answers: its world group, its chain and, for a stage, its platform group. */
  readonly url: string;
  /** Where the platform group answers: a stage's own Core, or the platform this process serves (worlds/platform.ts). */
  readonly platformUrl: string;
  readonly doorToken: Redacted.Redacted;
  readonly platformToken: Redacted.Redacted;
  /** The second operator's platform token, when the run has one. */
  readonly secondPlatformToken: Redacted.Redacted | null;
  readonly warmUntil: number;
  readonly every: Duration.Duration;
}

/** How a journey's calls reach Core: through the SDK's client, or through the command line (settings.ts). */
export type Via = "sdk" | "cli";

/** One operation's call, by its name, as a transport makes it. */
type Send = (
  name: OperationName,
  payload: unknown,
  options?: CallOptions,
) => Effect.Effect<Sdk.Success<OperationName>, Sdk.Refusal<OperationName>>;

/** Every call through `send`, appended to `log`, whatever its outcome, and answered unchanged; `chain` as it is. */
const recording = (
  send: Send,
  chain: CapxulClient["chain"],
  log: Ref.Ref<ReadonlyArray<Call>>,
  resent: Ref.Ref<number>,
): CapxulClient => {
  const each = (name: OperationName) => (payload: unknown, options?: CallOptions) =>
    Effect.gen(function* () {
      const span = yield* Effect.orDie(Effect.currentSpan);
      const before = yield* Ref.get(resent);
      const [took, exit] = yield* send(name, payload, options).pipe(Effect.exit, Effect.timed);
      const call: Call = {
        operation: name,
        traceId: span.traceId,
        at: options?.at ?? null,
        ...classify(name, exit),
        as: options?.as ?? null,
        operator: options?.operator ?? "first",
        payload,
        success: Exit.isSuccess(exit) ? Option.some(exit.value) : Option.none(),
        error: Exit.isSuccess(exit) ? Option.none() : Cause.findErrorOption(exit.cause),
        callerMs: Duration.toMillis(took),
        resent: (yield* Ref.get(resent)) - before,
        failure: failureOf(exit),
      };
      yield* Ref.update(log, (calls) => [...calls, call]);
      // The try that made the call hears its trace, so its checks judge only what this call caused (roadmap 4.11).
      const traces = yield* Effect.serviceOption(CallTraces);
      if (Option.isSome(traces)) yield* traces.value.heard(span.traceId);
      return yield* exit;
    }).pipe(Effect.withSpan(`runner.call ${name}`, { root: true }));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one function per operation, built by name from the blueprint's own list, each the recorded call of the operation it is keyed by; the compiler cannot follow the mapping
  const calls = Rec.map(operations, (_operation, name) => each(name)) as unknown as Omit<CapxulClient, "chain">;
  // Chain reads are not operations: no span of Core's, no event, nothing for the generic checks. They pass through.
  return { ...calls, chain };
};

/** The stage's doors as the command line reads them from its environment (packages/cli, `Doors`). */
const cliDoors = (target: Target): Cli.Doors => ({
  platform: { url: target.platformUrl, token: target.platformToken },
  world: { url: `${target.url}${WORLD_PATH}`, token: target.doorToken },
  secondOperator: target.secondPlatformToken,
});

/**
 * The stage's two doors, its chain and whatever else a call reaches (another operator, another world's door), all
 * through `http`.
 */
const doors = (target: Target, http: HttpClient.HttpClient) =>
  Layer.mergeAll(
    Sdk.platformDoor({ url: target.platformUrl, token: target.platformToken }),
    Sdk.worldDoor({ url: `${target.url}${WORLD_PATH}`, token: target.doorToken }),
    Sdk.reach({
      platform: target.platformUrl,
      chain: { url: `${target.url}${CHAIN_PATH}`, token: target.doorToken },
      operators: { first: target.platformToken, second: target.secondPlatformToken },
    }),
  ).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, http)));

/**
 * `Capxul` for one stage, every call recorded in `log`, through the SDK or the command line (`via`). Both send
 * through an HTTP client that resends what the edge answered during the warm-up.
 */
export const capxulFor = (
  target: Target,
  log: Ref.Ref<ReadonlyArray<Call>>,
  via: Via = "sdk",
): Layer.Layer<Capxul, never, HttpClient.HttpClient> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const resent = yield* Ref.make(0);
      const http = resendingWhileWarm(target.warmUntil, target.every, resent)(yield* HttpClient.HttpClient);
      const viaCli = Cli.callVia(cliDoors(target));
      const sendOf = (client: CapxulClient): Send =>
        via === "cli"
          ? (name, payload, options) =>
              Effect.provideService(viaCli(name, payload, options), HttpClient.HttpClient, http)
          : (name, payload, options) => Sdk.callByName(client, name, payload, options);
      return Layer.effect(
        Capxul,
        Effect.map(Effect.service(Capxul), (client) => recording(sendOf(client), client.chain, log, resent)),
      ).pipe(Layer.provide(Sdk.layer(Capxul)), Layer.provide(doors(target, http)));
    }),
  );
