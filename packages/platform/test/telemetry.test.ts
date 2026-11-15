// Where each entry's telemetry goes (src/telemetry.ts): the run's attributes from the environment, trusted only in
// GitHub Actions, and nothing exported, with the tracer left as it was, when no endpoint is set.
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { test } from "node:test";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
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

test("an entry given a collector and no endpoint posts there, with the collector's authorization header", async () => {
  const seen: Array<{ url: string; authorization: string | undefined }> = [];
  const server = createServer((request, response) => {
    seen.push({ url: request.url ?? "", authorization: request.headers.authorization });
    request.resume();
    request.on("end", () => response.writeHead(200, { "content-type": "application/json" }).end("{}"));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  const port = address !== null && typeof address === "object" ? address.port : 0;
  const target = Option.some({ baseUrl: `http://127.0.0.1:${port}`, headers: { authorization: "Bearer c1.claim" } });
  await Effect.runPromise(
    Effect.void.pipe(
      Effect.withSpan("platform.export.probe"),
      Effect.provide(exportFromConfig(platformTelemetry, target)),
      under({ OTEL_LOGS_EXPORTER: "none", OTEL_METRICS_EXPORTER: "none" }),
    ),
  );
  await new Promise<void>((done) => server.close(() => done()));
  assert.deepEqual(seen, [{ url: "/v1/traces", authorization: "Bearer c1.claim" }]);
});
