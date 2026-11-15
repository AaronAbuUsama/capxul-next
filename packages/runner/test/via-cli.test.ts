// The thin line's journeys through the command line (`--via=cli`, src/client.ts) against a door served in this process
// (the SDK's TestDoor), beside the same journeys through the SDK: every call each journey makes is answered the same,
// in the same order, with the same options, and each journey's steps end the same. The door answers every operation
// with its blueprint example or with NotImplemented, not as Core would, so the journeys fail where those answers
// first disagree with them; what is compared is that both transports carry them to the same place, call for call, and
// that every call the door saw through the command line carried the trace of the call the runner recorded, which is
// how the generic checks find Core's spans of it.
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { test } from "node:test";
import { journeys, type Journey } from "@capxul/scenarios";
import * as Sdk from "@capxul/sdk";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import type * as Tracer from "effect/Tracer";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { capxulFor, type Call, type Target, type Via } from "../src/client.ts";
import { givenFor } from "../src/given.ts";
import { hearing, type Heard } from "../src/steps.ts";

const TOKEN = "runner-door-token";

/** The stage the TestDoor is, as the runner's client reaches a stage. */
const targetOf = (urls: { readonly platform: string; readonly world: string }): Target => ({
  url: Str.replace(Sdk.TestDoor.WORLD_PATH, "")(urls.world),
  platformUrl: urls.platform,
  doorToken: Redacted.make(TOKEN),
  platformToken: Redacted.make(TOKEN),
  secondPlatformToken: Redacted.make("second-operator-token"),
  warmUntil: 0,
  every: Duration.millis(10),
});

/** A call as both transports must agree on it: everything but its trace id and its time. */
const shown = (call: Call) => ({
  operation: call.operation,
  at: call.at,
  as: call.as,
  operator: call.operator,
  outcome: call.outcome,
  refusal: call.refusal,
  payload: call.payload,
  success: call.success,
  error: Option.map(call.error ?? Option.none(), (error) => ({ ...Object(error) })),
  failure: call.failure === null ? null : Str.split(call.failure, "\n")[0],
});

const heardOf = (step: Heard) => ({
  step: step.step,
  calls: [step.from, step.to],
  tries: step.tries,
  failure: step.failure,
});

/** The journey run once through `via`, as the runner runs it, every call recorded and every step heard. */
const runThrough = (journey: Journey, target: Target, via: Via) =>
  Effect.gen(function* () {
    const log = yield* Ref.make<ReadonlyArray<Call>>([]);
    const heard = yield* Ref.make<ReadonlyArray<Heard>>([]);
    const open = yield* Ref.make<Option.Option<Tracer.Span>>(Option.none());
    const exit = yield* journey.run.pipe(
      Effect.provide(
        Layer.mergeAll(
          capxulFor(target, log, via, open),
          givenFor(journey.given, { first: Sdk.TestDoor.OPERATOR, second: "runner-2" }, "examples"),
          hearing(heard, log, open),
        ),
      ),
      Random.withSeed(journey.name),
      Effect.timeout("20 seconds"),
      Effect.exit,
    );
    const ended = Exit.isSuccess(exit)
      ? "succeeded"
      : Option.match(Cause.findErrorOption(exit.cause), { onNone: () => "died", onSome: (e) => Object(e)._tag });
    return {
      traces: Arr.map(
        Arr.filter(yield* Ref.get(log), (call) => call.outcome !== "rejected"),
        (call) => call.traceId,
      ),
      run: { ended, calls: Arr.map(yield* Ref.get(log), shown), steps: Arr.map(yield* Ref.get(heard), heardOf) },
    };
  }).pipe(Effect.provide(FetchHttpClient.layer));

const withDoor = <A>(
  answer: Sdk.TestDoor.Answer,
  body: (target: Target) => Effect.Effect<A, never, Sdk.TestDoor.Calls>,
) =>
  Effect.runPromise(
    Effect.flatMap(Sdk.TestDoor.urls, (urls) => body(targetOf(urls))).pipe(
      Effect.provide(
        Sdk.TestDoor.serve({ token: TOKEN, answer }).pipe(
          Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0, host: "127.0.0.1" })),
        ),
      ),
    ),
  );

for (const answer of ["examples", "not-implemented"] as const)
  for (const journey of journeys)
    test(`${journey.name}: through the command line as through the SDK, call for call (${answer})`, () =>
      withDoor(answer, (target) =>
        Effect.gen(function* () {
          const seen = yield* Sdk.TestDoor.Calls;
          const sdk = yield* runThrough(journey, target, "sdk");
          yield* Ref.set(seen, []);
          const cli = yield* runThrough(journey, target, "cli");
          assert.ok(cli.run.calls.length > 0, "the journey made no call");
          assert.ok(cli.run.steps.length > 0, "the journey began no step");
          assert.deepStrictEqual(cli.run, sdk.run);
          const doorSaw = Arr.map(yield* Ref.get(seen), (each) => Str.split(each.traceparent ?? "", "-")[1]);
          assert.deepStrictEqual(doorSaw, cli.traces, "the traces the door saw through the command line");
        }),
      ));
