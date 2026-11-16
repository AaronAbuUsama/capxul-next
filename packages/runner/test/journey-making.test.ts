// Each journey reads its own making calls (worlds/making.ts, `JourneyMaking`; roadmap 4.8): two starting worlds made at
// the same time, each for a journey of its own, land each in its own journey's log, and both in the run's `made`.
// Against a door served in this process (the SDK's TestDoor).
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { test } from "node:test";
import { startingWorlds } from "@capxul/blueprint";
import { Capxul } from "@capxul/scenarios";
import * as Sdk from "@capxul/sdk";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Order from "effect/Order";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type { Target } from "../src/client.ts";
import { JourneyMaking, recorder, type MakingCall } from "../src/worlds/making.ts";

const TOKEN = "runner-door-token";
const nothing = { facts: { calls: [] }, own: null };

/** Steps that call `world.show` `times` times. */
const shows = (times: number) => () =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    for (let i = 0; i < times; i += 1) yield* capxul["world.show"]({ world: Sdk.TestDoor.WORLD });
    return nothing;
  }).pipe(Effect.orDie);

const traces = (calls: ReadonlyArray<MakingCall>) => Arr.map(calls, (each) => each.call.traceId);

const makings = (urls: { readonly platform: string; readonly world: string }) =>
  Effect.gen(function* () {
    const target: Target = {
      url: Str.replace(Sdk.TestDoor.WORLD_PATH, "")(urls.world),
      platformUrl: urls.platform,
      doorToken: Redacted.make(TOKEN),
      platformToken: Redacted.make(TOKEN),
      secondPlatformToken: null,
      warmUntil: 0,
      every: Duration.millis(10),
    };
    const made = yield* Ref.make<ReadonlyArray<MakingCall>>([]);
    const run = recorder(target, made);
    const [one, two] = yield* Effect.forEach(
      [1, 3],
      (times) =>
        Effect.gen(function* () {
          const calls = yield* Ref.make<ReadonlyArray<MakingCall>>([]);
          yield* run(startingWorlds.fresh, shows(times), nothing).pipe(Effect.provideService(JourneyMaking, { calls }));
          return yield* Ref.get(calls);
        }),
      { concurrency: "unbounded" },
    );
    return { one: one ?? [], two: two ?? [], made: yield* Ref.get(made) };
  }).pipe(Effect.provide(FetchHttpClient.layer));

test("two makings at once each land in their own journey's log, and both in the run's", () =>
  Effect.runPromise(
    Effect.flatMap(Sdk.TestDoor.urls, makings).pipe(
      Effect.provide(
        Sdk.TestDoor.serve({ token: TOKEN, answer: "examples" }).pipe(
          Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0, host: "127.0.0.1" })),
        ),
      ),
      Effect.map(({ one, two, made }) => {
        assert.equal(one.length, 1, "the first journey's one call");
        assert.equal(two.length, 3, "the second journey's three calls");
        assert.ok(
          Arr.every(traces(one), (trace) => !Arr.contains(traces(two), trace)),
          "no call is in both journeys' logs",
        );
        assert.deepStrictEqual(
          Arr.sort(traces(made), Order.String),
          Arr.sort([...traces(one), ...traces(two)], Order.String),
          "the run's has all",
        );
      }),
    ),
  ));
