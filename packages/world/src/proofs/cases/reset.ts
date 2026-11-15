// Proof (roadmap step 1.16): a world reset in place to its snapshot. A world made by the platform's world.create on a
// running clock three days behind the host is saved (`s0`), moves on (5 USDC more to dana's Safe, indexed, and a
// second snapshot `s1`, which adds to its record), waits, and is reset in place to `s0`, twice. After each reset:
// world.show reads what it read at `s0` (its clock aside, which reads `s0`'s time since the reset), the chain and the
// index read `s0`'s balances and transfers, the chain's next block reads Core's clock within a second, and the
// bundler and Core answer; the reset's parts are timed. Then the world is destroyed with nothing left, its branches
// included, though the reset made its branch a child of the snapshot's (spikes/world-speed, 5.10).
import { CurrentCall, CurrentOperator, type OperationName, Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Redacted from "effect/Redacted";
import * as Rec from "effect/Record";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Predicate from "effect/Predicate";
import { balanceOf, mintAll } from "../../parts/chain/faucet.ts";
import { ProofFailed } from "../../common/failures.ts";
import { describeFailure } from "../../common/describe.ts";
import { destroy } from "../../things/world/destroy.ts";
import { chainTime } from "../../parts/chain/controls.ts";
import { open, rpc, rpcHex } from "../../things/world/client.ts";
import { reset } from "../../things/world/reset.ts";
import { create, Made, show, Tried } from "../../account/worlds.ts";
import { instantOf, readFacts } from "../../things/world/store.ts";
import { Operators } from "../../account/operators.ts";
import { save } from "../../account/snapshots.ts";
import { chainAgainstCore } from "./clock.ts";
import { check, conclude, inventoryReport, stackListing } from "../support/conclude.ts";

const isProofFailed = Schema.is(ProofFailed);
const OWNER = "proof-reset";
const WORLD = "p-rst";
/** How long the world waits after it moved on, so a clock that is not put back shows it. */
const DRIFT = Duration.seconds(20);
const WITHIN_MS = 1000;

const hex32 = Effect.map(
  Effect.forEach(Arr.range(1, 32), () => Random.nextIntBetween(0, 16)),
  (digits) =>
    Arr.join(
      Arr.map(digits, (digit) => digit.toString(16)),
      "",
    ),
);

const as = <A, E, R>(operation: OperationName, call: Effect.Effect<A, E, R>) =>
  Effect.flatMap(hex32, (trace) =>
    call.pipe(
      Effect.provideService(CurrentOperator, { operator: OWNER }),
      Effect.provideService(CurrentCall, { traceId: trace, operation }),
    ),
  );

const timedMs = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const began = yield* Clock.currentTimeMillis;
    const result = yield* effect;
    return { result, ms: (yield* Clock.currentTimeMillis) - began };
  });

const Count = Schema.Array(Schema.Struct({ n: Schema.Finite }));

/** What the chain and the index say of dana's money: her Safe's balance, and how many transfers are indexed. */
const fingerprint = (safe: string) =>
  Effect.gen(function* () {
    const world = yield* open(WORLD);
    const call = (method: string, params: ReadonlyArray<unknown>) => rpc(world, method, params);
    const transfers = yield* Effect.flatMap(
      world.sql("select count(*)::int as n from ponder.transfers"),
      Schema.decodeUnknownEffect(Count),
    );
    return {
      head: Number(BigInt(yield* rpcHex(world, "eth_blockNumber"))),
      danaUsdc: (yield* balanceOf(call, safe)).toString(),
      transfersIndexed: Option.getOrElse(
        Option.map(Arr.head(transfers), (row) => row.n),
        () => -1,
      ),
    };
  });

/**
 * The chain's time against Core's at one instant, both read on Cloudflare's clock: the chain's next block's time as
 * anvil's object reads it with its own host time, and Core's clock (the world's `app.clock`, as Core reads it) at that
 * host time. Reading Core's clock with this machine's clock instead would add this machine's skew from Cloudflare's.
 * A chain's time is whole seconds, so one that agrees is less than a second from Core's.
 */
const oneClock = Effect.gen(function* () {
  const world = yield* open(WORLD);
  const chain = yield* chainTime(world);
  const coreMs = (yield* readFacts(world.database, chain.hostMs)).clockMs;
  return {
    chain: instantOf(chain.chainSeconds * 1000),
    core: instantOf(coreMs),
    apartMs: Math.abs(chain.chainSeconds * 1000 - coreMs),
  };
});

/** Whether two answers hold the same values, field by field. */
const same = (left: unknown, right: unknown): boolean => {
  if (Arr.isArray(left) && Arr.isArray(right))
    return left.length === right.length && Arr.every(left, (one, at) => same(one, right[at]));
  if (Predicate.isObject(left) && Predicate.isObject(right)) {
    const keys = Arr.dedupe([...Rec.keys({ ...left }), ...Rec.keys({ ...right })]);
    return Arr.every(keys, (key) => same(Reflect.get(left, key), Reflect.get(right, key)));
  }
  return left === right;
};

/** world.show's answer without the clock's reading, which runs. */
const steadyPart = (view: typeof Values.WorldView.Type) =>
  Effect.map(Schema.encodeEffect(Values.WorldView)(view), (encoded) => Rec.remove({ ...encoded }, "clock"));

