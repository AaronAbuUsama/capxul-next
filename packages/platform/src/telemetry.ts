// Where a process of ours sends its telemetry (roadmap 4.4): OTLP/HTTP JSON, through Effect's own exporter
// (`effect/observability`, no OpenTelemetry SDK), to the collector. Each producer has its layer, named by the producer
// and given where to send and the code's revision: `platformTelemetry` here, the runner's `runnerTelemetry`
// (packages/runner, src/telemetry/export.ts) and the world's `worldTelemetry` (packages/world,
// src/common/telemetry.ts), each built by `exportLayer`. Each entry provides its producer's once, through
// `exportFromConfig`, which reads OpenTelemetry's standard settings:
//
//   OTEL_EXPORTER_OTLP_ENDPOINT   the collector's base URL, e.g. http://127.0.0.1:4318. With none, nothing is exported
//                                 and the process's tracer and logger are left as they were.
//   OTEL_TRACES_EXPORTER          `none` turns a signal off (also OTEL_LOGS_EXPORTER, OTEL_METRICS_EXPORTER); unset or
//                                 `otlp`, it is on
//   OTEL_EXPORTER_OTLP_HEADERS    headers for the collector, `key=value,key=value`, e.g. the operator's platform token
//                                 for a caller outside Cloudflare; never logged
//
// The resource names the producer (`service.name`, #301's producers) and the revision (`service.version`), and says
// whether the run can be trusted: only a run in GitHub Actions is, which also names the pipeline's run, the commit and
// the ref (collector/envelope.ts).
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Result from "effect/Result";
import * as Str from "effect/String";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as Headers from "effect/http/Headers";
import type * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as OtlpExporter from "effect/observability/OtlpExporter";
import * as OtlpLogger from "effect/observability/OtlpLogger";
import * as OtlpMetrics from "effect/observability/OtlpMetrics";
import * as OtlpSerialization from "effect/observability/OtlpSerialization";
import * as OtlpTracer from "effect/observability/OtlpTracer";
import { RUN_ATTRIBUTES } from "./collector/envelope.ts";

/** Each producer's `service.name`: the blueprint's `producers` (#301), named here until that reaches master. */
export const PRODUCERS = {
  runner: "capxul-runner",
  world: "capxul-world",
  sites: "capxul-sites-client",
} as const;
export type Producer = (typeof PRODUCERS)[keyof typeof PRODUCERS];

/** The three signals, each on unless its exporter setting says `none`. */
export interface Signals {
  readonly traces: boolean;
  readonly logs: boolean;
  readonly metrics: boolean;
}

const ALL: Signals = { traces: true, logs: true, metrics: true };

export interface ExportOptions {
  /** The collector's base URL: `/v1/traces`, `/v1/logs` and `/v1/metrics` are below it. */
  readonly baseUrl: string;
  /** The code's revision, the resource's `service.version`. */
  readonly revision: string;
  /** Sent with every export: the operator's platform token, for a caller outside Cloudflare. */
  readonly headers?: Headers.Input | undefined;
  /** More of the resource: the run's (`RunAttributes`). */
  readonly attributes?: Readonly<Record<string, unknown>> | undefined;
  /** Which signals are exported; all three when left out. */
  readonly signals?: Signals | undefined;
}

/** The layer each producer's export is: OTLP JSON to `baseUrl`, under a resource naming the producer and revision. */
export type ExportLayer = Layer.Layer<OtlpExporter.Flusher, never, HttpClient.HttpClient>;

/** The export of `producer`, by `options`. */
export const exportLayer = (producer: Producer, options: ExportOptions): ExportLayer => {
  const resource = {
    serviceName: producer,
    serviceVersion: options.revision,
    attributes: { ...options.attributes },
  };
  const base = HttpClientRequest.get(options.baseUrl);
  const url = (path: string) => HttpClientRequest.appendUrl(base, path).url;
  const signals = options.signals ?? ALL;
  const common = { resource, headers: options.headers };
  return Layer.mergeAll(
    OtlpExporter.layerFlusher,
    signals.traces ? OtlpTracer.layer({ ...common, url: url("/v1/traces") }) : Layer.empty,
    signals.logs ? OtlpLogger.layer({ ...common, url: url("/v1/logs") }) : Layer.empty,
    signals.metrics ? OtlpMetrics.layer({ ...common, url: url("/v1/metrics") }) : Layer.empty,
  ).pipe(Layer.provide(OtlpSerialization.layerJson));
};

