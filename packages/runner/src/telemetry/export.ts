// The runner's OTLP export (roadmap 4.4): the layer its entry (main.ts) provides once, so every span, log and metric it
// makes is posted over OTLP/HTTP JSON to the collector, under a resource naming the producer (`service.name`:
// "capxul-runner", #301's producer) and the code's revision (`service.version`). The world's code the runner runs in
// its own process (the platform it serves, the resets) exports through it too. Built by packages/platform's
// `exportLayer`, the one implementation of every producer's.
//
// Where it sends (`runnerExport`):
//
//   OTEL_EXPORTER_OTLP_ENDPOINT   set: there, with OTEL_EXPORTER_OTLP_HEADERS, as any entry does (a local receiver)
//   RUNNER_COLLECTOR=<stage>      otherwise: the public route of that platform stage's collector, with a claim minted
//                                 for the run's operator (WORLD_OWNER) under the collector's key, read from the shared
//                                 state. In GitHub Actions it is `staging` unless set; elsewhere, unset, nothing.
//
// A stage with no collector yet, or a state that cannot be read, exports nothing and fails nothing: the run goes on,
// and says so in one log line. The claim is never logged.
import { exportFromConfig, exportLayer, PRODUCERS, publicCollector, STAGING } from "@capxul/platform";
import type { ExportLayer, ExportOptions, Target } from "@capxul/platform";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Alchemist from "alchemy/Alchemist";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

export type { ExportOptions };

/** Provides the runner's OTLP export. */
export const runnerTelemetry = (options: ExportOptions): ExportLayer => exportLayer(PRODUCERS.runner, options);

/** How long a run's claim is good for: longer than any run (its hub lives four hours). */
export const CLAIM_LIFETIME = Duration.hours(6);

/** The collector the run sends to, when the settings name none: `RUNNER_COLLECTOR`, or `staging` in CI. */
const CollectorSettings = Config.all({
  endpoint: Config.option(Config.String("OTEL_EXPORTER_OTLP_ENDPOINT")),
  stage: Config.option(Config.String("RUNNER_COLLECTOR")),
  actions: Config.Boolean("GITHUB_ACTIONS").pipe(Config.withDefault(false)),
  operator: Config.String("WORLD_OWNER").pipe(Config.withDefault("runner")),
});

/** The stage whose collector the run sends to, if any. */
export const collectorStage = (settings: {
  readonly stage: Option.Option<string>;
  readonly actions: boolean;
}): Option.Option<string> =>
  Option.orElse(
    Option.filter(settings.stage, (stage) => stage !== ""),
    () => (settings.actions ? Option.some(STAGING) : Option.none()),
  );

/** The collector's public route and the run's claim, or none: no stage chosen, no collector there, or no state. */
const collectorTarget = Effect.gen(function* () {
  const settings = yield* CollectorSettings;
  if (Option.isSome(settings.endpoint)) return Option.none<Target>();
  const stage = collectorStage(settings);
  if (Option.isNone(stage)) return Option.none<Target>();
  const expires = Math.floor((yield* Clock.currentTimeMillis) / 1000 + Duration.toSeconds(CLAIM_LIFETIME));
  const found = yield* publicCollector(stage.value, settings.operator, expires).pipe(
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(
          `telemetry: the collector of ${stage.value} could not be read, so nothing is exported: ${Cause.pretty(cause)}`,
        ),
        Option.none(),
      ),
    ),
  );
  if (Option.isNone(found)) {
    yield* Effect.logInfo(`telemetry: ${stage.value} has no collector, so nothing is exported`);
    return Option.none<Target>();
  }
  yield* Effect.logInfo(`telemetry: exporting to the collector of ${stage.value} as ${settings.operator}`);
  return Option.some<Target>({
    baseUrl: found.value.url,
    headers: { authorization: `Bearer ${Redacted.value(found.value.claim)}` },
  });
}).pipe(Effect.orElseSucceed(() => Option.none<Target>()));

/**
 * The runner's export, wherever the settings or the collector send it; nothing when neither does. It reads the shared
 * state with services of its own, so the entry provides it beside the program's other layers.
 */
export const runnerExport = Layer.unwrap(
  Effect.map(collectorTarget, (target) => exportFromConfig(runnerTelemetry, target)),
).pipe(Layer.provide(Layer.mergeAll(Alchemist.layer(), BunServices.layer, FetchHttpClient.layer)));
