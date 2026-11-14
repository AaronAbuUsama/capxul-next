// Resetting a world in place to one of its snapshots (roadmap 1.16): the SAME world, its name, door, Core and token
// unchanged, rewound to what the snapshot saved, with one clock. A runner resets its one world before each journey
// instead of making a new one (roadmap, "One runner, one world"). `world.snapshot.restore`, the blueprint's operation,
// still makes a new world from a snapshot.
//
//   index     Ponder stopped with SIGTERM, so it lets go of its schema lock (the snapshot carries none: the save
//             stopped Ponder too, src/platform/snapshots.ts)
//   database  the world's branch restored in place from the snapshot's (Neon's restore): same id, compute and
//             connection string, so Hyperdrive and Core carry on. Never the chain without its database: the database
//             goes first, and a reset that fails after it fails loudly.
//   chain     anvil reset and loaded with the snapshot's state, in place (src/chain/Chain.ts, `reset`)
//   clock     Core's clock set to read the snapshot's time now, and the chain's next block mined at that time, as a
//             restore and a warp do (`mineAtWorldTime`); the bench's clock entry set to it too (src/site/Points.ts)
//   sites     each company site put back to the snapshot's point on the bench, in place (src/site/Points.ts)
//   then      Ponder started again on the restored schema (as soon as the chain is back) and waited for until it has
//             the chain's head; alto and Core waited for beside it
//
// What Neon kept of the world's branch as it was (`<stage>-pre-<n>`) is deleted at once when nothing hangs from it,
// and otherwise with the world, children first (src/platform/branches.ts, `dropBranches`).
import { Errors } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { servesEntryPoint } from "../bundler/client.ts";
import { branchesOf, deleteBranch, projectId, restoreBranch } from "../database/neon.ts";
import { PlatformFailed } from "../failures.ts";
import { preservedPrefix } from "../platform/branches.ts";
import { writeRestored } from "../platform/facts.ts";
import { prepareStore, snapshotOf } from "../platform/store.ts";
import { resetPoint } from "../site/Points.ts";
import { recordedOutput } from "../stack/engine.ts";
import { describeFailure } from "./describe.ts";
import { mineAtWorld, resetChain, resumeIndex, stopIndex } from "./controls.ts";
import { coreAnswers, handle, indexReady, rpcHex, WorldOutput } from "./parts.ts";
import type { World } from "./spec.ts";
import { mustExist } from "./world.ts";

/** The most a reset may take: Ponder's patience with a refused start (INDEX_START, 4 minutes) and a minute more. */
export const ResetTimeout = Config.Duration("WORLD_TIMEOUT_RESET").pipe(Config.withDefault(Duration.minutes(5)));

const Progress = Schema.Array(Schema.Struct({ block: Schema.String }));

const failed = (cause: unknown) => PlatformFailed.make({ step: "restore", message: describeFailure(cause) });

/** Waits until the index has indexed the chain's head, looking every 250 ms. */
const caughtUp = (world: World) =>
  Effect.gen(function* () {
    const head = BigInt(yield* rpcHex(world, "eth_blockNumber"));
    const rows = yield* Effect.flatMap(
      world.sql("select indexed_block::text as block from ponder.indexer_progress limit 1"),
      Schema.decodeUnknownEffect(Progress),
    );
    const indexed = Option.getOrUndefined(Option.map(Arr.head(rows), (row) => BigInt(row.block)));
    if (indexed === undefined || indexed < head)
      return yield* Effect.fail(`indexed ${indexed ?? "nothing"} of ${head}`);
    return Number(indexed);
  }).pipe(Effect.retry({ schedule: Schedule.spaced("250 millis"), times: 1200 }));

