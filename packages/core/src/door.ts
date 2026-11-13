// The package's door. The runner deploys `stack` (one stage per run), applies `migrations` to the stage's database
// and calls `CoreRpcs` at the stage's address; a test serves `CoreRpcs` in memory with `Served`.
export { default as stack } from "../alchemy.run.ts";
export { CoreRpcs, Served } from "./server.ts";
export { CoreIdentity } from "./telemetry/middleware.ts";
export { SpanSink, SqlSpanSink } from "./telemetry/sink.ts";
export { keepingTracer, outcomeOf, type KeptSpan, type SpanOutcome } from "./telemetry/spans.ts";

/** The `.sql` files applied to a stage's database when it is created, in name order. */
export const migrations = new URL("../migrations/", import.meta.url);
