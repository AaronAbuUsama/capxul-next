// Core's export of its telemetry over OTLP, beside the spans the sink keeps in `app.spans` (sink.ts). Each request
// builds Effect's `Otlp.layer` into its own scope, which Cloudflare closes in `ctx.waitUntil` after the answer has
// left (Alchemy's Worker bridge): the flush runs then, so export adds nothing to the caller's time or to `serverMs`.
//
// Every body the exporters make goes two ways, as the same OTLP JSON:
//   the collector   a service binding read from the environment (`ENV.collector`); with none, nothing goes out
//   the tap         in a test world only (`ENV.tap`, set by packages/world from the world's grade): a row of
//                   `telemetry.otlp` in the world's database (migrations/0010_core_telemetry_otlp.sql), written
//                   through a database pool of its own, opened and closed in the same scope after the answer
//
// The tracer is not made ambient: only `measured` (spans.ts) uses it, as the inner tracer of a call's keeping
// tracer, so the spans exported are the spans kept, with the same ids, names, parents and attributes, and no others.
// Logs and metrics are exported as Effect's OTLP logger and metrics make them.
import * as SQL from "@alchemy.run/sql/Postgres";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Str from "effect/String";
import type * as Redacted from "effect/Redacted";
import * as Tracer from "effect/Tracer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Otlp from "effect/observability/Otlp";
import * as OtlpExporter from "effect/observability/OtlpExporter";
import { ENV, textOf } from "../env.ts";
import { CallTracer } from "./spans.ts";

/** The value of `ENV.tap` that turns the tap on. */
export const TAP_ON = "on";

/** The name every export of Core carries as its resource's `service.name`. */
export const SERVICE_NAME = "capxul-core";

/** Where the exporters post: the host is never reached, the binding's own Worker answers every path. */
const BASE_URL = "https://collector";

/** OTLP's three signals, by the last part of the path each is posted to. */
export const SIGNALS = ["traces", "logs", "metrics"] as const;
export type Signal = (typeof SIGNALS)[number];

/** The trace ids a body of each signal carries, as a JSON path into it. Metrics carry none. */
const TRACE_IDS: Record<Signal, string | null> = {
  traces: "$.resourceSpans[*].scopeSpans[*].spans[*].traceId",
  logs: "$.resourceLogs[*].scopeLogs[*].logRecords[*].traceId",
  metrics: null,
};

/** What a Worker's service binding offers: Cloudflare's `fetch`, on the bound Worker. */
interface Fetcher {
  readonly fetch: (request: Request) => Promise<Response>;
}

const isFetcher = (value: unknown): value is Fetcher =>
  Predicate.hasProperty(value, "fetch") && Predicate.isFunction(value.fetch);

/** Writes one OTLP body to `telemetry.otlp`, once per trace it carries (none for metrics: one row, no trace id). */
export type TapWrite = (signal: Signal, body: string) => Effect.Effect<void>;

/** The tap, written through `sql`: the world's database. A failure to write is logged, never the call's. */
export const sqlTap =
  (sql: PgClient.PgClient): TapWrite =>
  (signal, body) => {
    const path = TRACE_IDS[signal];
    const statement =
      path === null
        ? sql`insert into telemetry.otlp (trace_id, signal, body) values (null, ${signal}, ${body}::jsonb)`
        : sql`insert into telemetry.otlp (trace_id, signal, body)
            select distinct ids.trace_id, ${signal}, given.body
            from (select ${body}::jsonb as body) given
            cross join lateral (
              select value #>> '{}' as trace_id from jsonb_path_query(given.body, ${path}::jsonpath) as found(value)
            ) ids
            where ids.trace_id <> ''`;
    return statement.pipe(
      Effect.asVoid,
      Effect.catch((error) => Effect.logWarning("the tap could not write to telemetry.otlp", error)),
    );
  };

const signalOf = (url: URL): Option.Option<Signal> =>
  Arr.findFirst(SIGNALS, (signal) => Str.endsWith(`/${signal}`)(url.pathname));

const decoder = new TextDecoder();

/** The text of a body the OTLP exporters made: JSON, as `OtlpSerialization.layerJson` writes it. */
const textOfBody = (request: HttpClientRequest.HttpClientRequest): Option.Option<string> =>
  request.body._tag === "Uint8Array" ? Option.some(decoder.decode(request.body.body)) : Option.none();

