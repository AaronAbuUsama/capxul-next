// The collector: one Cloudflare Worker per platform stage, the one door every producer's OTLP goes through
// (docs/design/blueprint.md, the glossary; design-notes/proof-and-telemetry.md, "The telemetry door").
//
//   POST /v1/traces, /v1/logs, /v1/metrics   OTLP JSON: stamped with who sent it (caller.ts, forward.ts), forwarded to
//                                            the sink's dataset of that signal, answered with the sink's answer
//   GET  /health                             `{collector, stage}`
//
// A world's Core reaches it by service binding (its claim in the binding's props); anyone else on the public route
// `<stage>-collector.<domain>`, over HTTP like the site door (one level under the domain, which is all Cloudflare's
// free certificate covers), with an operator's claim. The sink's ingest key is a Worker secret that platform.yml sets
// from CI; a deploy without it (a rehearsal) forwards with no key, and the sink refuses: the counts say so.
//
// After each answer, in `waitUntil`, the collector sends its counts (counts.ts) to the sink's metrics dataset and logs
// them, so Workers Logs (exported to Cloudflare's destination) hold them too.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { cryptoLayer } from "../token.ts";
import { COLLECTOR } from "../names.ts";
import { names } from "../stage.ts";
import { identify } from "./caller.ts";
import { collectorKeyId } from "./key.ts";
import { countsExport, type Outcome } from "./counts.ts";
import { STAMPED } from "./envelope.ts";
import { AXIOM_EDGE, datasetsOf, forward, type Sink, sinkHeaders, stampOf } from "./forward.ts";
import { SIGNALS, stringAttribute, type StringAttribute } from "./otlp-json.ts";

/** The Worker's environment: its own facts, its key, and the sink's. */
export const COLLECTOR_ENV = {
  stage: "COLLECTOR_STAGE",
  script: "COLLECTOR_SCRIPT",
  key: "COLLECTOR_KEY",
  sinkUrl: "SINK_URL",
  sinkKey: "SINK_KEY",
  datasets: "SINK_DATASETS",
} as const;

/**
 * Cloudflare's own logs and traces of the Worker, exported to the account's Axiom destinations: a second view of the
 * platform, read by people, never by a check. Core and the hub's door set the same.
 */
export const CLOUDFLARE_OBSERVABILITY = {
  enabled: true,
  logs: { enabled: true, invocationLogs: true, destinations: ["axiom-capxul-logs"] },
  traces: { enabled: true, destinations: ["axiom-capxul-traces"] },
};

const runtimeProps = () => ({ main: import.meta.url, compatibility: { date: "2026-08-25" } });

const textOf = (value: unknown): Option.Option<string> => {
  const inner = Redacted.isRedacted(value) ? Redacted.value(value) : value;
  return Predicate.isString(inner) && Str.isNonEmpty(inner) ? Option.some(inner) : Option.none();
};

const answer = (status: number, body: Record<string, unknown>) => HttpServerResponse.jsonUnsafe(body, { status });

/** Sends one request's counts to the sink's metrics dataset, and logs them. Never fails: a lost count is logged. */
const report = (
  sink: Sink,
  outcome: Outcome,
  who: {
    readonly script: string;
    readonly own: ReadonlyArray<StringAttribute>;
    readonly stamp: ReadonlyArray<StringAttribute>;
  },
  startNanos: bigint,
) =>
  Effect.gen(function* () {
    const endNanos = yield* Clock.currentTimeNanos;
    yield* Effect.logInfo("collector counts").pipe(
      Effect.annotateLogs({
        signal: outcome.signal,
        items: outcome.items,
        forwarded: outcome.forwarded,
        refused: outcome.refused,
        reason: Option.getOrElse(outcome.reason, () => ""),
        ...Rec.fromEntries(Arr.map(who.stamp, (a) => [a.key, a.value.stringValue] as const)),
      }),
    );
    const client = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.post(`${sink.url}/v1/metrics`).pipe(
      HttpClientRequest.setHeaders(sinkHeaders(sink, "metrics")),
      HttpClientRequest.bodyJsonUnsafe(countsExport(outcome, who, { startNanos, endNanos })),
    );
    const sent = yield* client.execute(request);
    if (sent.status < 200 || sent.status > 299) {
      yield* Effect.logWarning("collector counts refused by the sink").pipe(
        Effect.annotateLogs({ status: sent.status }),
      );
    }
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning("collector counts not sent", cause)),
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- runs in waitUntil after the answer: the Worker's entry, with its own client
    Effect.provide(FetchHttpClient.layer),
  );

