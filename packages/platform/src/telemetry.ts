// Where a process of ours sends its telemetry (roadmap 4.4): OTLP, by OpenTelemetry's standard settings, through
// Effect's own exporter (`effect/observability`, no OpenTelemetry SDK). Each entry provides `exportLayer` once, named
// by its producer. The settings choose where it goes and which signals are on:
//
//   OTEL_EXPORTER_OTLP_ENDPOINT    the collector, e.g. http://127.0.0.1:4318 (or one per signal,
//                                  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, ...). With none set, nothing is exported.
//   OTEL_TRACES_EXPORTER=otlp      each signal is on only when its exporter says `otlp` (also _LOGS_ and _METRICS_)
//   OTEL_EXPORTER_OTLP_PROTOCOL    http/protobuf (the default) or http/json
//   OTEL_EXPORTER_OTLP_HEADERS     headers for the collector, e.g. a token; never logged
//
// The resource names the producer and the code's revision, and, in GitHub Actions, the run, the commit and the ref.
// A run anywhere else is an agent's or a person's, and says so: until the blueprint's envelope (#301) gives the run
// its trust attribute, `deployment.environment.name` is `ci` in GitHub Actions and `agent` everywhere else.
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Otlp from "effect/observability/Otlp";
import * as OtlpSerialization from "effect/observability/OtlpSerialization";

/** Each producer's `service.name`: the blueprint's `producers` (#301), named here until that reaches master. */
export const PRODUCERS = {
  runner: "capxul-runner",
  world: "capxul-world",
  sites: "capxul-sites-client",
} as const;
export type Producer = (typeof PRODUCERS)[keyof typeof PRODUCERS];

/** The OpenTelemetry convention names of the resource's attributes; none of them is ours. */
export const RESOURCE_ATTRIBUTES = {
  revision: "vcs.ref.head.revision",
  ref: "vcs.ref.head.name",
  pipelineRun: "cicd.pipeline.run.id",
  environment: "deployment.environment.name",
} as const;

/** Where a run ran: `ci` in GitHub Actions, the only place a run is trusted; `agent` anywhere else. */
export type Environment = "ci" | "agent";

const optional = (name: string) => Config.option(Config.String(name));

/**
 * The run's attributes, from the environment: GitHub Actions' own variables in CI, and `CODE_REVISION` elsewhere
 * (each run.sh sets it from `git rev-parse HEAD` when it is not set).
 */
export const RunAttributes = Config.all({
  actions: Config.Boolean("GITHUB_ACTIONS").pipe(Config.withDefault(false)),
  sha: optional("GITHUB_SHA"),
  revision: optional("CODE_REVISION"),
  headRef: optional("GITHUB_HEAD_REF"),
  refName: optional("GITHUB_REF_NAME"),
  runId: optional("GITHUB_RUN_ID"),
}).pipe(
  Config.map(({ actions, sha, revision, headRef, refName, runId }) => {
    const environment: Environment = actions ? "ci" : "agent";
    const attributes: Record<string, string> = { [RESOURCE_ATTRIBUTES.environment]: environment };
    const commit = Option.orElse(actions ? sha : Option.none(), () => revision);
    if (Option.isSome(commit)) attributes[RESOURCE_ATTRIBUTES.revision] = commit.value;
    if (actions) {
      // A pull request's own branch is GITHUB_HEAD_REF; GITHUB_REF_NAME is then its merge ref.
      const ref = Option.orElse(
        Option.filter(headRef, (name) => name !== ""),
        () => refName,
      );
      if (Option.isSome(ref)) attributes[RESOURCE_ATTRIBUTES.ref] = ref.value;
      if (Option.isSome(runId)) attributes[RESOURCE_ATTRIBUTES.pipelineRun] = runId.value;
    }
    return attributes;
  }),
);

/** The serialization `OTEL_EXPORTER_OTLP_PROTOCOL` asks for: protobuf unless it says `http/json`. */
const serialization = Layer.unwrap(
  Effect.gen(function* () {
    const protocol = yield* Config.String("OTEL_EXPORTER_OTLP_PROTOCOL").pipe(Config.withDefault("http/protobuf"));
    return protocol === "http/json" ? OtlpSerialization.layerJson : OtlpSerialization.layerProtobuf;
  }),
).pipe(Layer.orDie);

/**
 * OTLP export for the process of `producer`, as the standard settings ask; with no endpoint set, it exports nothing
 * and the process's tracer is left as it was. Provided once, at the process's entry: when the process ends, what is
 * left is flushed.
 */
export const exportLayer = (producer: Producer) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const attributes: Record<string, unknown> = yield* RunAttributes;
      return Otlp.layerFromConfig({ resource: { serviceName: producer, attributes } });
    }),
  ).pipe(Layer.orDie, Layer.provide(serialization), Layer.provide(FetchHttpClient.layer));
