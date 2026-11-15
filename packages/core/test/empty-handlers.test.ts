// Core's empty-handler mode (src/empty-handlers.ts): every one of the twelve operations answers NotImplemented,
// naming itself, under one span, whatever is built. What a stage deployed with CAPXUL_HANDLERS=empty serves.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  CREDENTIAL_HEADER,
  Errors,
  operations,
  PlatformRpcs,
  servedBy,
  WorldRpcs,
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
import * as RpcTest from "effect/rpc/RpcTest";
import { CoreIdentity, CoreRpcs, ServedEmpty, SpanSink, type KeptSpan } from "../src/door.ts";

const DOOR = "door-token";
const PLATFORM = "platform-token";
type Refusal = InstanceType<(typeof Errors.refusals)[Errors.RefusalTag]>;
const isNotImplemented = Schema.is(Errors.NotImplemented);

const call = (name: OperationName) =>
  Effect.gen(function* () {
    const kept: Array<KeptSpan> = [];
    const sink = Layer.succeed(SpanSink, SpanSink.of({ keep: (spans) => Effect.sync(() => kept.push(...spans)) }));
    const identity = Layer.succeed(CoreIdentity, {
      world: "town",
      owner: "ci",
      doorToken: Redacted.make(DOOR),
      platformToken: Redacted.make(PLATFORM),
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
        const headers = { [CREDENTIAL_HEADER]: `Bearer ${servedBy(name) === "platform" ? PLATFORM : DOOR}` };
        return yield* Effect.exit(send(name, operations[name].examples[0]?.payload, { headers }));
      }),
    ).pipe(Effect.provide(ServedEmpty.pipe(Layer.provide(Layer.merge(sink, identity)))));
    return { exit, kept };
  });

test("in empty-handler mode every operation answers NotImplemented, naming itself, under one span", async () => {
  const names: ReadonlyArray<OperationName> = Rec.keys(operations);
  assert.equal(names.length, PlatformRpcs.requests.size + WorldRpcs.requests.size);
  for (const name of names) {
    const { exit, kept } = await Effect.runPromise(call(name));
    const error = Exit.isFailure(exit) ? exit.cause.pipe(Cause.findErrorOption, Option.getOrUndefined) : undefined;
    assert.ok(isNotImplemented(error), `${name} did not answer NotImplemented`);
    assert.equal(error.operation, name);
    assert.equal(Arr.filter(kept, (span) => span.name === name).length, 1, `${name}: not one span named after it`);
  }
});
