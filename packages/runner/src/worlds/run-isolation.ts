// The whole-run isolation check, side by side (roadmap 4.8, part B; the check is checks/isolation-run.ts): once every
// journey has ended and before the shared world is taken down, the shared world's whole history is read once
// (telemetry/whole-run.ts) and each entry judged against the calls that wrote it. A call is its journey's: the calls
// its steps made and the calls that built its starting world. The calls that made the shared world itself (`fresh`'s)
// are the run's, named by the starting world they made. What fails is returned, one line each, and fails the run.
import { Pipeline } from "@capxul/blueprint";
import type { Journey } from "@capxul/scenarios";
import * as World from "@capxul/world";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { checkRunIsolation } from "../checks/isolation-run.ts";
import { describe } from "../failure.ts";
import type { RunRecord } from "../record.ts";
import { stepOptions, workSpan } from "../telemetry/step.ts";
import { wholeRun } from "../telemetry/whole-run.ts";
import type { MakingCall } from "./making.ts";

/** Every call of the run with whose it is: each journey's by its key, then the run's own makings by their world. */
const callsOf = (
  journeys: ReadonlyArray<Journey>,
  records: ReadonlyArray<RunRecord>,
  made: ReadonlyArray<MakingCall>,
) => {
  const keyOf = new Map(Arr.map(journeys, (journey) => [journey.name, journey.key] as const));
  const theirs = Arr.flatMap(records, (record) =>
    Arr.map([...record.calls, ...(record.making ?? [])], (call) => ({
      traceId: call.traceId,
      journey: keyOf.get(record.name) ?? record.name,
    })),
  );
  const known = new Set(Arr.map(theirs, (call) => call.traceId));
  const runs = Arr.flatMap(made, (each) =>
    known.has(each.call.traceId) ? [] : [{ traceId: each.call.traceId, journey: `the run's ${each.world}` }],
  );
  return [...theirs, ...runs];
};

/** The run's isolation failures over the shared world `world`'s whole history; none when every check holds. */
export const runIsolation = Effect.fn(Pipeline.checkIsolation.name, stepOptions(workSpan(Pipeline.checkIsolation)))(
  function* (
    world: string,
    journeys: ReadonlyArray<Journey>,
    records: ReadonlyArray<RunRecord>,
    made: ReadonlyArray<MakingCall>,
  ) {
    const opened = yield* World.open(world);
    const seen = yield* wholeRun(opened);
    const checks = checkRunIsolation({ calls: callsOf(journeys, records, made), ...seen });
    return Arr.flatMap(checks, (check) => (check.passed ? [] : [`isolation over the whole run: ${check.detail}`]));
  },
  (effect) =>
    Effect.catchCause(effect, (cause) =>
      Effect.succeed([`the whole run's isolation could not be checked: ${describe(cause)}`]),
    ),
);
