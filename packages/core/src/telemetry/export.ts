// Core's export of its telemetry over OTLP, beside the spans the sink keeps in `app.spans` (sink.ts). Each request
// builds Effect's `Otlp.layer` into its own scope, which Cloudflare closes in `ctx.waitUntil` after the answer has
// left (Alchemy's Worker bridge): the flush runs then, so export adds nothing to the caller's time or to `serverMs`.
//
// Every body the exporters make goes two ways, as the same OTLP JSON:
//   the collector   a service binding read from the environment (`ENV.collector`); with none, nothing goes out
//   the tap         in a test world only (`ENV.tap`, set by packages/world from the world's grade): its traces and
//                   logs are held, and written after the flush into `telemetry.otlp` in the world's database
//                   (migrations/0010_core_telemetry_otlp.sql) in one statement, through a pool of its own
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
import type * as Headers from "effect/http/Headers";
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

/**
 * Core's `service.name` on every export: the producer name the blueprint's envelope gives Core (#301,
 * packages/blueprint/src/telemetry/producers.ts on slice/blueprint). It moves to an import from the blueprint when #301
 * reaches master.
 */
export const SERVICE_NAME = "capxul-api";

/** Where the exporters post over the binding: the host is never reached, the bound Worker answers every path. */
const BINDING_URL = "https://collector";

/** OTLP's three signals, by the last part of the path each is posted to. */
export const SIGNALS = ["traces", "logs", "metrics"] as const;
export type Signal = (typeof SIGNALS)[number];

/** What a Worker's service binding offers: Cloudflare's `fetch`, on the bound Worker. */
interface Fetcher {
  readonly fetch: (request: Request) => Promise<Response>;
}

const isFetcher = (value: unknown): value is Fetcher =>
  Predicate.hasProperty(value, "fetch") && Predicate.isFunction(value.fetch);

/** One OTLP JSON body the exporters made, held for the tap. */
export interface Held {
  readonly signal: Signal;
  readonly body: string;
}

/**
 * Writes every body a request exported into `telemetry.otlp` in ONE statement, after every exporter has flushed: a
 * row per trace id a body carries, the body whole as jsonb. Traces and logs only; metrics carry no trace and stay
 * out. So a reader that sees a call's operation span in the tap sees every span and log of that request with it.
 * A failure to write is logged, never the call's.
 */
export const writeTap = (sql: PgClient.PgClient, held: ReadonlyArray<Held>) =>
  Arr.match(
    Arr.filter(held, (each) => each.signal !== "metrics"),
    {
      onEmpty: () => Effect.void,
      onNonEmpty: (bodies) =>
        sql`insert into telemetry.otlp (trace_id, signal, body)
          select distinct ids.trace_id, given.signal, given.body
          from (values ${sql.csv(Arr.map(bodies, (each) => sql`(${each.signal}, ${each.body}::jsonb)`))}) as given(signal, body)
          cross join lateral (
            select value #>> '{}' as trace_id
            from jsonb_path_query(
              given.body,
              case given.signal
                when 'traces' then '$.resourceSpans[*].scopeSpans[*].spans[*].traceId'::jsonpath
                else '$.resourceLogs[*].scopeLogs[*].logRecords[*].traceId'::jsonpath
              end
            ) as found(value)
          ) ids
          where ids.trace_id <> ''`.pipe(
          Effect.asVoid,
          Effect.catch((error) => Effect.logWarning("the tap could not write to telemetry.otlp", error)),
        ),
    },
  );

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
 * is handed to `hold`, the tap, when it is on. With no collector, the post is answered as accepted.
 */
export const transport = (
  collector: Option.Option<Fetcher>,
  hold: Option.Option<(held: Held) => void>,
): HttpClient.HttpClient =>
  HttpClient.make((request, url) =>
    Effect.gen(function* () {
      const signal = signalOf(url);
      const body = textOfBody(request);
      if (Option.isSome(hold) && Option.isSome(signal) && Option.isSome(body))
        hold.value({ signal: signal.value, body: body.value });
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

export interface ExportOptions {
  /** The collector's base URL: `/v1/traces`, `/v1/logs` and `/v1/metrics` are below it. */
  readonly baseUrl: string;
  /** The code's revision, the resource's `service.version`. */
  readonly revision: string;
  /** Sent with every export: the operator's platform token, for a caller outside Cloudflare. */
  readonly headers?: Headers.Input | undefined;
}

/**
 * Core's OTLP export: Effect's exporters of traces, logs and metrics, posting OTLP/JSON below `baseUrl` through the
 * `HttpClient` it is given, under a resource naming Core (`service.name`) and the code's revision (`service.version`).
 * Nothing is posted before its scope closes: the intervals are longer than any request, and the flush runs as the
 * scope closes. It provides the tracer as Effect's ambient one; the Worker moves it to `CallTracer` (below).
 */
export const coreTelemetry = (options: ExportOptions) =>
  Otlp.layerJson({
    baseUrl: options.baseUrl,
    headers: options.headers,
    resource: { serviceName: SERVICE_NAME, serviceVersion: options.revision },
    loggerExportInterval: Duration.hours(1),
    metricsExportInterval: Duration.hours(1),
    tracerExportInterval: Duration.hours(1),
    shutdownTimeout: Duration.seconds(10),
  });

/** What the request runs with when it exports: every service of the exporters but the tracer, and `CallTracer`. */
const exportContext = (built: Context.Context<OtlpExporter.Flusher>) =>
  Effect.gen(function* () {
    const tracer = Context.get(built, Tracer.Tracer);
    const flusher = Context.get(built, OtlpExporter.Flusher);
    // As the scope closes: this flush first, then each exporter's own shutdown, then the tap's write and its pool.
    yield* Effect.addFinalizer(() => Effect.ignore(Effect.timeoutOption(flusher.flush, Duration.seconds(10))));
    return Context.add(Context.omit(Tracer.Tracer)(built), CallTracer, Option.some(tracer));
  });

/**
 * The export of one request, built into the request's scope from what its environment binds: the collector, the
 * tap and the revision. With neither collector nor tap, nothing is built and nothing is exported.
 */
export const requestExport = (env: Record<string, unknown>, database: Effect.Effect<Redacted.Redacted>) =>
  Effect.gen(function* () {
    const bound = env[ENV.collector];
    const collector = isFetcher(bound) ? Option.some(bound) : Option.none<Fetcher>();
    const tapOn = Option.contains(textOf(env[ENV.tap]), TAP_ON);
    if (Option.isNone(collector) && !tapOn) return Option.none<Context.Context<never>>();
    // The tap's pool and its write are set up before the exporters, so both run after the exporters have flushed.
    const held: Array<Held> = [];
    if (tapOn) {
      const sql = Context.get(
        yield* Layer.build(SQL.PostgresLayer({ url: database, prepare: false })),
        PgClient.PgClient,
      );
      yield* Effect.addFinalizer(() => writeTap(sql, held));
    }
    const hold = tapOn ? Option.some((each: Held) => void held.push(each)) : Option.none<(held: Held) => void>();
    const revision = Option.getOrElse(textOf(env[ENV.revision]), () => "unknown");
    const client = transport(collector, hold);
    const built = yield* Layer.build(
      coreTelemetry({ baseUrl: BINDING_URL, revision }).pipe(
        Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
      ),
    );
    return Option.some(yield* exportContext(built));
  });
