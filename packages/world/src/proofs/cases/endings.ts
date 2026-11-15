// Proofs about how a run ends: a use that fails, times out or is interrupted ends with its world destroyed, and a
// failed world that is kept on purpose is left stopped and is still deleted when its keep ends.
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { list } from "../../things/world/list.ts";
import { isRunning, open } from "../../things/world/client.ts";
import { DEFAULT_RECORDS, readRecord, type RunRecord } from "../../common/record.ts";
import { withWorld } from "../../things/world/use.ts";
import { sweep } from "../../things/world/sweep.ts";
import { check, conclude, inventoryReport, runCommandLine, stackListing, tailOf } from "../support/conclude.ts";

const lifetime = Duration.minutes(40);
const owner = "proof";
/** What the interrupted run logs once its use has started, and the proof waits for before it interrupts. */
const USE_STARTED = "the use has started and will never end";

const destroyedChecks = (record: RunRecord, inventory: ReturnType<typeof inventoryReport>) => [
  check(
    "the record has every step's duration up to the destroy",
    record.ms.create !== null && record.ms.destroy !== null,
  ),
  check("the world was destroyed", record.worldAfterwards === "destroyed"),
  check("nothing of the world is left in the accounts", inventory.leftOfTheseWorlds.length === 0),
  check("the accounts hold what they held before", inventory.sameAsBefore),
];

/** A use that fails: it reads a table that does not exist. */
export const fails = Effect.gen(function* () {
  const before = yield* stackListing;
  const run = yield* withWorld({ name: "p-fails", owner, lifetime }, (world) =>
    world.sql("select * from app.no_such_table"),
  );
  const inventory = inventoryReport(before, yield* stackListing, ["w-p-fails"]);
  return yield* conclude(
    "fails",
    "a run whose use fails is recorded as failed and its world is destroyed",
    [
      check("the run is recorded as failed, with why", run.record.outcome === "failed" && run.record.failure !== null),
      ...destroyedChecks(run.record, inventory),
    ],
    { record: run.record, inventory },
  );
});

/** A use that outlasts its declared timeout of five seconds. */
export const timesOut = Effect.gen(function* () {
  const before = yield* stackListing;
  const run = yield* withWorld({ name: "p-slow", owner, lifetime, useTimeout: Duration.seconds(5) }, () =>
    Effect.sleep("2 minutes"),
  );
  const inventory = inventoryReport(before, yield* stackListing, ["w-p-slow"]);
  return yield* conclude(
    "timeout",
    "a use that outlasts its declared 5 s timeout is stopped at 5 s, recorded as timed out, and its world is destroyed",
    [
      check("the run is recorded as timed out", run.record.outcome === "timed out"),
      check(
        "the use was stopped at its declared timeout",
        run.record.timeouts.use === 5000 && (run.record.ms.use ?? 0) < 6000,
      ),
      ...destroyedChecks(run.record, inventory),
    ],
    { record: run.record, inventory },
  );
});

/** The run that `interrupted` interrupts: its use never ends. Run on its own, it waits for Ctrl-C. */
export const interruptedRun = withWorld({ name: "p-int", owner, lifetime }, () =>
  Effect.logInfo(`${USE_STARTED}: interrupt this process now`).pipe(Effect.andThen(Effect.never)),
).pipe(Effect.map((run) => ({ outcome: run.record.outcome })));

/**
 * A run interrupted from outside: the command line is started as its own process, and sent SIGINT once its use has
 * started, as a person pressing Ctrl-C. The run's record is read back and the accounts are listed afterwards.
 */
export const interrupted = Effect.gen(function* () {
  const before = yield* stackListing;
  const ran = yield* runCommandLine(["prove", "interrupted-run"], { interruptWhen: USE_STARTED });
  const record = yield* readRecord(DEFAULT_RECORDS, "p-int");
  const inventory = inventoryReport(before, yield* stackListing, ["w-p-int"]);
  const listed = Arr.filter(yield* list, (world) => world.world === "w-p-int");
  return yield* conclude(
    "interrupted",
    "a run interrupted by SIGINT during its use writes its record and destroys its world before the process exits",
    [
      check("the process was interrupted during the use and exited non-zero", ran.exitCode !== 0),
      check("the run is recorded as interrupted", record.outcome === "interrupted"),
      check("the interrupted use has its duration in the record", record.ms.use !== null),
      check("the shared state holds nothing of the world", listed.length === 0),
      ...destroyedChecks(record, inventory),
    ],
    { exitCode: ran.exitCode, logTail: tailOf(ran), record, inventory },
  );
});

/**
 * A failed world kept on purpose, for three minutes: it is left stopped, the shared state says it is parked until
 * its keep ends, a sweep before then keeps it, and a sweep after deletes it like any other world.
 */
export const keeps = Effect.gen(function* () {
  const before = yield* stackListing;
  const keepFor = Duration.minutes(3);
  const run = yield* withWorld({ name: "p-keep", owner, lifetime, keepOnFailure: keepFor }, (world) =>
    world.sql("select * from app.no_such_table"),
  );
  const keptUntil = run.record.keptUntil ?? run.record.expiresAt;
  const world = yield* open("p-keep");
  const parked = { chainRunning: yield* isRunning(world, "chain"), indexRunning: yield* isRunning(world, "index") };
  const listed = Arr.filter(yield* list, (entry) => entry.world === "w-p-keep");
  const early = Arr.filter((yield* sweep()).worlds, (entry) => entry.world === "w-p-keep");
  const wait = Duration.max(Duration.zero, DateTime.distance(yield* DateTime.now, DateTime.makeUnsafe(keptUntil)));
  yield* Effect.logInfo(`the kept world's keep ends in ${Duration.format(wait)}; waiting`);
  yield* Effect.sleep(Duration.sum(wait, Duration.seconds(5)));
  const late = Arr.filter((yield* sweep()).worlds, (entry) => entry.world === "w-p-keep");
  const inventory = inventoryReport(before, yield* stackListing, ["w-p-keep"]);
  const endsEarly = DateTime.isLessThan(DateTime.makeUnsafe(keptUntil), DateTime.makeUnsafe(run.record.expiresAt));
  return yield* conclude(
    "keep",
    "keeping a failed world is asked for with a duration: it is parked, stopped, until then, and the sweeper deletes it when the keep ends",
    [
      check(
        "the run is recorded as failed and its world as kept",
        run.record.outcome === "failed" && run.record.worldAfterwards === "kept",
      ),
      check("the keep ends before the world's own expiry", run.record.keptUntil !== null && endsEarly),
      check("the kept world's chain and index are stopped", !parked.chainRunning && !parked.indexRunning),
      check(
        "the shared state says it is parked until its keep ends",
        listed.length === 1 && listed[0]?.status === "parked" && listed[0].expiresAt === keptUntil,
      ),
      check("a sweep before the keep ends leaves it", early.length === 1 && early[0]?.verdict === "kept: not expired"),
      check("a sweep after the keep ends destroys it", late.length === 1 && late[0]?.verdict === "destroyed"),
      check("nothing of the world is left in the accounts", inventory.leftOfTheseWorlds.length === 0),
      check("the accounts hold what they held before", inventory.sameAsBefore),
    ],
    {
      keepFor: Duration.format(keepFor),
      record: run.record,
      afterTheRun: { ...parked, inSharedState: listed },
      sweepBeforeTheKeepEnds: early,
      sweepAfter: late,
      inventory,
    },
  );
});
