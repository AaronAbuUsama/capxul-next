// Core served in memory: every one of the twelve operations answers its declared `NotImplemented`, under one span
// named after it, kept under the trace id the caller sent; and sign-in refuses a person it cannot name.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  CREDENTIAL_HEADER,
  Errors,
  operations,
  PERSON_HEADER,
  TRACE_HEADER,
  servedBy,
  type OperationName,
} from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as RpcTest from "effect/rpc/RpcTest";
import { CoreIdentity, CoreRpcs, Served, SpanSink, type KeptSpan } from "../src/door.ts";
import { madeFromNothing, siteOps, siteOpsInMemory } from "../src/site-ops/door.ts";

const names: ReadonlyArray<OperationName> = Rec.keys(operations);
/** The operations that are built answer as they are built (test/site-ops.test.ts); the rest are still empty. */
const built: ReadonlyArray<string> = Rec.keys(siteOps);
const unbuilt = Arr.filter(names, (name) => !Arr.contains(built, name));
const DOOR = "door-token";
const PLATFORM = "platform-token";
const SECOND = "second-platform-token";
/** The credential each operation's door accepts. */
const credentialOf = (name: OperationName) => ({
  [CREDENTIAL_HEADER]: `Bearer ${servedBy(name) === "platform" ? PLATFORM : DOOR}`,
});
const trace = (n: number): string => Str.padStart(32, "0")(n.toString(16));
type Refusal = InstanceType<(typeof Errors.refusals)[Errors.RefusalTag]>;

/** Calls `name` with its first example, under `headers`, and returns how it ended and every span Core kept. */
const call = (name: OperationName, headers: Record<string, string>, credential = true) =>
  Effect.gen(function* () {
    const kept: Array<KeptSpan> = [];
    const sink = Layer.succeed(SpanSink, SpanSink.of({ keep: (spans) => Effect.sync(() => kept.push(...spans)) }));
    const identity = Layer.succeed(CoreIdentity, {
      world: "town",
      owner: "ci",
      doorToken: Redacted.make(DOOR),
      platformToken: Redacted.make(PLATFORM),
      second: { operator: "ci-2", token: Redacted.make(SECOND) },
    });
    const exit = yield* Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(CoreRpcs, { flatten: true });
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each operation is called by name with its own example, which the flat client's per-name types cannot follow
        const send = client as unknown as (
          tag: string,
          payload: unknown,
          options: object,
        ) => Effect.Effect<unknown, Refusal>;
        const sent = { ...(credential ? credentialOf(name) : {}), ...headers };
        return yield* Effect.exit(send(name, operations[name].examples[0]?.payload, { headers: sent }));
      }),
    ).pipe(
      Effect.provide(
        Served.pipe(
          Layer.provide(siteOpsInMemory({ record: [madeFromNothing("town", "ci", 0)] })),
          Layer.provide(Layer.merge(sink, identity)),
        ),
      ),
    );
    return { exit, kept };
  });

const isNotImplemented = Schema.is(Errors.NotImplemented);

const failureOf = (exit: Exit.Exit<unknown, unknown>): unknown =>
  Exit.isFailure(exit) ? exit.cause.pipe(Cause.findErrorOption, Option.getOrUndefined) : undefined;

test("every unbuilt operation answers NotImplemented, naming itself, under one span kept with the caller's trace id", async () => {
  assert.equal(names.length, 12);
  for (const [index, name] of Arr.map(unbuilt, (each, i) => [i, each] as const)) {
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
  const { kept } = await Effect.runPromise(call("world.show", {}));
  assert.equal(Arr.filter(kept, (span) => span.name === "world.show").length, 1);
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
  const { exit } = await Effect.runPromise(call("record.export", { [PERSON_HEADER]: "dana" }));
  assert.ok(Schema.is(Errors.NotWorldOwner)(exit.pipe(failureOf)), "record.export as a person was not refused");
});

test("a call without the credential, or with another door's, is refused at sign-in and still measured", async () => {
  const none = await Effect.runPromise(call("record.export", {}, false));
  const wrong = await Effect.runPromise(call("world.show", { [CREDENTIAL_HEADER]: `Bearer ${DOOR}` }));
  for (const [{ exit, kept }, reason] of [
    [none, "no_credential"],
    [wrong, "unknown_caller"],
  ] as const) {
    const error = failureOf(exit);
    assert.ok(Schema.is(Errors.NotSignedIn)(error), "sign-in did not refuse");
    assert.equal(error.reason, reason);
    assert.equal(kept.length, 1);
  }
});

test("the owner's operator token acts as the owner at the world's door; the second operator's does not", async () => {
  const owner = await Effect.runPromise(call("record.export", { [CREDENTIAL_HEADER]: `Bearer ${PLATFORM}` }));
  assert.ok(Exit.isSuccess(owner.exit), "the owner's token was not signed in at the world's door");
  const other = await Effect.runPromise(call("record.export", { [CREDENTIAL_HEADER]: `Bearer ${SECOND}` }));
  const error = failureOf(other.exit);
  assert.ok(Schema.is(Errors.NotSignedIn)(error), "another operator's token was signed in at the world's door");
  assert.equal(error.reason, "unknown_caller");
});

test("the second operator's platform token signs a platform call in", async () => {
  const { exit } = await Effect.runPromise(call("world.show", { [CREDENTIAL_HEADER]: `Bearer ${SECOND}` }));
  assert.ok(isNotImplemented(exit.pipe(failureOf)), "the second operator was not signed in at the platform");
});
