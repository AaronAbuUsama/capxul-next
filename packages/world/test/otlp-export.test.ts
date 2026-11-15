// The world exports OTLP (roadmap 4.4): given an endpoint, its layer posts the spans of a traced effect, under a resource
// carrying `service.name` "capxul-world" and the code's revision as `service.version`.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { worldTelemetry } from "../src/common/telemetry.ts";
import { bodiesTo, capturing, ENDPOINT, REVISION } from "./support/otlp-endpoint.ts";

/** The OTLP JSON of one `/v1/traces` body, as far as this test reads it. */
interface Traces {
  readonly resourceSpans: ReadonlyArray<{
    readonly resource: {
      readonly attributes: ReadonlyArray<{ readonly key: string; readonly value: { readonly stringValue?: string } }>;
    };
    readonly scopeSpans: ReadonlyArray<{ readonly spans: ReadonlyArray<{ readonly name: string }> }>;
  }>;
}

const PROBE = "world.export.probe";
/** The producer's name as #301 declares it (`packages/blueprint/src/telemetry/producers.ts` on `slice/blueprint`).
 * It moves to an import from the blueprint's producers when #301 reaches master. */
const SERVICE = "capxul-world";

const exportsTheProbe = Effect.gen(function* () {
  const { posted, layer } = capturing();
  yield* Effect.void.pipe(
    Effect.withSpan(PROBE),
    Effect.provide(worldTelemetry({ baseUrl: ENDPOINT, revision: REVISION }).pipe(Layer.provide(layer))),
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
  assert.equal(attribute("service.name"), SERVICE);
  assert.equal(attribute("service.version"), REVISION);
});

test("the world's OTLP layer posts a traced effect's spans, with its service and revision", async () => {
  await Effect.runPromise(exportsTheProbe);
});
