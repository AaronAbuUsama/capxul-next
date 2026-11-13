// The package's door. The runner deploys `stack` (one stage per run), applies `migrations` to the stage's database
// and calls the stage's two doors, at `PLATFORM_PATH` and `WORLD_PATH` of its address, through the SDK. A test
// serves both groups in memory as `CoreRpcs`, with `Served`.
export { default as stack } from "../alchemy.run.ts";
export { PLATFORM_PATH, serveDoors, WORLD_PATH } from "./doors.ts";
export { CoreRpcs, Served } from "./server.ts";
export { CoreIdentity } from "./telemetry/middleware.ts";
export { SpanSink, SqlSpanSink } from "./telemetry/sink.ts";
export { keepingTracer, outcomeOf, type KeptSpan, type SpanOutcome } from "./telemetry/spans.ts";

/** The `.sql` files applied to a stage's database when it is created, in name order. */
export const migrations = new URL("../migrations/", import.meta.url);
