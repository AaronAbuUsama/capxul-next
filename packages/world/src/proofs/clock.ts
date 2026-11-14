// Proof: a world restored from a snapshot keeps the world's one clock. Core keeps a running clock as an offset from
// host time, and a restore sets it to read the snapshot's time; the chain's state is loaded with the snapshot's head,
// and anvil runs on from that head, so after a restore the two drifted apart by the time between the head and the
// save and between the save and the restore (spikes/world-speed, 6.3: 95 s). A world on a running clock, started two
// weeks behind the host, is saved a while after its create and restored a while after its save; the restored chain's
// next block then reads Core's clock within a second, as the first world's does, and again after its chain was
// stopped and woken from its saved state (anvil_loadState restarts anvil's clock at the saved head too). Both worlds destroyed, nothing left.
import { CurrentCall, CurrentOperator, type OperationName } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { ProofFailed } from "../failures.ts";
import { describeFailure } from "../lifecycle/describe.ts";
import { destroy } from "../lifecycle/operations.ts";
import { open, partStatus, rpcControl, stop } from "../lifecycle/parts.ts";
import { create, Made, Tried } from "../platform/create.ts";
import { instantOf, readFacts } from "../platform/facts.ts";
import { Operators } from "../platform/operators.ts";
import { restore, save } from "../platform/snapshots.ts";
import { check, conclude, inventoryReport, stackListing } from "./support.ts";

const isProofFailed = Schema.is(ProofFailed);
const OWNER = "proof-clock";
const FIRST = "p-clk";
const SECOND = "p-clk2";
/** How long the first world runs before its save, and the snapshot waits before its restore: time to drift in. */
const BEFORE_SAVE = Duration.seconds(40);
const BEFORE_RESTORE = Duration.seconds(40);
/** How long the restored world's chain is left stopped before it is woken again. */
const ASLEEP = Duration.seconds(30);
/** Block timestamps are whole seconds. */
const WITHIN_MS = 1000;

const traceId = Effect.map(
  Effect.forEach(Arr.range(1, 32), () => Random.nextIntBetween(0, 16)),
  (digits) =>
    Arr.join(
      Arr.map(digits, (digit) => digit.toString(16)),
      "",
    ),
);

const as = <A, E, R>(operator: string, operation: OperationName, call: Effect.Effect<A, E, R>) =>
  Effect.flatMap(traceId, (trace) =>
    call.pipe(
      Effect.provideService(CurrentOperator, { operator }),
      Effect.provideService(CurrentCall, { traceId: trace, operation }),
    ),
  );

const Block = Schema.Struct({ number: Schema.String, timestamp: Schema.String });

/**
 * The chain's time against Core's, now: a block is mined with no time asked for, so anvil gives it its own clock's,
 * and Core's clock is read from the world's database (as Core reads it) at the host times before and after the mine.
 * `apartMs` is how far the block is outside that span of Core's time, 0 when inside it.
 */
const chainAgainstCore = (name: string) =>
  Effect.gen(function* () {
    const world = yield* open(name);
    const head = yield* Effect.flatMap(
      rpcControl(world, "eth_getBlockByNumber", ["latest", false]),
      Schema.decodeUnknownEffect(Block),
    );
    const hostBefore = yield* Clock.currentTimeMillis;
    yield* rpcControl(world, "evm_mine", []);
    const hostAfter = yield* Clock.currentTimeMillis;
    const mined = yield* Effect.flatMap(
      rpcControl(world, "eth_getBlockByNumber", ["latest", false]),
      Schema.decodeUnknownEffect(Block),
    );
    const coreBefore = (yield* readFacts(world.database, hostBefore)).clockMs;
    const coreAfter = (yield* readFacts(world.database, hostAfter)).clockMs;
    const chainMs = Number(BigInt(mined.timestamp)) * 1000;
    const apartMs = chainMs < coreBefore ? coreBefore - chainMs : chainMs > coreAfter ? chainMs - coreAfter : 0;
    return {
      world: name,
      headBefore: { number: Number(BigInt(head.number)), at: instantOf(Number(BigInt(head.timestamp)) * 1000) },
      mined: { number: Number(BigInt(mined.number)), at: instantOf(chainMs) },
      core: { from: instantOf(coreBefore), to: instantOf(coreAfter) },
      apartMs,
    };
  });

const proof = Effect.gen(function* () {
  const before = yield* stackListing;
  const hostMs = yield* Clock.currentTimeMillis;
  const startAt = instantOf(hostMs - Duration.toMillis(Duration.days(14)));
  const made = yield* as(
    OWNER,
    "world.create",
    create({ world: FIRST, grade: "private", lifetimeMinutes: 40, clock: { mode: "running", startAt } }),
  );
  yield* Effect.sleep(BEFORE_SAVE);
  const saved = yield* as(
    OWNER,
    "world.snapshot.save",
    save({ world: FIRST, snapshot: "c1", replace: false, template: false }),
  );
  yield* Effect.sleep(BEFORE_RESTORE);
  const restored = yield* as(
    OWNER,
    "world.snapshot.restore",
    restore({ world: FIRST, snapshot: "c1", as: SECOND, lifetimeMinutes: 20 }),
  );
  const second = yield* chainAgainstCore(SECOND);
  // The chain is saved and stopped, as an idle chain is, and woken from its saved state a while later.
  yield* stop(yield* open(SECOND));
  yield* Effect.sleep(ASLEEP);
  const woken = yield* chainAgainstCore(SECOND);
  const chainRecord = yield* partStatus(yield* open(SECOND), "chain");
  const first = yield* chainAgainstCore(FIRST);
  yield* destroy(SECOND);
  yield* destroy(FIRST);
  const report = inventoryReport(before, yield* stackListing, [`w-${FIRST}`, `w-${SECOND}`]);
  const checks = [
    check("the first world runs on a running clock two weeks behind the host", made.clock.mode === "running"),
    check("the restored world runs on the snapshot's clock", restored.clock.mode === "running"),
    check("the restored world's chain reads Core's clock within a second", second.apartMs <= WITHIN_MS),
    check("and still does after its chain was stopped and woken from its saved state", woken.apartMs <= WITHIN_MS),
    check("so does the first world's chain", first.apartMs <= WITHIN_MS),
    check(
      "nothing of either world is left in the accounts, snapshot branches included",
      report.leftOfTheseWorlds.length === 0,
    ),
  ];
  return yield* conclude(
    "clock",
    "a world restored from a snapshot keeps one clock: its chain reads Core's world time within a second",
    checks,
    {
      startAt,
      saved,
      restored: { clock: restored.clock, parent: restored.parent },
      second,
      woken,
      chainRecord,
      first,
      inventory: report,
    },
  );
});

const cleanup = Effect.forEach([SECOND, FIRST], (name) => Effect.ignore(destroy(name)), { discard: true });

const operators = Layer.effect(
  Operators,
  Effect.map(traceId, (token) => ({
    first: { name: OWNER, token: Redacted.make(token) },
    second: Option.none(),
  })),
);

/** The proof, with an operator of its own and its record of the worlds it made. */
export const clock = proof.pipe(
  Effect.onError(() => cleanup),
  Effect.mapError((error) =>
    isProofFailed(error) ? error : ProofFailed.make({ message: `clock: ${describeFailure(error)}` }),
  ),
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the proof's own operator and its record of what it made
  Effect.provide(Layer.mergeAll(Made.layer, Tried.layer, operators)),
);