/** Rewinds world `name` in place to its snapshot `snapshot`, part by part, and says how long each part took. */
export const reset = Effect.fn("world.reset")(function* (name: string, snapshot: string) {
  const timeout = yield* ResetTimeout;
  const stage = yield* mustExist(name);
  const output = yield* Schema.decodeUnknownEffect(WorldOutput)(yield* recordedOutput(stage));
  const world = yield* handle(output);
  yield* prepareStore;
  const found = yield* snapshotOf(stage, snapshot);
  if (Option.isNone(found)) return yield* Errors.SnapshotNotFound.make({ world: world.name, snapshot });
  const saved = found.value;
  const bench = output.bench ?? "none";
  if (saved.companies > 0 && bench === "none")
    return yield* failed(`${stage} has companies but no bench: its sites cannot be reset`);
  const project = yield* projectId;
  const taken = yield* Ref.make<Record<string, number>>({});
  const timed = <A, E, R>(part: string, effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const began = yield* Clock.currentTimeMillis;
      const result = yield* effect;
      const ms = (yield* Clock.currentTimeMillis) - began;
      yield* Ref.update(taken, (was) => ({ ...was, [part]: ms }));
      return result;
    });
  const began = yield* Clock.currentTimeMillis;
  const preserved = `${preservedPrefix(stage)}${(yield* Random.nextIntBetween(0, 0xffffff)).toString(16)}`;
  const done = yield* Effect.gen(function* () {
    yield* timed("index stopped", stopIndex(world));
    yield* timed("database restored", restoreBranch(project, output.branch, saved.branch_id, preserved));
    const chain = yield* timed("chain reset", resetChain(world, snapshot));
    // Ponder takes 6 to 8 s to start; it is started now, on the restored schema and chain, without waiting for it,
    // and indexes the block mined at the world's time below like any other.
    yield* timed("index resumed", resumeIndex(world));
    // One clock: Core's reads the snapshot's time from now on, and the chain's next block is mined at it.
    const clockAt = yield* Clock.currentTimeMillis;
    const clock = { mode: saved.clock_mode, worldMs: saved.clock_ms, hostMs: clockAt };
    yield* timed("clock", writeRestored(world.database, clock));
    // A frozen clock reads its instant at any host time; a running one moves on from the snapshot's time.
    const mined = yield* timed(
      "chain mined at the world's time",
      mineAtWorld(world, saved.clock_ms, saved.clock_mode === "frozen" ? null : clockAt),
    );
    if (saved.companies > 0)
      yield* timed(
        "sites",
        resetPoint(
          stage,
          bench,
          snapshot,
          saved.clock_mode === "frozen" ? { frozen_at_ms: saved.clock_ms } : { offset_ms: saved.clock_ms - clockAt },
        ),
      );
    const [indexedBlock] = yield* Effect.all(
      [
        timed("index caught up", Effect.andThen(indexReady(world), caughtUp(world))),
        timed("bundler answers", servesEntryPoint(world)),
        timed("core answers", coreAnswers(world)),
        timed("preserved branch dropped", dropIfChildless(project, preserved)),
      ],
      { concurrency: 4 },
    );
    return { chain, minedAt: mined.minedAt, indexedBlock };
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () => Effect.fail(failed(`the reset did not finish within its declared ${Duration.format(timeout)}`)),
    }),
  );
  const ms = { ...(yield* Ref.get(taken)), reset: (yield* Clock.currentTimeMillis) - began };
  return { world: world.name, snapshot, ms, chain: done.chain, minedAt: done.minedAt, indexedBlock: done.indexedBlock };
});

/** Deletes the branch Neon kept of the world as it was, unless a snapshot of the world hangs from it. */
const dropIfChildless = (project: string, name: string) =>
  Effect.gen(function* () {
    const all = yield* branchesOf(project);
    const kept = Arr.findFirst(all, (branch) => branch.name === name);
    if (Option.isNone(kept)) return "none kept";
    if (Arr.some(all, (branch) => branch.parent_id === kept.value.id)) return "kept: snapshots hang from it";
    yield* deleteBranch(project, kept.value.id);
    return "dropped";
  }).pipe(Effect.mapError(failed));
