// Where the spans of a call go, besides its OTLP export (telemetry/export.ts): in a world, nowhere else
// (`ExportedSpans`); on the platform, its own table (packages/world); in a test, memory.
import type * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { KeptSpan } from "./spans.ts";

export class SpanSink extends Context.Service<
  SpanSink,
  {
    /** Keeps the spans of one call. A failure to keep them is a defect of the call. */
    readonly keep: (spans: Arr.NonEmptyReadonlyArray<KeptSpan>) => Effect.Effect<void>;
  }
>()("@capxul/core/telemetry/sink/SpanSink") {}

/**
 * A world's Core keeps no spans itself: every span of a call leaves through its OTLP export (telemetry/export.ts), to
 * the collector and, in a test world, the tap, where the runner reads them back. `app.spans` is gone
 * (migrations/0012_core_drop_spans.sql). The call's spans are still gathered (spans.ts), for the call's own
 * attributes and for a sink that does keep them: the platform's (packages/world) and a test's.
 */
export const ExportedSpans = Layer.succeed(SpanSink, SpanSink.of({ keep: () => Effect.void }));
