// Side by side (roadmap 4.4): for every call a run made through its own stage's door, the spans Core kept in
// `app.spans` beside the spans the tap holds of it (tap.ts), and their parity (parity.ts), for the run record. The
// generic checks still read `app.spans` alone until the flip. This is the runner's plumbing: a disagreement while the
// tap is on fails the run as the runner's own failure, never as a check's.
//
// While a world's Core writes no tap (`CAPXUL_TAP` off), `telemetry.otlp` is empty: the tap is `absent`, nothing is
// waited for and nothing fails.
import { servedBy } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import type { Call } from "../client.ts";
import type { TapRecord } from "../record.ts";
import type { Kept, SpanRow } from "../world/database.ts";
import { PlatformKept } from "../worlds/kept.ts";
import type { FlatSpan } from "./flat.ts";
import { parity } from "./parity.ts";
import { tapFor, tapIsOn, WAIT, type Tapped, type Wait } from "./tap.ts";

type CallParity = TapRecord["calls"][number];

const keptSummary = (row: SpanRow) => ({
  spanId: row.span_id,
  parentSpanId: row.parent_span_id,
  name: row.name,
  outcome: row.outcome,
  durationMs: row.duration_ms,
});

const tappedSummary = (span: FlatSpan) => ({
  spanId: span.spanId,
  parentSpanId: span.parentSpanId,
  name: span.name,
  outcome: span.status,
  durationMs: span.durationMs,
});

const spansOf = (kept: Kept, call: Call) => Arr.filter(kept.spans, (span) => span.trace_id === call.traceId);

/** One call's two records and their parity. A call neither record holds anything of agrees. */
export const callParity = (
  call: Pick<Call, "traceId" | "operation">,
  kept: ReadonlyArray<SpanRow>,
  tapped: Tapped | undefined,
): CallParity => {
  const spans = tapped !== undefined && tapped.complete ? tapped.spans : [];
  const both = Arr.isReadonlyArrayEmpty(kept) && Arr.isReadonlyArrayEmpty(spans) ? null : parity(kept, spans);
  return {
    traceId: call.traceId,
    operation: call.operation,
    complete: tapped?.complete ?? false,
    agrees: both?.agrees ?? true,
    kept: Arr.map(kept, keptSummary),
    tapped: Arr.map(spans, tappedSummary),
    differences: both?.differences ?? [],
  };
};

/**
 * Every call through the stage's own door, side by side. A call with a span in `app.spans` waits up to `wait` for its
 * operation span in the tap; a call with none (rejected before Core, unanswered) is read once.
 */
export const sideBySide = (
  database: Redacted.Redacted,
  calls: ReadonlyArray<Call>,
  kept: Kept,
  wait: Wait = WAIT,
): Effect.Effect<TapRecord, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const platform = yield* Effect.serviceOption(PlatformKept);
    const own = Arr.filter(
      calls,
      (call) => call.at === null && !(Option.isSome(platform) && servedBy(call.operation) === "platform"),
    );
    if (Arr.isReadonlyArrayEmpty(own) || !(yield* tapIsOn(database))) return { state: "absent" as const, calls: [] };
    const waited = Arr.filter(own, (call) => Arr.isReadonlyArrayNonEmpty(spansOf(kept, call)));
    const once = Arr.filter(own, (call) => Arr.isReadonlyArrayEmpty(spansOf(kept, call)));
    const read = yield* Effect.zipWith(
      tapFor(
        database,
        Arr.map(waited, (call) => call.traceId),
        wait,
      ),
      tapFor(
        database,
        Arr.map(once, (call) => call.traceId),
        { tries: 1, every: wait.every },
      ),
      (a, b) => new Map([...a, ...b]),
    );
    return {
      state: "on" as const,
      calls: Arr.map(own, (call) => callParity(call, spansOf(kept, call), read.get(call.traceId))),
    };
  }).pipe(
    Effect.timed,
    Effect.map(([took, record]) => ({ ...record, ms: Math.round(Duration.toMillis(took)) })),
    Effect.catch((failure) =>
      Effect.succeed({ state: "unreadable" as const, reason: failure.message, ms: 0, calls: [] }),
    ),
  );

/** What the tap fails a run with, one line each: nothing while it is absent or agrees. */
export const tapFailures = (tap: TapRecord | undefined): ReadonlyArray<string> => {
  if (tap === undefined || tap.state === "absent") return [];
  if (tap.state === "unreadable") return [`plumbing: the tap is on but could not be read: ${tap.reason ?? ""}`];
  const disagree = Arr.filter(tap.calls, (call) => !call.agrees);
  return Arr.map(
    disagree,
    (call) =>
      `plumbing: the tap and app.spans disagree on ${call.operation} (${call.traceId})${
        call.complete ? "" : ", incomplete in the tap"
      }: ${Arr.join(
        Arr.map(
          call.differences,
          (each) => `${each.about} ${each.name}${each.key === undefined ? "" : `.${each.key}`}`,
        ),
        ", ",
      )}`,
  );
};
