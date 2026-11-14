// Proof: a world's containers are started patiently (src/containers/patience.ts). Worlds made one after another each
// record their index step's duration and every try of the index's start, with where Ponder's time went once started.
// In each, the chain is stopped right after the create, as a container that goes away is, and called again at once:
// the call wakes it, every try of that start recorded, and the index comes back by itself without the call waiting
// on it. Every stop of the index is SIGTERM, which Ponder exits on. Every world is destroyed and the accounts hold what they held before.
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { bundlerStatus } from "../bundler/client.ts";
import { WorldNotReady } from "../failures.ts";
import { describe } from "../lifecycle/describe.ts";
import { partStatus, rpcHex, stop } from "../lifecycle/parts.ts";
import { DEFAULT_RECORDS, readRecord, type RunRecord } from "../lifecycle/record.ts";
import { withWorld } from "../lifecycle/run.ts";
import type { World } from "../lifecycle/spec.ts";
import { FUNDED, OPENING } from "./checks.ts";
import { check, conclude, inventoryReport, stackListing } from "./support.ts";

const PROOF = "patience";
const CLAIM =
  "a refused container start is tried again within its declared window, every try recorded with its duration: worlds made one after another each record their index step and the index's start tries; a chain stopped right after a create answers the next call, its start's tries recorded, and the index, stopped by SIGTERM, comes back by itself; every world destroyed, nothing left";

/** How many worlds are made one after another, and how often each one's chain is stopped and called again. */
const WORLDS = ["p-pat-1", "p-pat-2", "p-pat-3", "p-pat-4"];
const STOPS = 2;

const Attempt = Schema.Struct({
  at: Schema.String,
  ms: Schema.Finite,
  started: Schema.Boolean,
  outcome: Schema.Literals(["refused", "not ready", "ready"]),
  message: Schema.NullOr(Schema.String),
});
const Report = {
  attempts: Schema.Array(Attempt),
  ms: Schema.Finite,
  startCalls: Schema.Finite,
  refusals: Schema.Finite,
};
const IndexStart = Schema.Struct({
  at: Schema.String,
  ...Report,
  healthyMs: Schema.NullOr(Schema.Finite),
  readyMs: Schema.NullOr(Schema.Finite),
  timeline: Schema.NullOr(Schema.Unknown),
});
const IndexStop = Schema.Struct({
  at: Schema.String,
  ms: Schema.Finite,
  ended: Schema.optional(Schema.Literals(["exited", "killed"])),
});
const IndexRecord = Schema.Struct({
  running: Schema.Boolean,
  ready: Schema.NullOr(Schema.Finite),
  starts: Schema.Array(IndexStart),
  gaveUp: Schema.Array(Schema.Unknown),
  stops: Schema.Array(IndexStop),
});
const ChainStart = Schema.Struct({
  at: Schema.String,
  from: Schema.String,
  afterUnsavedStop: Schema.Boolean,
  wakeMs: Schema.Finite,
  ...Report,
});
const ChainRecord = Schema.Struct({
  running: Schema.Boolean,
  record: Schema.Struct({ starts: Schema.Array(ChainStart) }),
});

const indexRecord = (world: World) =>
  partStatus(world, "index").pipe(Effect.flatMap(Schema.decodeUnknownEffect(IndexRecord)));
const chainRecord = (world: World) =>
  partStatus(world, "chain").pipe(Effect.flatMap(Schema.decodeUnknownEffect(ChainRecord)));

/** Whether a start's last try found its container ready. */
const ended = (start: { readonly attempts: ReadonlyArray<{ readonly outcome: string }> }) =>
  Arr.last(start.attempts).pipe(Option.exists((last) => last.outcome === "ready"));

/** Waits, up to 3 minutes, until the index runs again and Ponder says it is ready. */
const indexBack = (world: World) =>
  indexRecord(world).pipe(
    Effect.filterOrFail(
      (seen) => seen.running && seen.ready === 200,
      (seen) => WorldNotReady.make({ part: "index", message: `running ${seen.running}, ready ${seen.ready}` }),
    ),
    Effect.retry(Schedule.max([Schedule.spaced("2 seconds"), Schedule.recurs(90)])),
  );

/** Stops the chain (and with it the bundler and the index), then calls it at once, as a container that went away. */
const stopAndCall = (world: World) =>
  Effect.gen(function* () {
    yield* stop(world);
    const began = yield* Clock.currentTimeMillis;
    const head = yield* rpcHex(world, "eth_blockNumber");
    const callMs = (yield* Clock.currentTimeMillis) - began;
    const chain = yield* chainRecord(world);
    const wake = Arr.last(chain.record.starts);
    const index = yield* indexBack(world);
    const indexMs = (yield* Clock.currentTimeMillis) - began;
    return {
      head,
      callMs,
      wake: Option.getOrNull(wake),
      indexBackMs: indexMs,
      indexStart: Option.getOrNull(Arr.last(index.starts)),
      // How the index was stopped: on SIGTERM Ponder exits and lets go of its schema lock (src/containers/stop.ts).
      indexStop: Option.getOrNull(Arr.last(index.stops)),
    };
  });

