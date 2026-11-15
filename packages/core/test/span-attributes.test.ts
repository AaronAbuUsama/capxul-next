// A call's own span carries its declared attributes (src/telemetry/attributes.ts): the colo its Worker ran in, when
// the request names one, and the sum and count of its Postgres round trips. No other span carries them.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CREDENTIAL_HEADER, operations, WorldRpcs } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Headers from "effect/http/Headers";
import type * as Rpc from "effect/rpc/Rpc";
import * as RpcTest from "effect/rpc/RpcTest";
import {
  CoreIdentity,
  CoreRpcs,
  Placement,
  Served,
  SPAN_ATTRIBUTES,
  SpanSink,
  type KeptSpan,
  type Where,
} from "../src/door.ts";
import { madeFromNothing, siteOpsInMemory } from "../src/site-ops/door.ts";
import { coloOf } from "../src/telemetry/attributes.ts";
import { measured } from "../src/telemetry/spans.ts";
import { absent } from "./support/built.ts";

/** A world operation, as a middleware is told of it: `measured` reads only its name. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a declared Rpc names its middlewares by their own types, which the general `AnyWithProps` a middleware is handed cannot follow
const rpc = Option.getOrThrow(Arr.head([...WorldRpcs.requests.values()])) as unknown as Rpc.AnyWithProps;

/** A round trip as `@effect/sql-pg` opens one: a client span with `db.system.name` set to postgresql. */
const roundTrip = (ms: number) =>
  Effect.useSpan("postgres", { kind: "client", attributes: { "db.system.name": "postgresql" } }, () =>
    Effect.sleep(`${ms} millis`),
  );

/** Runs `effect` as a call measured at `placement`, and returns every span kept of it. */
const measure = <E>(placement: Where, effect: Effect.Effect<unknown, E>) =>
  Effect.gen(function* () {
    const kept: Array<KeptSpan> = [];
    const sink = SpanSink.of({ keep: (spans) => Effect.sync(() => kept.push(...spans)) });
    yield* Effect.exit(measured(sink, placement, { rpc, headers: Headers.empty }, effect));
    return kept;
  });

test("the call's span sums its Postgres round trips and names its colo", async () => {
  const work = Effect.gen(function* () {
    yield* roundTrip(5);
    yield* roundTrip(5);
    // Not a round trip: a client span of something else.
    yield* Effect.useSpan("GET", { kind: "client" }, () => Effect.sleep("5 millis"));
  });
  const kept = await Effect.runPromise(measure({ colo: Option.some("LHR") }, work));
  const own = Arr.filter(kept, (span) => span.name === rpc._tag);
  assert.equal(own.length, 1);
  const attributes = own[0]?.attributes;
  assert.ok(attributes !== null && attributes !== undefined, "the call's span has no attributes");
  assert.equal(attributes[SPAN_ATTRIBUTES.colo], "LHR");
  assert.equal(attributes[SPAN_ATTRIBUTES.queryCount], 2);
  const trips = Arr.filter(kept, (span) => span.roundTrip);
  assert.equal(trips.length, 2);
  const summed = Arr.reduce(trips, 0, (sum, span) => sum + span.durationMs);
  assert.ok(Math.abs((attributes[SPAN_ATTRIBUTES.queryMs] ?? -1) - summed) < 0.01, "db.query_ms is not their sum");
  assert.ok((attributes[SPAN_ATTRIBUTES.queryMs] ?? 0) >= 8, "db.query_ms is less than the round trips took");
  assert.ok(
    Arr.every(
      Arr.filter(kept, (span) => span.name !== rpc._tag),
      (span) => span.attributes === null,
    ),
    "a span other than the call's carries attributes",
  );
});

test("a call with no colo and no round trips says so: no cf.colo, and zero queries", async () => {
  const kept = await Effect.runPromise(measure({ colo: Option.none() }, Effect.void));
  assert.deepEqual(kept[0]?.attributes, { [SPAN_ATTRIBUTES.queryMs]: 0, [SPAN_ATTRIBUTES.queryCount]: 0 });
});

test("a refused call's span carries its attributes too", async () => {
  const kept = await Effect.runPromise(
    measure(
      { colo: Option.some("AMS") },
      Effect.flatMap(roundTrip(1), () => Effect.fail("refused")),
    ),
  );
  const own = Arr.filter(kept, (span) => span.name === rpc._tag);
  assert.equal(own[0]?.outcome, "failure");
  assert.equal(own[0]?.attributes?.[SPAN_ATTRIBUTES.colo], "AMS");
  assert.equal(own[0]?.attributes?.[SPAN_ATTRIBUTES.queryCount], 1);
});

test("the colo is read from the web request's cf.colo, and is absent without one", () => {
  assert.deepEqual(coloOf({ cf: { colo: "LHR" } }), Option.some("LHR"));
  assert.deepEqual(coloOf({ cf: {} }), Option.none());
  assert.deepEqual(coloOf({ cf: { colo: "" } }), Option.none());
  assert.deepEqual(coloOf({}), Option.none());
  assert.deepEqual(coloOf(undefined), Option.none());
});

/** One call through both groups' middlewares in memory, at `placement` when given (null: none provided). */
const served = (placement: Where | null) =>
  Effect.gen(function* () {
    const kept: Array<KeptSpan> = [];
    const sink = Layer.succeed(SpanSink, SpanSink.of({ keep: (spans) => Effect.sync(() => kept.push(...spans)) }));
    const identity = Layer.succeed(CoreIdentity, {
      world: "town",
      owner: "ci",
      doorToken: Redacted.make("door-token"),
      platformToken: Redacted.make("platform-token"),
    });
    const where = placement === null ? Layer.empty : Layer.succeed(Placement, placement);
    yield* Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(CoreRpcs, { flatten: true });
        return yield* Effect.exit(
          client(
            operations["record.export"].rpc._tag,
            { from: null, to: null },
            { headers: { [CREDENTIAL_HEADER]: "Bearer door-token" } },
          ),
        );
      }),
    ).pipe(
      Effect.provide(
        Served.pipe(
          Layer.provide(siteOpsInMemory({ record: [madeFromNothing("town", "ci", 0)] })),
          Layer.provide(Layer.mergeAll(sink, identity, absent, where)),
        ),
      ),
    );
    return Arr.filter(kept, (span) => span.name === operations["record.export"].rpc._tag);
  });

test("a call served in memory carries the attributes on its one span, and the colo its Core was given", async () => {
  const without = await Effect.runPromise(served(null));
  assert.equal(without.length, 1);
  assert.equal(without[0]?.attributes?.[SPAN_ATTRIBUTES.colo], undefined);
  assert.equal(without[0]?.attributes?.[SPAN_ATTRIBUTES.queryCount], 0);
  const placed = await Effect.runPromise(served({ colo: Option.some("FRA") }));
  assert.equal(placed[0]?.attributes?.[SPAN_ATTRIBUTES.colo], "FRA");
});
