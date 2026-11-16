// An observation read a check makes around the step's call (`Observing` present, `CallTraces` absent) is sent again
// when no answer came back, and the call's record says how many times; the step's own call never is (src/client.ts,
// `sendObserving`). Against a door served in this process (the SDK's TestDoor), the HTTP client failing the first
// requests at the transport, as CI run 43745363818's pre-call `record.export` did.
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { test } from "node:test";
import { CallTraces, Capxul, Observing } from "@capxul/scenarios";
import * as Sdk from "@capxul/sdk";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import { capxulFor, type Call, type Target } from "../src/client.ts";

const TOKEN = "runner-door-token";
const payload = { world: Sdk.TestDoor.WORLD };
type Marked = "observing" | "the step's call" | "unmarked";

/** An HTTP client whose first `failing` requests fail at the transport; every request counted. */
const flaky = (failing: number, sent: Ref.Ref<number>) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.map(HttpClient.HttpClient, (client) =>
      HttpClient.transform(client, (response, request) =>
        Effect.flatMap(
          Ref.updateAndGet(sent, (n) => n + 1),
          (n) =>
            n <= failing
              ? Effect.fail(
                  new HttpClientError.HttpClientError({
                    reason: new HttpClientError.TransportError({ request, description: "connection reset" }),
                  }),
                )
              : response,
        ),
      ),
    ),
  ).pipe(Layer.provide(FetchHttpClient.layer));

/** One `world.show` made as `marked`, its first `failing` sends failing at the transport. */
const showOnce = (urls: { readonly platform: string; readonly world: string }, marked: Marked, failing: number) =>
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
    const log = yield* Ref.make<ReadonlyArray<Call>>([]);
    const sent = yield* Ref.make(0);
    const call = Effect.flatMap(Effect.service(Capxul), (capxul) => capxul["world.show"](payload));
    const observing = Effect.provideService(call, Observing, {});
    const made =
      marked === "observing"
        ? observing
        : marked === "the step's call"
          ? Effect.provideService(observing, CallTraces, { heard: () => Effect.void })
          : call;
    yield* Effect.exit(made).pipe(Effect.provide(capxulFor(target, log).pipe(Layer.provide(flaky(failing, sent)))));
    return { calls: yield* Ref.get(log), sent: yield* Ref.get(sent) };
  });

const withDoor = (marked: Marked, failing: number) =>
  Effect.runPromise(
    Effect.flatMap(Sdk.TestDoor.urls, (urls) => showOnce(urls, marked, failing)).pipe(
      Effect.provide(
        Sdk.TestDoor.serve({ token: TOKEN, answer: "examples" }).pipe(
          Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0, host: "127.0.0.1" })),
        ),
      ),
    ),
  );

test("an observation read with no answer is sent again, and its record says how many times", async () => {
  const { calls, sent } = await withDoor("observing", 2);
  assert.equal(calls.length, 1, "one call recorded");
  assert.equal(calls[0]?.outcome, "success");
  assert.equal(calls[0]?.retried, 2);
  assert.equal(sent, 3);
});

test("an observation read is sent at most its tries, then recorded unanswered", async () => {
  const { calls, sent } = await withDoor("observing", 10);
  assert.equal(calls[0]?.outcome, "unanswered");
  assert.equal(calls[0]?.retried, 3);
  assert.equal(sent, 4);
});

test("the step's own call is never sent again, even inside an observation", async () => {
  const { calls, sent } = await withDoor("the step's call", 1);
  assert.equal(calls[0]?.outcome, "unanswered");
  assert.equal(calls[0]?.retried, undefined);
  assert.equal(sent, 1);
});

test("a call no check marks as an observation is never sent again", async () => {
  const { calls, sent } = await withDoor("unmarked", 1);
  assert.equal(calls[0]?.outcome, "unanswered");
  assert.equal(calls[0]?.retried, undefined);
  assert.equal(sent, 1);
});
