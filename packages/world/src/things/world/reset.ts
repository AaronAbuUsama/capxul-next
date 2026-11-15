// Resetting a world in place to one of its snapshots (roadmap 1.16): the SAME world, its name, door, Core and token
// unchanged, rewound to what the snapshot saved, with one clock. A runner resets its one world before each journey
// instead of making a new one (roadmap, "One runner, one world"). `world.snapshot.restore`, the blueprint's operation,
// still makes a new world from a snapshot.
//
//   index     Ponder stopped with SIGTERM, so it lets go of its schema lock (the snapshot carries none: the save
//             stopped Ponder too, src/account/snapshots.ts)
//   database  the world's branch restored in place from the snapshot's (Neon's restore): same id, compute and
//             connection string, so Hyperdrive and Core carry on. Never the chain without its database: the database
//             goes first, and a reset that fails after it fails loudly.
//   chain     alto stopped, then anvil reset and loaded with the snapshot's state, in place; alto starts again at
//             the reset's first look at the bundler (src/parts/chain/Chain.ts, `reset`)
//   clock     Core's clock set to read the snapshot's time from the reset's start, and, beside it, the chain's next
//             block mined at that time, as a restore and a warp do (`mineAtWorldTime`); the bench's clock entry set to
//             it too (src/things/site/reset.ts)
//   sites     each company site put back to the snapshot's point on the bench, in place, or claimed from the bench
//             template the caller names (the one the world kept of the snapshot) when the point lost its sites; a
//             snapshot of no company removes the world's sites (src/things/site/reset.ts). The bench's alone, so it
//             runs from the start, beside everything above
//   then      Ponder started again on the restored schema (as soon as the chain is back) and waited for until it has
//             the chain's head; alto, Core and the dropped branch waited for beside it
//
// What Neon kept of the world's branch as it was (`<stage>-pre-<n>`) is deleted at once when nothing hangs from it,
// and otherwise with the world, children first (src/parts/database/branches.ts, `dropBranches`).
import { Errors, Pipeline } from "@capxul/blueprint";
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
import { AfterReset, bundlerAnswers } from "../../parts/bundler/client.ts";
import { branchesOf, deleteBranch, projectId, restoreBranch } from "../../parts/database/neon.ts";
import { PlatformFailed } from "../../common/failures.ts";
import { preservedPrefix } from "../../parts/database/branches.ts";
import { writeRestored } from "./store.ts";
import { prepareStore, snapshotOf } from "../../account/store.ts";
import { resetSites, type SitesReset } from "../site/reset.ts";
import { recordedOutput } from "../../stack/engine.ts";
import { describeFailure } from "../../common/describe.ts";
import { mineAtWorld, resetChain, resumeIndex, stopIndex } from "../../parts/chain/controls.ts";
import { handle, WorldOutput } from "./handle.ts";
import { forgetWorld } from "./kept.ts";
import { coreAnswers, indexReady, rpcHex } from "./client.ts";
import type { World } from "./values.ts";
import { mustExist } from "./take-down.ts";

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

/**
 * Rewinds world `name` in place to its snapshot `snapshot`, part by part, and says how long each part took. `template`
 * is the bench template the world kept of the snapshot (`keepSitesAsTemplate`), claimed from when the point lost its
 * sites.
 */
export const reset = Effect.fn("world.reset")(function* (name: string, snapshot: string, template?: string) {
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
  // One clock, from one moment: Core's clock reads the snapshot's time at it, the chain's next block is mined at that
  // time brought to now, and the bench's clock entry runs from it. It is taken first, so the sites need not wait.
  const clockAt = yield* Clock.currentTimeMillis;
  const done = yield* Effect.gen(function* () {
    // The sites are the bench's alone (the bench's own database and clock entry): they are put back beside the world's
    // database and chain, from the start, not after them.
    const sitesPart =
      bench === "none"
        ? Effect.succeed<SitesReset | null>(null)
        : timed(
            "sites",
            resetSites(
              stage,
              bench,
              snapshot,
              saved.companies,
              saved.clock_mode === "frozen"
                ? { frozen_at_ms: saved.clock_ms }
                : { offset_ms: saved.clock_ms - clockAt },
              Option.fromNullishOr(template),
            ),
          );
    const rewind = Effect.fn(Pipeline.worldReset.spans.rewind.name)(function* () {
      yield* timed("index stopped", stopIndex(world));
      yield* timed("database restored", restoreBranch(project, output.branch, saved.branch_id, preserved));
      const chain = yield* timed("chain reset", resetChain(world, snapshot));
      // Ponder takes 6 to 8 s to start; it is started now, on the restored schema and chain, without waiting for it,
      // and indexes the block mined at the world's time below like any other.
      yield* timed("index resumed", resumeIndex(world));
      // Core's clock (the database) and the chain's block are apart, so they are set side by side; a frozen clock
      // reads its instant at any host time, a running one moves on from the snapshot's time. The index is waited for
      // once that block is mined, looked at every half second, not every 2 s: it is already starting.
      const settle = Effect.fn(Pipeline.worldReset.spans.settle.name)(function* () {
        const clock = { mode: saved.clock_mode, worldMs: saved.clock_ms, hostMs: clockAt };
        const [mined] = yield* Effect.all(
          [
            timed(
              "chain mined at the world's time",
              mineAtWorld(world, saved.clock_ms, saved.clock_mode === "frozen" ? null : clockAt),
            ),
            timed("clock", writeRestored(world.database, clock)),
          ],
          { concurrency: 2 },
        );
        const indexedBlock = yield* timed(
          "index caught up",
          Effect.andThen(indexReady(world, "500 millis"), caughtUp(world)).pipe(
            Effect.withSpan(Pipeline.worldReset.spans.indexReady.name),
          ),
        );
        return { minedAt: mined.minedAt, indexedBlock };
      });
      // The chain's reset stopped alto before the rewind (src/parts/chain/Chain.ts, `reset`): this look starts it again
      // and waits until it serves the EntryPoint, riding out a dropped connection through the shared hub (`AfterReset`);
      // Core and the branch Neon kept need only the database. All are waited for beside the clock and the index.
      const [{ minedAt, indexedBlock }] = yield* Effect.all(
        [
          settle(),
          timed(
            "bundler answers",
            bundlerAnswers(world, AfterReset, Pipeline.worldReset.spans.bundlerServing.name).pipe(
              Effect.withSpan(Pipeline.worldReset.spans.bundlerReady.name),
            ),
          ),
          timed("core answers", coreAnswers(world)),
          timed("preserved branch dropped", dropIfChildless(project, preserved)),
        ],
        { concurrency: 4 },
      );
      return { chain, minedAt, indexedBlock };
    });
    const [rewound, sites] = yield* Effect.all([rewind(), sitesPart], { concurrency: 2 });
    return { ...rewound, sites };
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () => Effect.fail(failed(`the reset did not finish within its declared ${Duration.format(timeout)}`)),
    }),
    // Neon's restore keeps the branch's id and connection string, so nothing kept of the world should change; it is
    // dropped all the same, so the next handle reads the world as the reset left it (src/things/world/kept.ts).
    Effect.ensuring(forgetWorld(stage)),
  );
  const ms = { ...(yield* Ref.get(taken)), reset: (yield* Clock.currentTimeMillis) - began };
  return {
    world: world.name,
    snapshot,
    ms,
    chain: done.chain,
    minedAt: done.minedAt,
    indexedBlock: done.indexedBlock,
    sites: done.sites,
  };
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
