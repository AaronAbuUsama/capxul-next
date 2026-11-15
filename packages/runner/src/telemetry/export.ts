// The runner's OTLP export (roadmap 4.4): the layer its entry (main.ts) provides once, through `exportFromConfig`, so
// every span, log and metric it makes is posted over OTLP/HTTP JSON to `baseUrl` (the collector), under a resource
// naming the producer (`service.name`: "capxul-runner", #301's producer) and the code's revision (`service.version`).
// The world's code the runner runs in its own process (the platform it serves, the resets) exports through it too.
// Built by packages/platform's `exportLayer`, the one implementation of every producer's.
import { exportLayer, PRODUCERS, type ExportLayer, type ExportOptions } from "@capxul/platform";

export type { ExportOptions };

/** Provides the runner's OTLP export. */
export const runnerTelemetry = (options: ExportOptions): ExportLayer => exportLayer(PRODUCERS.runner, options);
