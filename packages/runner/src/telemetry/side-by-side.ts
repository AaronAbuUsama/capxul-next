// Side by side (roadmap 4.4): for every call a run made, through its own stage's door or at another world's door (in
// that world's database), the spans Core kept in
// `app.spans` beside the spans the tap holds of it (tap.ts), and their parity (parity.ts), for the run record. The
// generic checks still read `app.spans` alone until the flip. This is the runner's plumbing: a disagreement while the
// tap is on fails the run as the runner's own failure, never as a check's.
//
// While a world's Core writes no tap (`CAPXUL_TAP` off), `telemetry.otlp` is empty: the tap is `absent`, nothing is
// waited for and nothing fails.
import { Pipeline, servedBy } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import type * as Redacted from "effect/Redacted";
import type { Call } from "../client.ts";
import type { TapReport } from "../record.ts";
import { telemetryOf, type Kept, type SpanRow } from "../world/database.ts";
import { OtherWorlds } from "../world/existing.ts";
import { PlatformKept } from "../worlds/kept.ts";
import type { FlatSpan } from "./flat.ts";
import { parity } from "./parity.ts";
import { stepOptions } from "./step.ts";
import { tapFor, tapIsOn, WAIT, type Tapped, type Wait } from "./tap.ts";

type CallParity = TapReport["calls"][number];

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

/** The calls made at one door against that door's database: none when they are none or its tap is off. */
const sideOf = Effect.fn(
  Pipeline.checkCall.spans.read.name,
  stepOptions(Pipeline.checkCall.spans.read),
)(function* (where: Redacted.Redacted, these: ReadonlyArray<Call>, theirs: Kept, wait: Wait) {
  if (Arr.isReadonlyArrayEmpty(these) || !(yield* tapIsOn(where))) return Option.none<Array<CallParity>>();
  const waited = Arr.filter(these, (call) => Arr.isReadonlyArrayNonEmpty(spansOf(theirs, call)));
  const once = Arr.filter(these, (call) => Arr.isReadonlyArrayEmpty(spansOf(theirs, call)));
  const read = yield* Effect.zipWith(
    tapFor(
      where,
      Arr.map(waited, (call) => call.traceId),
      wait,
    ),
    tapFor(
      where,
      Arr.map(once, (call) => call.traceId),
      { tries: 1, every: wait.every },
    ),
    (a, b) => new Map([...a, ...b]),
  );
  return Option.some(Arr.map(these, (call) => callParity(call, spansOf(theirs, call), read.get(call.traceId))));
});

/**
 * Every call side by side: those through the stage's own door against its database, and those made `at` another
 * world's door against that world's database, found as the checks find it (`OtherWorlds`, world/existing.ts). A call
 * with a span in `app.spans` waits up to `wait` for its operation span in the tap; a call with none (rejected before
 * Core, unanswered) is read once. A database whose tap is off adds nothing; the tap is `absent` only when none is on.
 */
export const sideBySide = (
  database: Redacted.Redacted,
  calls: ReadonlyArray<Call>,
  kept: Kept,
  wait: Wait = WAIT,
): Effect.Effect<TapReport, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const served = yield* Effect.serviceOption(PlatformKept);
    const own = Arr.filter(
      calls,
      (call) => call.at === null && !(Option.isSome(served) && servedBy(call.operation) === "platform"),
    );
    const sides = [yield* sideOf(database, own, kept, wait)];
    // A call made at another world's door is kept by that world: its two records are compared in its database.
    const others = yield* Effect.serviceOption(OtherWorlds);
    const doors = Arr.dedupe(
      Arr.filterMap(calls, (call) => (call.at === null ? Result.failVoid : Result.succeed(call.at))),
    );
    if (Option.isSome(others))
      for (const door of doors) {
        const theirs = yield* others.value.databaseAt(door);
        if (Option.isNone(theirs)) continue;
        const atEndpoint = Arr.filter(calls, (call) => call.at === door);
        const theirKept = yield* telemetryOf(
          theirs.value,
          Arr.map(atEndpoint, (call) => call.traceId),
        );
        sides.push(yield* sideOf(theirs.value, atEndpoint, theirKept, wait));
      }
    const on = Arr.getSomes(sides);
    if (Arr.isReadonlyArrayEmpty(on)) return { state: "absent" as const, calls: [] };
    return { state: "on" as const, calls: Arr.flatten(on) };
  }).pipe(
    Effect.timed,
    Effect.map(([took, report]) => ({ ...report, ms: Math.round(Duration.toMillis(took)) })),
    Effect.catch((failure) =>
      Effect.succeed({ state: "unreadable" as const, reason: failure.message, ms: 0, calls: [] }),
    ),
  );

/** What the tap fails a run with, one line each: nothing while it is absent or agrees. */
export const tapFailures = (tap: TapReport | undefined): ReadonlyArray<string> => {
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
