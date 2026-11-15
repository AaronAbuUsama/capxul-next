// Where the runner's telemetry goes when no endpoint is set (src/telemetry/export.ts): to the collector of the stage
// RUNNER_COLLECTOR names, or of `staging` in CI, and nowhere otherwise, with the tracer left as it was.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { collectorStage, runnerExport } from "../src/telemetry/export.ts";

test("a run in CI sends to staging's collector unless told another stage; a run elsewhere sends nowhere", () => {
  assert.deepEqual(collectorStage({ stage: Option.none(), actions: true }), Option.some("staging"));
  assert.deepEqual(collectorStage({ stage: Option.some("rehearsal"), actions: true }), Option.some("rehearsal"));
  assert.deepEqual(collectorStage({ stage: Option.some("staging"), actions: false }), Option.some("staging"));
  assert.deepEqual(collectorStage({ stage: Option.none(), actions: false }), Option.none());
  assert.deepEqual(collectorStage({ stage: Option.some(""), actions: false }), Option.none());
});

test("with no endpoint and no collector chosen, the runner exports nothing and keeps its tracer", async () => {
  const same = await Effect.runPromise(
    Effect.gen(function* () {
      const before = yield* Effect.tracer;
      const after = yield* Effect.tracer.pipe(Effect.provide(Layer.fresh(runnerExport)));
      return before === after;
    }).pipe(Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({}))),
  );
  assert.ok(same, "the tracer changed though nothing chose where to send");
});