const use = (world: World) =>
  Effect.gen(function* () {
    const index = yield* indexRecord(world);
    const chain = yield* chainRecord(world);
    const bundler = yield* bundlerStatus(world);
    const cycles = yield* Effect.forEach(Arr.range(1, STOPS), () => stopAndCall(world));
    return { index, firstChainStart: chain.record.starts[0] ?? null, bundlerStarts: bundler.record.starts, cycles };
  });

/** One world, made, used and destroyed; its run record, and what its use saw, or why it did not pass. */
const oneWorld = (name: string) =>
  withWorld(
    { name, owner: "proof", lifetime: Duration.minutes(40), mint: [{ to: FUNDED, amount: OPENING }] },
    use,
  ).pipe(
    Effect.exit,
    Effect.flatMap((ran) =>
      Effect.gen(function* () {
        const record: RunRecord = Exit.isSuccess(ran) ? ran.value.record : yield* readRecord(DEFAULT_RECORDS, name);
        const used = Exit.isSuccess(ran) ? Option.getOrUndefined(ran.value.used) : undefined;
        const seen = used !== undefined && Exit.isSuccess(used) ? used.value : null;
        const failure = Exit.isFailure(ran)
          ? describe(ran.cause)
          : used !== undefined && Exit.isFailure(used)
            ? describe(used.cause)
            : null;
        return { name, record, seen, failure };
      }),
    ),
  );

export const patience = Effect.gen(function* () {
  const before = yield* stackListing;
  const worlds = yield* Effect.forEach(WORLDS, oneWorld);
  const inventory = inventoryReport(
    before,
    yield* stackListing,
    Arr.map(WORLDS, (name) => `w-${name}`),
  );
  const seen = Arr.flatMap(worlds, (one) => (one.seen === null ? [] : [one.seen]));
  const indexStarts = Arr.flatMap(seen, (one) => one.index.starts);
  const cycles = Arr.flatMap(seen, (one) => one.cycles);
  const wakes = Arr.flatMap(cycles, (cycle) => (cycle.wake === null ? [] : [cycle.wake]));
  const resumed = Arr.flatMap(cycles, (cycle) => (cycle.indexStart === null ? [] : [cycle.indexStart]));
  const tries = [
    ...Arr.map(indexStarts, (start) => ({ part: "index, at its create", ...start })),
    ...Arr.map(resumed, (start) => ({ part: "index, after the chain woke", ...start })),
    ...Arr.map(wakes, (start) => ({ part: "chain, after its stop", ...start })),
  ];
  const retried = Arr.filter(tries, (start) => start.refusals > 0 && ended(start));
  return yield* conclude(
    PROOF,
    CLAIM,
    [
      check(
        "every world's run passed",
        Arr.every(worlds, (one) => one.record.outcome === "passed"),
      ),
      check(
        "every world's index step is recorded within its declared timeout",
        Arr.every(worlds, (one) => one.record.ms.index !== null && one.record.ms.index < one.record.timeouts.index),
      ),
      check(
        "every index start is recorded with every try and its duration",
        Arr.isReadonlyArrayNonEmpty(indexStarts) &&
          Arr.every(indexStarts, (start) => Arr.isReadonlyArrayNonEmpty(start.attempts)),
      ),
      check("a start Cloudflare refused was tried again until it started", Arr.isReadonlyArrayNonEmpty(retried)),
      check(
        "a chain stopped right after its create answered the next call, every try of its start recorded",
        Arr.length(cycles) === WORLDS.length * STOPS &&
          Arr.length(wakes) === Arr.length(cycles) &&
          Arr.every(wakes, (wake) => ended(wake) && wake.from === "saved state"),
      ),
      check(
        "every stop of the index sent Ponder SIGTERM and Ponder exited, none killed",
        Arr.length(cycles) === WORLDS.length * STOPS &&
          Arr.every(cycles, (cycle) => cycle.indexStop !== null && cycle.indexStop.ended === "exited"),
      ),
      check(
        "every world was destroyed",
        Arr.every(worlds, (one) => one.record.worldAfterwards === "destroyed"),
      ),
      check("nothing of these worlds is left in the accounts", inventory.leftOfTheseWorlds.length === 0),
      check("the accounts hold what they held before", inventory.sameAsBefore),
    ],
    {
      indexStepMs: Arr.map(worlds, (one) => ({
        world: one.name,
        index: one.record.ms.index,
        create: one.record.ms.create,
      })),
      refusals: Arr.map(tries, (start) => ({
        part: start.part,
        at: start.at,
        tries: start.attempts.length,
        refusals: start.refusals,
        ms: start.ms,
      })),
      retriedStarts: retried,
      // Each resume of the index after the chain woke: how it was stopped, then how long its new start took to
      // healthy and to ready (a Ponder killed holds its schema lock, and the next waits it out).
      indexResumes: Arr.map(cycles, (cycle) => ({
        stop: cycle.indexStop,
        healthyMs: cycle.indexStart?.healthyMs ?? null,
        readyMs: cycle.indexStart?.readyMs ?? null,
        refusals: cycle.indexStart?.refusals ?? null,
        indexBackMs: cycle.indexBackMs,
      })),
      worlds,
      inventory,
    },
  );
});