const proof = Effect.gen(function* () {
  const before = yield* stackListing;
  const hostMs = yield* Clock.currentTimeMillis;
  const startAt = instantOf(hostMs - Duration.toMillis(Duration.days(3)));
  const made = yield* timedMs(
    as(
      "world.create",
      create({ world: WORLD, grade: "private", lifetimeMinutes: 40, clock: { mode: "running", startAt } }),
    ),
  );
  const dana = yield* Effect.fromOption(
    Option.flatMap(
      Arr.findFirst(made.result.cast, (member) => member.person === "dana"),
      (member) => Option.fromNullishOr(member.safe),
    ),
  );
  const atSave = yield* as("world.show", show({ world: WORLD }));
  const printAtSave = yield* fingerprint(dana);
  const saved = yield* timedMs(
    as("world.snapshot.save", save({ world: WORLD, snapshot: "s0", replace: false, template: false })),
  );
  // The world moves on: money on the chain, indexed, and a second snapshot in its record.
  const world = yield* open(WORLD);
  yield* mintAll((method, params) => rpc(world, method, params), [{ to: dana, amount: 5_000_000n }]);
  const moved = yield* fingerprint(dana).pipe(
    Effect.filterOrFail(
      (seen) => seen.transfersIndexed > printAtSave.transfersIndexed,
      () => "the mint is not indexed yet",
    ),
    Effect.retry({ times: 120, schedule: Schedule.spaced("250 millis") }),
  );
  yield* as("world.snapshot.save", save({ world: WORLD, snapshot: "s1", replace: false, template: false }));
  const afterMove = yield* as("world.show", show({ world: WORLD }));
  yield* Effect.sleep(DRIFT);
  const first = yield* reset(WORLD, "s0");
  const firstEndedMs = yield* Clock.currentTimeMillis;
  const afterReset = yield* as("world.show", show({ world: WORLD }));
  const shownAtMs = yield* Clock.currentTimeMillis;
  const printAfterReset = yield* fingerprint(dana);
  const clocks = yield* chainAgainstCore(WORLD);
  const oneClockAfterFirst = yield* oneClock;
  const second = yield* reset(WORLD, "s0");
  const afterSecond = yield* as("world.show", show({ world: WORLD }));
  const clocksAfterSecond = yield* chainAgainstCore(WORLD);
  const oneClockAfterSecond = yield* oneClock;
  const destroyed = yield* timedMs(destroy(WORLD));
  const report = inventoryReport(before, yield* stackListing, [`w-${WORLD}`]);
  // Compared as world.show sends them: an instant's in-memory form keeps caches that two equal instants need not share.
  const [shownAtSave, shownAfterReset, shownAfterSecond] = yield* Effect.forEach(
    [atSave, afterReset, afterSecond],
    steadyPart,
  );
  // Core's clock reads s0's time from the reset on: s0's reading plus what has passed since, within the reset's span.
  const s0Ms = DateTime.toEpochMillis(DateTime.makeUnsafe(saved.result.clock.now));
  const shownMs = DateTime.toEpochMillis(DateTime.makeUnsafe(afterReset.clock.now));
  const expectedMs = s0Ms + (shownAtMs - firstEndedMs);
  const clockOffBy = Math.abs(shownMs - expectedMs);
  const checks = [
    check("after the reset world.show reads what it read at s0, its clock aside", same(shownAfterReset, shownAtSave)),
    check("and not what it read after the world moved on", afterMove.recordHead !== afterReset.recordHead),
    check(
      "its clock reads s0's time since the reset, within the reset's own span",
      clockOffBy <= first.ms.reset + WITHIN_MS,
    ),
    check(
      "the chain and the index read s0's balance and transfers",
      printAfterReset.danaUsdc === printAtSave.danaUsdc &&
        printAfterReset.transfersIndexed === printAtSave.transfersIndexed &&
        moved.danaUsdc !== printAtSave.danaUsdc,
    ),
    check("the chain's time reads Core's clock within a second", oneClockAfterFirst.apartMs < WITHIN_MS),
    check(
      "a second reset to s0 does the same",
      same(shownAfterSecond, shownAtSave) && clocksAfterSecond.apartMs <= WITHIN_MS,
    ),
    check(
      "the world is destroyed with nothing of it left, its branches included",
      report.leftOfTheseWorlds.length === 0,
    ),
  ];
  return yield* conclude(
    "reset",
    "a world is reset in place to its snapshot: world.show reads the snapshot, one clock, then it is destroyed cleanly",
    checks,
    {
      createMs: made.ms,
      saveMs: saved.ms,
      resets: [first, second],
      destroyMs: destroyed.ms,
      destroySteps: destroyed.result.ms,
      views: { atSave, afterMove, afterReset, afterSecond },
      fingerprints: { atSave: printAtSave, moved, afterReset: printAfterReset },
      clock: { s0: saved.result.clock, shownAfterReset: afterReset.clock, expected: instantOf(expectedMs), clockOffBy },
      clocks: { afterFirst: oneClockAfterFirst, afterSecond: oneClockAfterSecond },
      // The clock proof's own measure, Core's clock read with this machine's clock around a block mined now.
      minedAgainstCore: { afterFirst: clocks, afterSecond: clocksAfterSecond },
      sites: "none: the world has no company (no bench is reachable from this container, roadmap 1.4)",
      inventory: report,
    },
  );
});

const operators = Layer.effect(
  Operators,
  Effect.map(hex32, (token) => ({ first: { name: OWNER, token: Redacted.make(token) }, second: Option.none() })),
);

/** The proof, with an operator of its own and its record of the world it made. */
export const resetProof = proof.pipe(
  Effect.onError(() => Effect.ignore(destroy(WORLD))),
  Effect.mapError((error) =>
    isProofFailed(error) ? error : ProofFailed.make({ message: `reset: ${describeFailure(error)}` }),
  ),
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the proof's own operator and its record of what it made
  Effect.provide(Layer.mergeAll(Made.layer, Tried.layer, operators)),
);
