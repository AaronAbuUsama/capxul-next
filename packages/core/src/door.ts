// The package's door. The runner deploys `stack` (one stage per run), applies `migrations` to the stage's database
// and calls the stage's two doors, at `PLATFORM_PATH` and `WORLD_PATH` of its address, through the SDK. A test
// serves both groups in memory as `CoreRpcs`, with `Served`.
export { default as stack } from "../alchemy.run.ts";
export { PLATFORM_PATH, serveDoors, WORLD_PATH } from "./doors.ts";
export { CoreRpcs, Served, ServedEmpty } from "./server.ts";
export { CoreIdentity, PlatformSignInLive, TelemetryLive } from "./telemetry/middleware.ts";
export { default as CoreWorker } from "./worker.ts";
export { CoreDeployment, type Deployment } from "./stack/deployment.ts";
export { ENV as CORE_ENV } from "./env.ts";
export { HEALTH_PATH, PROBE_PATH } from "./probe.ts";
export { SiteDoor, SiteDoorFailed, type SiteAnswer, type SiteCall } from "./site/SiteDoor.ts";
export { SpanSink, SqlSpanSink } from "./telemetry/sink.ts";
export { SERVICE_NAME, TAP_ON } from "./telemetry/export.ts";
export { Placement, SPAN_ATTRIBUTES, SpanAttributes, type Where } from "./telemetry/attributes.ts";
export { keepingTracer, outcomeOf, type KeptSpan, type SpanOutcome } from "./telemetry/spans.ts";

/** Core's Worker module, as Alchemy bundles it: what a local Core (packages/runner, `--core=local`) builds too. */
export const CORE_WORKER_MAIN = `${import.meta.dirname}/worker.ts`;

/** The `.sql` files applied to a stage's database when it is created, in name order. */
export const migrations = new URL("../migrations/", import.meta.url);
