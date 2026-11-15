// Core's two doors, driven by the SDK over HTTP, all in this process: the SDK's client sends each request to Core's
// `serveDoors` as the Worker would receive it. Every operation answers `NotImplemented` at its own door, its server
// span under the trace the SDK sent; a wrong token is refused; another path is a 404 in JSON.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Errors, isRefusal, operations, type OperationName } from "@capxul/blueprint";
import * as Sdk from "@capxul/sdk";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpEffect from "effect/http/HttpEffect";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import { CoreIdentity, PLATFORM_PATH, Served, serveDoors, SpanSink, WORLD_PATH, type KeptSpan } from "../src/door.ts";
import { madeFromNothing, siteOps, siteOpsInMemory } from "../src/site-ops/door.ts";
import { absent, BUILT } from "./support/built.ts";

/** The operations that are built answer as they are built (test/site-ops.test.ts); the rest are still empty. */
const built: ReadonlyArray<string> = [...Rec.keys(siteOps), ...BUILT];

const BASE = "https://core.test";
const DOOR = Redacted.make("door-token");
const PLATFORM = Redacted.make("platform-token");

/** Core as the Worker serves it, every span it keeps pushed to `kept`. */
const scope = Scope.makeUnsafe();

const core = (kept: Array<KeptSpan>) => {
  const sink = Layer.succeed(SpanSink, SpanSink.of({ keep: (spans) => Effect.sync(() => kept.push(...spans)) }));
  const identity = Layer.succeed(CoreIdentity, {
    world: "town",
    owner: "ci",
    doorToken: DOOR,
    platformToken: PLATFORM,
  });
  const served = Served.pipe(
    Layer.provideMerge(RpcSerialization.layerJson),
    Layer.provide(siteOpsInMemory({ record: [madeFromNothing("town", "ci", 0)] })),
    Layer.provide(Layer.mergeAll(sink, identity, absent)),
  );
  // The doors' Rpc servers start once, in a scope that lives as long as the test; each request is then handled.
  const handler = Effect.runSync(Effect.provide(serveDoors, Layer.merge(served, Layer.succeed(Scope.Scope, scope))));
  return HttpEffect.toWebHandler(Effect.provide(handler, served));
};

/** An HTTP client whose every request is answered by `handler` in this process. */
const inProcess = (handler: ReturnType<typeof core>) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      HttpClientRequest.toWeb(request).pipe(
        Effect.flatMap((web) => Effect.promise(() => handler(web))),
        Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
        Effect.orDie,
      ),
    ),
  );

/** Calls every operation through the SDK, each in a trace of its own; returns how each ended and its trace id. */
const callAll = (tokens: { readonly door: Redacted.Redacted; readonly platform: Redacted.Redacted }) => {
  const kept: Array<KeptSpan> = [];
  const doors = Layer.merge(
    Sdk.platformDoor({ url: `${BASE}${PLATFORM_PATH}`, token: tokens.platform }),
    Sdk.worldDoor({ url: `${BASE}${WORLD_PATH}`, token: tokens.door }),
  ).pipe(Layer.provide(inProcess(core(kept))));
  const program = Effect.gen(function* () {
    const client = yield* Sdk.make;
    return yield* Effect.forEach(Sdk.names, (name: OperationName) =>
      Effect.gen(function* () {
        const span = yield* Effect.orDie(Effect.currentSpan);
        const payload = Option.getOrUndefined(Arr.head(operations[name].examples))?.payload;
        const exit = yield* Effect.exit(Sdk.callByName(client, name, payload));
        return { name, exit, traceId: span.traceId };
      }).pipe(Effect.withSpan("test", { root: true })),
    );
  });
  return Effect.map(Effect.scoped(Effect.provide(program, doors)), (calls) => ({ calls, kept }));
};

const errorOf = (exit: Exit.Exit<unknown, unknown>): unknown =>
  Exit.isFailure(exit) ? exit.cause.pipe(Cause.findErrorOption, Option.getOrUndefined) : undefined;

test("through the SDK, each operation answers at its door, the unbuilt NotImplemented, under the trace the SDK sent", async () => {
  const { calls, kept } = await Effect.runPromise(callAll({ door: DOOR, platform: PLATFORM }));
  assert.equal(calls.length, Rec.keys(operations).length);
  for (const { name, exit, traceId } of calls) {
    const error = errorOf(exit);
    // The chain, people and budgets operations' handlers need a chain or a database, which a test in memory has not
    // (test/chain, test/people-sql.test.ts); invitation.list as the world's owner, who has no email, reads nothing.
    if (BUILT.has(name))
      assert.ok(Exit.isFailure(exit) || name === "invitation.list", `${name} answered with no chain or database`);
    else if (Arr.contains(built, name))
      assert.ok(
        Exit.isSuccess(exit) || isRefusal(operations[name], error),
        `${name} did not answer a success or a declared refusal: ${Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""}`,
      );
    else {
      assert.ok(
        Schema.is(Errors.NotImplemented)(error),
        `${name} did not answer NotImplemented: ${Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "success"}`,
      );
      assert.equal(error.operation, name);
    }
    const own = Arr.filter(kept, (span) => span.name === name);
    assert.equal(own.length, 1, `${name}: ${own.length} server spans`);
    assert.equal(own[0]?.traceId, traceId, `${name}: the server span is not under the caller's trace`);
  }
});

test("with the wrong tokens every call is refused at sign-in", async () => {
  const wrong = Redacted.make("wrong");
  const { calls } = await Effect.runPromise(callAll({ door: wrong, platform: wrong }));
  for (const { name, exit } of calls) {
    const error = errorOf(exit);
    assert.ok(Schema.is(Errors.NotSignedIn)(error), `${name} was not refused`);
    assert.equal(error.reason, "unknown_caller");
  }
});

test("a path that is no door answers 404 in JSON, so it is never mistaken for Cloudflare's edge", async () => {
  const response = await core([])(new Request(`${BASE}/elsewhere`, { method: "POST" }));
  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
});
