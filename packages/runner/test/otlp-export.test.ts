// The runner exports OTLP (roadmap 4.4): given an endpoint, its layer posts the spans of a traced effect, under a resource
// carrying `service.name` "runner" and the code's revision as `service.version`.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { runnerTelemetry } from "../src/telemetry/export.ts";
import { bodiesTo, capturing, ENDPOINT } from "./support/capture.ts";
import { failsUntilBuilt } from "./support/fails.ts";

const REVISION = "0123abc";

/** The OTLP JSON of one `/v1/traces` body, as far as this test reads it. */
interface Traces {
  readonly resourceSpans: ReadonlyArray<{
    readonly resource: {
      readonly attributes: ReadonlyArray<{ readonly key: string; readonly value: { readonly stringValue?: string } }>;
    };
    readonly scopeSpans: ReadonlyArray<{ readonly spans: ReadonlyArray<{ readonly name: string }> }>;
  }>;
}

const PROBE = "runner.export.probe";

const exportsTheProbe = Effect.gen(function* () {
  const { posted, layer } = capturing();
  yield* Effect.void.pipe(
    Effect.withSpan(PROBE),
    Effect.provide(runnerTelemetry({ baseUrl: ENDPOINT, revision: REVISION }).pipe(Layer.provide(layer))),
  );
  const bodies = bodiesTo(posted, "/v1/traces");
  assert.ok(bodies.length > 0, "no export reached the endpoint");
  const traces: ReadonlyArray<Traces> = Arr.map(bodies, (body) => JSON.parse(body));
  const probed = Arr.findFirst(
    Arr.flatMap(traces, (each) => each.resourceSpans),
    (each) => Arr.some(each.scopeSpans, (scope) => Arr.some(scope.spans, (span) => span.name === PROBE)),
  );
  assert.ok(Option.isSome(probed), "the traced effect's span was not exported");
  const attribute = (key: string) =>
    Arr.findFirst(probed.value.resource.attributes, (each) => each.key === key).pipe(
      Option.flatMap((each) => Option.fromNullishOr(each.value.stringValue)),
      Option.getOrUndefined,
    );
  assert.equal(attribute("service.name"), "runner");
  assert.equal(attribute("service.version"), REVISION);
});

// Fails until "🔨 the runner, the world and the platform client export OTLP" (PR #317, item 4) replaces the stub, which exports nothing.
test("the runner's OTLP layer posts a traced effect's spans, with its service and revision", async () => {
  const reason = await exportsTheProbe.pipe(failsUntilBuilt, Effect.runPromise);
  assert.match(reason, /no export reached the endpoint/);
});
