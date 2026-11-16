// The chain reads a journey makes (src/telemetry/chain.ts): each JSON-RPC request in a `journey.run.chain` span with
// its method and block range, and kept by the step open when it was made (src/steps.ts), so the step's record shows
// where its chain time went.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Envelope, operations, Pipeline } from "@capxul/blueprint";
import { Steps } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Rec from "effect/Record";
import * as Ref from "effect/Ref";
import type { Call } from "../src/client.ts";
import { hearing, stepsOf, type Heard } from "../src/steps.ts";
import { ChainReads, rangeOf, recordedRpc, type ChainRead } from "../src/telemetry/chain.ts";
import { flatSpans } from "../src/telemetry/flat.ts";
import { decodeTraces } from "../src/telemetry/otlp.ts";
import { bodiesTo, exported } from "./support/capture.ts";

const OPERATION = Rec.keys(operations)[0]!;
const outline = [
  { operation: OPERATION, does: "the first step" },
  { operation: OPERATION, does: "the second step" },
];
const LOGS = { fromBlock: "0x10", toBlock: "latest", address: "0x0000000000000000000000000000000000000001" };

/** A chain that answers every request with an empty list. */
const answering = recordedRpc(() => Effect.succeed([]));

test("a read of logs has its block range; any other method has none", () => {
  assert.deepEqual(rangeOf("eth_getLogs", [LOGS]), { from: "0x10", to: "latest" });
  assert.deepEqual(rangeOf("eth_getLogs", []), { from: null, to: null });
  assert.deepEqual(rangeOf("eth_call", [{ to: "0x01" }, "latest"]), { from: null, to: null });
});

test("each read is heard with its method, its range, its time and how it ended; a read that dies still dies", async () => {
  const heard: Array<ChainRead> = [];
  const keep = <A, E>(effect: Effect.Effect<A, E, ChainReads>) =>
    effect.pipe(Effect.provideService(ChainReads, { heard: (read) => Effect.sync(() => heard.push(read)) }));
  await answering("eth_getLogs", [LOGS]).pipe(keep, Effect.runPromise);
  const died = await recordedRpc(() => Effect.die("no chain"))("eth_blockNumber", []).pipe(keep, Effect.runPromiseExit);
  assert.ok(Exit.isFailure(died));
  assert.deepEqual(
    Arr.map(heard, ({ ms: _ms, ...read }) => read),
    [
      { method: "eth_getLogs", from: "0x10", to: "latest", outcome: "ok" },
      { method: "eth_blockNumber", from: null, to: null, outcome: "error" },
    ],
  );
  assert.ok(Arr.every(heard, (read) => read.ms >= 0));
});

test("each read is a declared chain span, with its method and its block range", async () => {
  const posted = await answering("eth_getLogs", [LOGS]).pipe(exported, Effect.runPromise);
  const spans = flatSpans(await Effect.runPromise(decodeTraces(bodiesTo(posted, "/v1/traces")[0]!)));
  const span = Arr.findFirst(spans, (each) => each.name === Pipeline.journeyRun.spans.chain.name);
  assert.ok(span._tag === "Some");
  const attributes = Envelope.attributes;
  assert.equal(span.value.attributes[attributes.stepKind.name], "chain");
  assert.equal(span.value.attributes[attributes.rpcSystem.name], "jsonrpc");
  assert.equal(span.value.attributes[attributes.rpcMethod.name], "eth_getLogs");
  assert.equal(span.value.attributes[attributes.chainBlockFrom.name], "0x10");
  assert.equal(span.value.attributes[attributes.chainBlockTo.name], "latest");
});

test("a step's record keeps the reads made while it was open, and none made between steps", async () => {
  const steps = await Effect.runPromise(
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<Call>>([]);
      const heard = yield* Ref.make<ReadonlyArray<Heard>>([]);
      yield* Effect.gen(function* () {
        const journey = yield* Steps;
        yield* journey.begin(1, outline[0]!);
        yield* answering("eth_getLogs", [LOGS]);
        yield* answering("eth_call", [{ to: "0x01" }, "latest"]);
        yield* journey.end(1, null);
        yield* answering("eth_blockNumber", []);
        yield* journey.begin(2, outline[1]!);
        yield* journey.end(2, null);
      }).pipe(Effect.provide(hearing(heard, log)));
      return stepsOf(outline, yield* Ref.get(heard), []);
    }),
  );
  assert.deepEqual(
    Arr.map(steps, (step) => Arr.map(step.chain ?? [], (read) => read.method)),
    [["eth_getLogs", "eth_call"], []],
  );
});