export default class Collector extends Cloudflare.Worker<Collector>()(
  COLLECTOR,
  Effect.gen(function* () {
    // Inside the running Worker the stack's files are evaluated again only to name bindings; nothing is read there.
    if ((yield* Alchemy.ALCHEMY_PHASE) === "runtime") return runtimeProps();
    const n = yield* names;
    const zoneId = yield* Config.String("PLATFORM_ZONE_ID");
    const key = yield* Alchemy.Random(yield* collectorKeyId, { bytes: 32 });
    // platform.yml sets it from the CI secret AXIOM_INGEST_TEST. Never read in an agent's container.
    const sinkKey = yield* Config.option(Config.Redacted("COLLECTOR_SINK_KEY"));
    const sinkUrl = yield* Config.String("COLLECTOR_SINK_URL").pipe(Config.withDefault(AXIOM_EDGE));
    const datasets = yield* Config.String("COLLECTOR_DATASETS").pipe(Config.withDefault("capxul-test"));
    return {
      ...runtimeProps(),
      name: n.collector,
      workersDev: false,
      routes: [{ pattern: `${n.collectorHost}/*`, zoneId }],
      observability: CLOUDFLARE_OBSERVABILITY,
      env: {
        [COLLECTOR_ENV.stage]: n.stage,
        [COLLECTOR_ENV.script]: n.collector,
        [COLLECTOR_ENV.key]: key.text,
        [COLLECTOR_ENV.sinkUrl]: sinkUrl,
        [COLLECTOR_ENV.datasets]: datasets,
        ...Option.match(sinkKey, { onNone: () => ({}), onSome: (k) => ({ [COLLECTOR_ENV.sinkKey]: k }) }),
      },
    };
  }),
  Effect.succeed({
    fetch: Effect.gen(function* () {
      const startNanos = yield* Clock.currentTimeNanos;
      const env: Record<string, unknown> = yield* Cloudflare.WorkerEnvironment;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const path = Option.match(HttpServerRequest.toURL(request), { onNone: () => "", onSome: (u) => u.pathname });
      const stage = Option.getOrElse(textOf(env[COLLECTOR_ENV.stage]), () => "");
      const script = Option.getOrElse(textOf(env[COLLECTOR_ENV.script]), () => "");
      if (request.method === "GET" && path === "/health") return answer(200, { collector: script, stage });
      const signal = Arr.findFirst(SIGNALS, (s) => path === `/v1/${s}`);
      if (Option.isNone(signal)) return answer(404, { error: "no-such-route" });
      if (request.method !== "POST") return answer(405, { error: "post-only" });
      const key = textOf(env[COLLECTOR_ENV.key]);
      if (Option.isNone(key)) return answer(503, { error: "no-collector-key" });
      const ctx = yield* Cloudflare.WorkerExecutionContext;
      const props = yield* ctx.props;
      const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
      const claim = { props, authorization: request.headers.authorization };
      const caller = yield* identify(Redacted.make(key.value), claim, now).pipe(
        // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the Worker's fetch is its entry point: WebCrypto's HMAC for the claim
        Effect.provide(cryptoLayer),
        Effect.orDie,
      );
      if (caller._tag === "Refused") return answer(caller.status, { error: caller.error });
      const sink: Sink = {
        url: Option.getOrElse(textOf(env[COLLECTOR_ENV.sinkUrl]), () => AXIOM_EDGE),
        key: Option.map(textOf(env[COLLECTOR_ENV.sinkKey]), (k) => Redacted.make(k)),
        datasets: datasetsOf(Option.getOrElse(textOf(env[COLLECTOR_ENV.datasets]), () => "capxul-test")),
      };
      const done = yield* forward(sink, stage, signal.value, caller.claims).pipe(
        // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the Worker's fetch is its entry point: the client that reaches the sink
        Effect.provide(FetchHttpClient.layer),
      );
      if (Option.isSome(done.outcome)) {
        const who = {
          script,
          own: [stringAttribute(STAMPED.stage, stage)],
          stamp: stampOf(stage, caller.claims),
        };
        yield* Cloudflare.waitUntil(report(sink, done.outcome.value, who, startNanos));
      }
      return done.response;
    }),
  }),
) {}
