// Core served in memory: every one of the twelve operations answers its declared `NotImplemented`, under one span
// named after it, kept under the trace id the caller sent; and sign-in refuses a person it cannot name.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Errors, operations, PERSON_HEADER, TRACE_HEADER, type OperationName } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as RpcTest from "effect/rpc/RpcTest";
import { CoreIdentity, CoreRpcs, Served, SpanSink, type KeptSpan } from "../src/door.ts";

const names: ReadonlyArray<OperationName> = Rec.keys(operations);
const trace = (n: number): string => Str.padStart(32, "0")(n.toString(16));
type Refusal = InstanceType<(typeof Errors.refusals)[Errors.RefusalTag]>;

/** Calls `name` with its first example, under `headers`, and returns how it ended and every span Core kept. */
const call = (name: OperationName, headers: Record<string, string>) =>
  Effect.gen(function* () {
    const kept: Array<KeptSpan> = [];
    const sink = Layer.succeed(SpanSink, SpanSink.of({ keep: (spans) => Effect.sync(() => kept.push(...spans)) }));
    const identity = Layer.succeed(CoreIdentity, { world: "town", owner: "ci" });
    const exit = yield* Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(CoreRpcs, { flatten: true });
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each operation is called by name with its own example, which the flat client's per-name types cannot follow
        const send = client as unknown as (
          tag: string,
          payload: unknown,
          options: object,
        ) => Effect.Effect<unknown, Refusal>;
        return yield* Effect.exit(send(name, operations[name].examples[0]?.payload, { headers }));
      }),
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- each call is its own program here, served afresh
    ).pipe(Effect.provide(Served.pipe(Layer.provide(Layer.merge(sink, identity)))));
    return { exit, kept };
  });

const isNotImplemented = Schema.is(Errors.NotImplemented);

const failureOf = (exit: Exit.Exit<unknown, unknown>): unknown =>
  Exit.isFailure(exit) ? exit.cause.pipe(Cause.findErrorOption, Option.getOrUndefined) : undefined;

test("every operation answers NotImplemented, naming itself, under one span kept with the caller's trace id", async () => {
  assert.equal(names.length, 12);
  for (const [index, name] of Arr.map(names, (each, i) => [i, each] as const)) {
    const traceId = trace(index + 1);
    const { exit, kept } = await Effect.runPromise(
      call(name, { [TRACE_HEADER]: `00-${traceId}-${Str.repeat(16)("1")}-01` }),
    );
    const error = failureOf(exit);
    assert.ok(isNotImplemented(error), `${name} did not answer NotImplemented`);
    assert.equal(error.operation, name);
    const own = Arr.filter(kept, (span) => span.name === name);
    assert.equal(own.length, 1, `${name}: ${own.length} spans named after it`);
    assert.equal(own[0]?.traceId, traceId);
    assert.equal(own[0]?.outcome, "failure");
    assert.ok(
      Arr.every(kept, (span) => span.traceId === traceId),
      `${name}: a span under another trace`,
    );
  }
});

test("a call with no trace header still gets its one span, under a new trace", async () => {
  const { kept } = await Effect.runPromise(call("record.export", {}));
  assert.equal(Arr.filter(kept, (span) => span.name === "record.export").length, 1);
});

test("a person header that names no person is refused at sign-in, and the call is still measured", async () => {
  const { exit, kept } = await Effect.runPromise(call("record.export", { [PERSON_HEADER]: "Not A Person!" }));
  const error = failureOf(exit);
  assert.ok(Schema.is(Errors.NotSignedIn)(error), "sign-in did not refuse");
  assert.equal(error.reason, "unknown_caller");
  assert.equal(Arr.filter(kept, (span) => span.name === "record.export").length, 1);
});

test("a platform operation and a world operation are both served, by their own groups", async () => {
  for (const name of ["world.show", "org.create"] as const) {
    const { exit } = await Effect.runPromise(call(name, { [PERSON_HEADER]: "dana" }));
    const failure = failureOf(exit);
    assert.ok(isNotImplemented(failure), name);
  }
});
