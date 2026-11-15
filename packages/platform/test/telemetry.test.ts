// Where each entry's telemetry goes (src/telemetry.ts): the run's attributes from the environment, trusted only in
// GitHub Actions, and nothing exported, with the tracer left as it was, when no endpoint is set.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RUN_ATTRIBUTES } from "../src/collector/envelope.ts";
import { exportFromConfig, platformTelemetry, RunAttributes } from "../src/telemetry.ts";

const under =
  (env: Record<string, string>) =>
  <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.provideService(effect, ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord(env));

/** The run's attributes, as an entry reads them. */
const attributesOf = Effect.gen(function* () {
  const run = yield* RunAttributes;
  return run;
});

test("a run outside GitHub Actions is not trusted, and carries the revision run.sh gives it", async () => {
  const run = await Effect.runPromise(attributesOf.pipe(under({ CODE_REVISION: "abc123" })));
  assert.equal(run.revision, "abc123");
  assert.deepEqual(run.attributes, { [RUN_ATTRIBUTES.trusted]: false, [RUN_ATTRIBUTES.revision]: "abc123" });
});

test("a run in GitHub Actions is trusted, and names its pipeline run, its commit and its branch", async () => {
  const run = await Effect.runPromise(
    attributesOf.pipe(
      under({
        GITHUB_ACTIONS: "true",
        GITHUB_SHA: "f00d",
        CODE_REVISION: "ignored",
        GITHUB_HEAD_REF: "slice/telemetry",
        GITHUB_REF_NAME: "317/merge",
        GITHUB_RUN_ID: "43710528109",
      }),
    ),
  );
  assert.equal(run.revision, "f00d");
  assert.deepEqual(run.attributes, {
    [RUN_ATTRIBUTES.trusted]: true,
    [RUN_ATTRIBUTES.revision]: "f00d",
    [RUN_ATTRIBUTES.ref]: "slice/telemetry",
    [RUN_ATTRIBUTES.pipelineRun]: "43710528109",
  });
});

test("with no endpoint set, an entry exports nothing and keeps the tracer it had", async () => {
  const same = await Effect.runPromise(
    Effect.gen(function* () {
      const before = yield* Effect.tracer;
      const after = yield* Effect.tracer.pipe(Effect.provide(Layer.fresh(exportFromConfig(platformTelemetry))));
      return before === after;
    }).pipe(under({})),
  );
  assert.ok(same, "the tracer changed though no endpoint was set");
});
