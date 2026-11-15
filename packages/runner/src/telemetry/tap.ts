// The tap: in a test world, Core writes the OTLP it exports into the world's database as well (`telemetry.otlp`: the
// trace id, the signal, the body), and the runner reads a call's spans back from it by trace id, as it reads
// `app.spans` today (roadmap 4.4; design note "Proof and telemetry", section 7).
//
// STUB. The builder of "the runner reads the tap beside app.spans" replaces this body: query `telemetry.otlp` for the
// trace ids, decode each traces body with otlp.ts, flatten it with flat.ts, and retry briefly until the operation's
// span is there. Until then it reads nothing, so parity (parity.ts) fails on every call.
import type * as Redacted from "effect/Redacted";
import * as Effect from "effect/Effect";
import type { FlatSpan } from "./flat.ts";

/** Every span the tap holds under the given trace ids, flat. */
export const tapOf = (
  _database: Redacted.Redacted,
  _traceIds: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<FlatSpan>> => Effect.succeed([]);
