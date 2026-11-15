// The runner's recording client tells a try that provides `CallTraces` the trace id of each call it records (roadmap
// 4.11): the same trace as the call's record, so the try's checks judge only what that call caused. A call made where
// no try provides it is recorded as before. Against a door served in this process (the SDK's TestDoor).
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { test } from "node:test";
import { CallTraces, Capxul } from "@capxul/scenarios";
import * as Sdk from "@capxul/sdk";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { capxulFor, type Call, type Target } from "../src/client.ts";

const TOKEN = "runner-door-token";
const payload = { world: Sdk.TestDoor.WORLD };

/** Calls `world.show` twice through the runner's client: once with `CallTraces` provided, once without. */
const calls = (urls: { readonly platform: string; readonly world: string }) =>
  Effect.gen(function* () {
    const target: Target = {
      url: Str.replace(Sdk.TestDoor.WORLD_PATH, "")(urls.world),
      platformUrl: urls.platform,
      doorToken: Redacted.make(TOKEN),
      platformToken: Redacted.make(TOKEN),
      secondPlatformToken: Redacted.make("second-operator-token"),
      warmUntil: 0,
      every: Duration.millis(10),
    };
    const log = yield* Ref.make<ReadonlyArray<Call>>([]);
    const heard = yield* Ref.make<ReadonlyArray<string>>([]);
    yield* Effect.gen(function* () {
      const capxul = yield* Capxul;
      yield* capxul["world.show"](payload).pipe(
        Effect.provideService(CallTraces, { heard: (trace) => Ref.update(heard, (all) => [...all, trace]) }),
      );
      yield* capxul["world.show"](payload);
    }).pipe(Effect.provide(capxulFor(target, log).pipe(Layer.provide(FetchHttpClient.layer))));
    return { log: yield* Ref.get(log), heard: yield* Ref.get(heard) };
  });

test("a try that provides CallTraces hears the trace of the call the runner recorded, and only of its own", () =>
  Effect.runPromise(
    Effect.flatMap(Sdk.TestDoor.urls, calls).pipe(
      Effect.provide(
        Sdk.TestDoor.serve({ token: TOKEN, answer: "examples" }).pipe(
          Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0, host: "127.0.0.1" })),
        ),
      ),
      Effect.map(({ log, heard }) => {
        assert.equal(log.length, 2, "both calls were recorded");
        assert.equal(log[0]?.outcome, "success");
        assert.deepStrictEqual(heard, [log[0]?.traceId], "the first call's trace, heard once; the second's not heard");
        assert.notEqual(log[0]?.traceId, log[1]?.traceId, "each call has a trace of its own");
      }),
    ),
  ));
