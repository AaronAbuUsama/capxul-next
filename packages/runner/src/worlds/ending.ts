// The summary of a run in one world (run.ts), however it ended: a starting world that was not made, named by the part
// of it that failed, and a run that died go into its `oneWorld.failure`, which fails the run, so a run never ends
// without a summary that says why (PR #227's CI run 43599082569 died on a starting world's save and left
// no record at all).
import * as World from "@capxul/world";
import * as Arr from "effect/Array";
import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { describe } from "../failure.ts";
import { slugOf, writeJson, type RunRecord } from "../record.ts";
import { summarize, Summary } from "../summary.ts";
import type { Timing, Timings } from "../timings.ts";
import type { Inventory } from "../world/leftovers.ts";
import type { HubUse } from "./hub.ts";

/**
 * Why the starting worlds were not all made: the first timed part that failed (`world create`, `make <…>`, `save <…>`,
 * `bench template <…>`), the world it acted on and why; else the cause itself.
 */
const notMadeWhy = (timings: Timings, cause: Cause.Cause<unknown>) =>
  Effect.map(timings.all, (all) =>
    Option.match(
      Arr.findFirst(all, (part) => !part.ok),
      {
        onNone: () => `the starting worlds were not all made: ${describe(cause)}`,
        onSome: (part) =>
          `the starting worlds were not all made: ${part.part}${part.of === undefined ? "" : ` (${part.of})`} failed: ${part.why ?? describe(cause)}`,
      },
    ),
  );

/** What a run in one world hands its summary, however it ended. */
export interface Ending {
  readonly run: string;
  /** "shared world" when the journeys ran in worlds restored from a shared world (src/shared). */
  readonly mode?: "one world" | "shared world" | undefined;
  readonly startedAt: string;
  readonly owner: string;
  /** Where records are written. */
  readonly records: string;
  readonly core: string | undefined;
  /** How the run ended: its journeys' run records, or why it did not finish. */
  readonly ran: Exit.Exit<ReadonlyArray<RunRecord>, unknown>;
  readonly notMade: string | null;
  /** What the run's take-down could not do, one line each with why (teardown.ts); any of it fails the run. */
  readonly notTakenDown: ReadonlyArray<string>;
  /** The worlds, by stage, left up on purpose for CI's teardown job (RUNNER_TEARDOWN=job); none otherwise. */
  readonly handedOver: ReadonlyArray<string>;
  readonly world: string | null;
  /** The hub as the run used it; null when the run never reached it, and the hub is then the one `WORLD_HUB` names. */
  readonly used: HubUse | null;
  readonly left: Inventory | null;
  readonly timings: ReadonlyArray<Timing>;
}

/** Keeps in `into` why the starting worlds were not all made, from the cause of their making's end. */
export const noteNotMade = (timings: Timings, into: Ref.Ref<string | null>) => (cause: Cause.Cause<unknown>) =>
  Effect.flatMap(notMadeWhy(timings, cause), (why) => Ref.set(into, why));

/**
 * The run's summary, written to `<run>/summary.json`: its own failure is the starting worlds' (`notMade`) and the
 * run's end when it did not finish, either of which fails it, as does anything its take-down could not do.
 */
export const summaryOf = (ending: Ending) =>
  Effect.gen(function* () {
    const { ran, run } = ending;
    const died = Exit.isFailure(ran) ? `the run did not finish: ${describe(ran.cause)}` : null;
    const failures = Arr.filter([ending.notMade, died], (each) => each !== null);
    const hub: HubUse = ending.used ?? {
      stage: yield* Effect.orElseSucceed(World.HubStage, () => "unknown"),
      broughtUp: false,
    };
    const summary = summarize({
      core: ending.core,
      run,
      mode: ending.mode ?? "one world",
      expect: "pass",
      owner: ending.owner,
      startedAt: ending.startedAt,
      records: Exit.isSuccess(ran) ? ran.value : [],
      pathOf: (record) => `${run}/${slugOf(record.name)}.json`,
      oneWorld: {
        world: ending.world,
        hub: hub.stage,
        hubBroughtUp: hub.broughtUp,
        left: ending.left,
        notTakenDown: ending.notTakenDown,
        ...(ending.handedOver.length === 0 ? {} : { handedOver: ending.handedOver }),
        timings: ending.timings,
        failure: failures.length === 0 ? null : Arr.join(failures, "\n"),
      },
    });
    yield* Effect.orDie(writeJson(`${ending.records}/${run}/summary.json`, Summary, summary));
    return summary;
  });
