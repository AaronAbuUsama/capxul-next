// Proofs: a run whose use fails, times out or is interrupted ends with its world destroyed, and a failed world that
// is kept on purpose is left stopped and is still deleted at its expiry.
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { inventory } from "../lifecycle/account.ts";
import { list } from "../lifecycle/operations.ts";
import { door, open } from "../lifecycle/parts.ts";
import { withWorld } from "../lifecycle/run.ts";
import type { World } from "../lifecycle/spec.ts";
import { sweep } from "../lifecycle/sweep.ts";
import { insist, observed } from "./checks.ts";

const lifetime = Duration.minutes(40);

/** Every resource name of this stack that carries the world's stage. */
const leftOf = (stage: string) =>
  Effect.map(inventory, (listing) =>
    [
      ...listing.workers.ofThisStack,
      ...listing.containerApplications.ofThisStack,
      ...listing.durableObjectNamespaces.ofThisStack,
      ...listing.r2Buckets.ofThisStack,
      ...listing.hyperdriveConfigurations.ofThisStack,
      ...listing.neonBranches.names,
    ].filter((name) => name.includes(stage)),
  );

const outcomeOf = <A, E>(used: Option.Option<Exit.Exit<A, E>>) =>
  Option.match(used, {
    onNone: () => "the use never ended",
    onSome: (exit) => (Exit.isSuccess(exit) ? "the use passed" : "the use did not pass"),
  });

/** A use that fails: it reads a table that does not exist. */
export const fails = Effect.gen(function* () {
  const run = yield* withWorld({ name: "p-fails", owner: "proof", lifetime }, (world) =>
    world.sql("select * from app.no_such_table"),
  );
  const left = yield* leftOf("w-p-fails");
  yield* observed("fails", {
    proof: "a use that fails",
    use: outcomeOf(run.used),
    record: run.record,
    leftOfThisWorld: left,
  });
  yield* insist(
    run.record.outcome === "failed" && run.record.worldAfterwards === "destroyed" && left.length === 0,
    "a failed use did not end with the world destroyed",
  );
  return { outcome: run.record.outcome, worldAfterwards: run.record.worldAfterwards, leftOfThisWorld: left };
});

/** A use that outlasts its declared timeout of five seconds. */
export const timesOut = Effect.gen(function* () {
  const run = yield* withWorld({ name: "p-slow", owner: "proof", lifetime, useTimeout: Duration.seconds(5) }, () =>
    Effect.sleep("2 minutes"),
  );
  const left = yield* leftOf("w-p-slow");
  yield* observed("timeout", {
    proof: "a use that outlasts its declared 5 s",
    use: outcomeOf(run.used),
    record: run.record,
    leftOfThisWorld: left,
  });
  yield* insist(
    run.record.outcome === "timed out" && run.record.worldAfterwards === "destroyed" && left.length === 0,
    "a timed-out use did not end with the world destroyed",
  );
  return { outcome: run.record.outcome, worldAfterwards: run.record.worldAfterwards, leftOfThisWorld: left };
});

/**
 * A use that never ends: the process is interrupted from outside (SIGINT) while it runs. The record is written and
 * the world destroyed on the way out; `prove interrupted-check` then shows what was left.
 */
export const interrupted = withWorld({ name: "p-int", owner: "proof", lifetime }, () =>
  Effect.logInfo("the use has started and will never end: interrupt this process now").pipe(
    Effect.andThen(Effect.never),
  ),
).pipe(Effect.map((run) => ({ outcome: run.record.outcome })));

/** After the interrupted run: what its world left behind. */
export const interruptedCheck = Effect.gen(function* () {
  const left = yield* leftOf("w-p-int");
  const worlds = (yield* list).filter((world) => world.world === "w-p-int");
  yield* observed("interrupted", {
    proof: "a run interrupted by SIGINT during its use (the run's record is p-int.json)",
    leftOfThisWorld: left,
    inSharedState: worlds,
  });
  yield* insist(left.length === 0 && worlds.length === 0, "an interrupted run left its world behind");
  return { leftOfThisWorld: left, inSharedState: worlds };
});

const Status = Schema.fromJsonString(Schema.Struct({ running: Schema.Boolean }));
const running = (world: Pick<World, "door">, part: "chain" | "index") =>
  door(world, "GET", `/${part}/status`).pipe(
    Effect.flatMap(({ body }) => Schema.decodeUnknownEffect(Status)(body)),
    Effect.map((status) => status.running),
  );

/**
 * A failed world kept on purpose: it is left stopped, the shared state says it is parked, and once its expiry has
 * passed the sweeper deletes it like any other world.
 */
export const keeps = Effect.gen(function* () {
  const run = yield* withWorld(
    { name: "p-keep", owner: "proof", lifetime: Duration.minutes(5), keepOnFailure: true },
    (world) => world.sql("select * from app.no_such_table"),
  );
  yield* insist(run.record.worldAfterwards === "kept until expiry", "the failed world was not kept");
  const world = yield* open("p-keep");
  const parked = { chainRunning: yield* running(world, "chain"), indexRunning: yield* running(world, "index") };
  const listed = (yield* list).filter((entry) => entry.world === "w-p-keep");
  const early = yield* sweep();
  const wait = Duration.max(
    Duration.zero,
    DateTime.distance(yield* DateTime.now, DateTime.makeUnsafe(run.record.expiresAt)),
  );
  yield* Effect.logInfo(`the kept world expires in ${Duration.format(wait)}; waiting`);
  yield* Effect.sleep(Duration.sum(wait, Duration.seconds(5)));
  const late = yield* sweep();
  const left = yield* leftOf("w-p-keep");
  yield* observed("keep", {
    proof: "a failed world kept on purpose is parked, and is deleted at its expiry",
    record: run.record,
    afterTheRun: { ...parked, inSharedState: listed },
    sweepBeforeExpiry: early.worlds.filter((entry) => entry.world === "w-p-keep"),
    sweepAfterExpiry: late.worlds.filter((entry) => entry.world === "w-p-keep"),
    leftOfThisWorld: left,
  });
  yield* insist(!parked.chainRunning && !parked.indexRunning, "the kept world was left running");
  yield* insist(
    early.worlds.some((entry) => entry.world === "w-p-keep" && entry.verdict === "kept: not expired"),
    "the sweeper did not leave the kept world alone before its expiry",
  );
  yield* insist(
    late.worlds.some((entry) => entry.world === "w-p-keep" && entry.verdict === "destroyed") && left.length === 0,
    "the kept world was not deleted at its expiry",
  );
  return {
    worldAfterwards: run.record.worldAfterwards,
    parked,
    afterExpiry: "destroyed by the sweeper",
    leftOfThisWorld: left,
  };
});