/** Provides the platform client's OTLP export (its entries, run-*.ts). */
export const platformTelemetry = (options: ExportOptions): ExportLayer => exportLayer(PRODUCERS.sites, options);

const optional = (name: string) => Config.option(Config.String(name));

/**
 * The run's resource attributes and the code's revision, from the environment: GitHub Actions' own variables in CI,
 * and `CODE_REVISION` elsewhere (each run.sh sets it from `git rev-parse HEAD` when it is not set).
 */
export const RunAttributes = Config.all({
  actions: Config.Boolean("GITHUB_ACTIONS").pipe(Config.withDefault(false)),
  sha: optional("GITHUB_SHA"),
  codeRevision: optional("CODE_REVISION"),
  headRef: optional("GITHUB_HEAD_REF"),
  refName: optional("GITHUB_REF_NAME"),
  runId: optional("GITHUB_RUN_ID"),
}).pipe(
  Config.map(({ actions, sha, codeRevision, headRef, refName, runId }) => {
    const revision = Option.getOrElse(
      Option.orElse(actions ? sha : Option.none(), () => codeRevision),
      () => "unknown",
    );
    const attributes: Record<string, unknown> = {
      [RUN_ATTRIBUTES.trusted]: actions,
      [RUN_ATTRIBUTES.revision]: revision,
    };
    if (actions) {
      // A pull request's own branch is GITHUB_HEAD_REF; GITHUB_REF_NAME is then its merge ref.
      const ref = Option.orElse(
        Option.filter(headRef, (name) => name !== ""),
        () => refName,
      );
      if (Option.isSome(ref)) attributes[RUN_ATTRIBUTES.ref] = ref.value;
      if (Option.isSome(runId)) attributes[RUN_ATTRIBUTES.pipelineRun] = runId.value;
    }
    return { revision, attributes };
  }),
);

/** OTEL_EXPORTER_OTLP_HEADERS as OpenTelemetry writes it: `key=value` pairs split by commas, each URI-encoded. */
const headersOf = (text: string): Record<string, string> =>
  Rec.fromEntries(
    Arr.filterMap(Str.split(",")(text), (pair) =>
      Option.match(
        Option.filter(Str.indexOf("=")(pair), (at) => at > 0),
        {
          onNone: () => Result.failVoid,
          onSome: (at) =>
            Result.succeed([
              Str.trim(decodeURIComponent(Str.slice(0, at)(pair))),
              Str.trim(decodeURIComponent(Str.slice(at + 1)(pair))),
            ] as const),
        },
      ),
    ),
  );

/** A signal is on unless its exporter setting names `none`. */
const isOn = (signal: "TRACES" | "LOGS" | "METRICS") =>
  Config.String(`OTEL_${signal}_EXPORTER`).pipe(
    Config.map((value) => Str.toLowerCase(Str.trim(value)) !== "none"),
    Config.withDefault(true),
  );

/** The standard settings, read once at an entry. */
const Settings = Config.all({
  endpoint: optional("OTEL_EXPORTER_OTLP_ENDPOINT"),
  headers: Config.String("OTEL_EXPORTER_OTLP_HEADERS").pipe(Config.map(headersOf), Config.withDefault({})),
  traces: isOn("TRACES"),
  logs: isOn("LOGS"),
  metrics: isOn("METRICS"),
});

/** Where an entry sends, when it knows better than the settings: a collector it found, and the claim it minted. */
export interface Target {
  readonly baseUrl: string;
  readonly headers: Headers.Input;
}

/**
 * A producer's export as the standard settings ask, sent with fetch: `make` is its layer (`runnerTelemetry`, ...).
 * An endpoint set in the settings wins; otherwise `target`, when the entry found one (the runner's collector,
 * packages/runner src/telemetry/export.ts); with neither, nothing. Flushed when the entry's program ends.
 */
export const exportFromConfig = (
  make: (options: ExportOptions) => ExportLayer,
  target: Option.Option<Target> = Option.none(),
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const settings = yield* Settings;
      const run = yield* RunAttributes;
      const to: Option.Option<Target> = Option.isSome(settings.endpoint)
        ? Option.some({ baseUrl: settings.endpoint.value, headers: settings.headers })
        : target;
      if (Option.isNone(to)) return Layer.empty;
      return make({
        baseUrl: to.value.baseUrl,
        revision: run.revision,
        headers: to.value.headers,
        attributes: run.attributes,
        signals: { traces: settings.traces, logs: settings.logs, metrics: settings.metrics },
      });
    }),
  ).pipe(Layer.orDie, Layer.provide(FetchHttpClient.layer));