const transportError = (request: HttpClientRequest.HttpClientRequest, cause: unknown) =>
  new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request, cause }) });

/**
 * The client the exporters post through: each body goes to the collector over its binding, when there is one, and
 * to the tap, when it is on. With no collector, the post is answered as accepted once the tap has it.
 */
export const transport = (collector: Option.Option<Fetcher>, tap: Option.Option<TapWrite>): HttpClient.HttpClient =>
  HttpClient.make((request, url) =>
    Effect.gen(function* () {
      const signal = signalOf(url);
      const body = textOfBody(request);
      if (Option.isSome(tap) && Option.isSome(signal) && Option.isSome(body))
        yield* tap.value(signal.value, body.value);
      if (Option.isNone(collector)) return HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }));
      const binding = collector.value;
      const web = yield* HttpClientRequest.toWeb(request).pipe(
        Effect.mapError((cause) => transportError(request, cause)),
      );
      const answer = yield* Effect.tryPromise({
        try: () => binding.fetch(web),
        catch: (cause) => transportError(request, cause),
      });
      return HttpClientResponse.fromWeb(request, answer);
    }),
  );

/** Who is exporting: the resource every export carries. */
export interface Exporting {
  readonly world: string;
  /** The code's revision, bound at deploy (`ENV.revision`); `unknown` when the deploy had none. */
  readonly revision: string;
}

/**
 * Effect's OTLP exporters for one request, posting through `client`. Nothing is exported before the scope closes:
 * the interval is longer than any request, and the flush runs as the scope closes, after the answer.
 */
export const exporters = (exporting: Exporting, client: HttpClient.HttpClient) =>
  Otlp.layerJson({
    baseUrl: BASE_URL,
    resource: {
      serviceName: SERVICE_NAME,
      serviceVersion: exporting.revision,
      attributes: { "service.namespace": "capxul", "deployment.environment.name": exporting.world },
    },
    loggerExportInterval: Duration.hours(1),
    metricsExportInterval: Duration.hours(1),
    tracerExportInterval: Duration.hours(1),
    shutdownTimeout: Duration.seconds(10),
  }).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client)));

/** What the request runs with when it exports: every service of the exporters but the tracer, and `CallTracer`. */
const exportContext = (built: Context.Context<OtlpExporter.Flusher>) =>
  Effect.gen(function* () {
    const tracer = Context.get(built, Tracer.Tracer);
    const flusher = Context.get(built, OtlpExporter.Flusher);
    // The flush runs first as the scope closes, then each exporter's own shutdown, then the tap's pool closes.
    yield* Effect.addFinalizer(() => Effect.ignore(Effect.timeoutOption(flusher.flush, Duration.seconds(10))));
    return Context.add(Context.omit(Tracer.Tracer)(built), CallTracer, Option.some(tracer));
  });

/**
 * The export of one request, built into the request's scope from what its environment binds: the collector, the
 * tap and the revision. With neither collector nor tap, nothing is built and nothing is exported.
 */
export const requestExport = (
  env: Record<string, unknown>,
  world: string,
  database: Effect.Effect<Redacted.Redacted>,
) =>
  Effect.gen(function* () {
    const bound = env[ENV.collector];
    const collector = isFetcher(bound) ? Option.some(bound) : Option.none<Fetcher>();
    const tapOn = Option.contains(textOf(env[ENV.tap]), TAP_ON);
    if (Option.isNone(collector) && !tapOn) return Option.none<Context.Context<never>>();
    // The tap's own pool, built before the exporters so it closes after their flush.
    const tap = tapOn
      ? Option.some(
          yield* Layer.build(SQL.PostgresLayer({ url: database, prepare: false })).pipe(
            Effect.map((context) => sqlTap(Context.get(context, PgClient.PgClient))),
          ),
        )
      : Option.none<TapWrite>();
    const revision = Option.getOrElse(textOf(env[ENV.revision]), () => "unknown");
    const built = yield* Layer.build(exporters({ world, revision }, transport(collector, tap)));
    return Option.some(yield* exportContext(built));
  });
