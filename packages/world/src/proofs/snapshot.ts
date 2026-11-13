// Proof: the platform's four operations, called as its handlers are called (src/platform), make a world with its
// cast and its start block, save it whole and restore it into a second world that holds exactly what was saved,
// while the first goes on alone; every refusal the operations declare for these cases is answered and makes nothing;
// and destroying both leaves nothing of either, snapshot branches included.
import { CurrentCall, CurrentOperator, type OperationName } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { balanceOf, mintAll } from "../chain/faucet.ts";
import { ProofFailed } from "../failures.ts";
import { describeFailure } from "../lifecycle/describe.ts";
import { destroy } from "../lifecycle/operations.ts";
import { open, rpc } from "../lifecycle/parts.ts";
import { CAST_FUNDS } from "../platform/cast.ts";
import { create, Made, show, Tried } from "../platform/create.ts";
import { Operators } from "../platform/operators.ts";
import { restore, save } from "../platform/snapshots.ts";
import { check, conclude, inventoryReport, stackListing } from "./support.ts";

const isProofFailed = Schema.is(ProofFailed);
const OWNER = "proof-snap";
const OTHER = "proof-snap-2";
const FIRST = "p-snap";
const SECOND = "p-snap2";

const traceId = Effect.map(
  Effect.forEach(Arr.range(1, 32), () => Random.nextIntBetween(0, 16)),
  (digits) =>
    Arr.join(
      Arr.map(digits, (digit) => digit.toString(16)),
      "",
    ),
);

/** One handler call, as the platform's middlewares would hand it its operator and its call. */
const as = <A, E, R>(operator: string, operation: OperationName, call: Effect.Effect<A, E, R>) =>
  Effect.flatMap(traceId, (trace) =>
    call.pipe(
      Effect.provideService(CurrentOperator, { operator }),
      Effect.provideService(CurrentCall, { traceId: trace, operation }),
    ),
  );

/** What a call ended with: its refusal's tag, or `answered`. */
const ending = <A, E extends { readonly _tag: string }, R>(call: Effect.Effect<A, E, R>) =>
  call.pipe(Effect.match({ onSuccess: () => "answered", onFailure: (error) => error._tag }));

const Entries = Schema.Array(Schema.Struct({ event: Schema.String, payload: Schema.Unknown }));
const entriesOf = (name: string) =>
  Effect.flatMap(open(name), (world) =>
    world
      .sql("select event, payload from app.events order by id")
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Entries))),
  );
const usdcOf = (name: string, holder: string) =>
  Effect.flatMap(open(name), (world) => balanceOf((method, params) => rpc(world, method, params), holder));

const proof = Effect.gen(function* () {
  const before = yield* stackListing;
  const made = yield* as(
    OWNER,
    "world.create",
    create({ world: FIRST, grade: "private", lifetimeMinutes: 40, clock: { mode: "frozen", startAt: null } }),
  );
  const dana = yield* Effect.fromNullishOr(
    Arr.findFirst(made.cast, (each) => each.person === "dana").pipe(Option.getOrNull),
  );
  const danaSafe = dana.safe ?? "";
  const startBlock = yield* Effect.flatMap(open(FIRST), (world) =>
    rpc(world, "eth_getBlockByNumber", ["latest", false]),
  );
  const safes = Arr.flatMap(made.cast, (each) => (each.safe === null ? [] : [each.safe]));
  const funded = yield* Effect.forEach(safes, (safe) => usdcOf(FIRST, safe));
  const saved = yield* as(
    OWNER,
    "world.snapshot.save",
    save({ world: FIRST, snapshot: "s1", replace: false, template: false }),
  );
  const again = yield* ending(
    as(OWNER, "world.snapshot.save", save({ world: FIRST, snapshot: "s1", replace: false, template: false })),
  );
  const notOwner = yield* ending(
    as(OTHER, "world.snapshot.save", save({ world: FIRST, snapshot: "s2", replace: false, template: false })),
  );
  // The first world goes on after the save: dana's Safe is given 5 USDC more there.
  const first = yield* open(FIRST);
  yield* mintAll((method, params) => rpc(first, method, params), [{ to: danaSafe, amount: 5_000_000n }]);
  const missing = yield* ending(
    as(OWNER, "world.snapshot.restore", restore({ world: FIRST, snapshot: "m9", as: SECOND, lifetimeMinutes: 20 })),
  );
  const outlives = yield* ending(
    as(OWNER, "world.snapshot.restore", restore({ world: FIRST, snapshot: "s1", as: SECOND, lifetimeMinutes: 600 })),
  );
  const notTemplate = yield* ending(
    as(OTHER, "world.snapshot.restore", restore({ world: FIRST, snapshot: "s1", as: SECOND, lifetimeMinutes: 20 })),
  );
  const taken = yield* ending(
    as(OWNER, "world.snapshot.restore", restore({ world: FIRST, snapshot: "s1", as: FIRST, lifetimeMinutes: 20 })),
  );
  const restored = yield* as(
    OWNER,
    "world.snapshot.restore",
    restore({ world: FIRST, snapshot: "s1", as: SECOND, lifetimeMinutes: 20 }),
  );
  const shown = yield* as(OWNER, "world.show", show({ world: SECOND }));
  const firstEntries = yield* entriesOf(FIRST);
  const secondEntries = yield* entriesOf(SECOND);
  const danaThere = yield* usdcOf(SECOND, danaSafe);
  const danaHere = yield* usdcOf(FIRST, danaSafe);
  const firstAfter = yield* as(OWNER, "world.show", show({ world: FIRST }));
  yield* destroy(SECOND);
  yield* destroy(FIRST);
  const after = yield* stackListing;
  const report = inventoryReport(before, after, ["w-p-snap", "w-p-snap2"]);
  const checks = [
    check(
      "the new world runs, frozen, with no parent and its birth as its record",
      made.state === "running" && made.clock.mode === "frozen" && made.parent === null && made.recordHead === 1,
    ),
    check(
      "its cast is dana, eli, sam, pat and olga, pat with no Safe",
      Arr.join(
        Arr.map(made.cast, (each) => each.person),
        ",",
      ) === "dana,eli,sam,pat,olga" && made.cast[3]?.safe === null,
    ),
    check(
      "every claimed Safe holds 10,000 test USDC",
      funded.length === 4 && Arr.every(funded, (held) => held === CAST_FUNDS),
    ),
    check("the save holds the record up to its birth", saved.recordSeq === 1 && saved.companies === 0),
    check("saving the same name again is refused with SnapshotExists", again === "SnapshotExists"),
    check("a save by another operator is refused with NotWorldOwner", notOwner === "NotWorldOwner"),
    check(
      "a restore of a snapshot that does not exist is refused with SnapshotNotFound",
      missing === "SnapshotNotFound",
    ),
    check("a restore that outlives its source is refused with ExpiryBeyondSource", outlives === "ExpiryBeyondSource"),
    check("another operator may not restore a snapshot that is not a template", notTemplate === "NotWorldOwner"),
    check("a restore as a name that is taken is refused with WorldExists", taken === "WorldExists"),
    check(
      "the restored world names its parent and its record continues the snapshot's",
      restored.parent?.world === FIRST &&
        restored.parent.snapshot === "s1" &&
        restored.parent.recordSeq === 1 &&
        restored.recordHead === 2 &&
        shown.recordHead === 2,
    ),
    check(
      "the restored world's record is the first world's birth, then its own",
      Arr.join(
        Arr.map(secondEntries, (entry) => entry.event),
        ",",
      ) === "world_created,world_created",
    ),
    check(
      "the first world's record holds its birth and its save",
      Arr.join(
        Arr.map(firstEntries, (entry) => entry.event),
        ",",
      ) === "world_created,snapshot_saved",
    ),
    check(
      "the restored world's chain holds what was saved, not what the first world did after",
      danaThere === CAST_FUNDS && danaHere === CAST_FUNDS + 5_000_000n,
    ),
    check(
      "the restored world has the snapshot's clock and cast",
      shown.clock.now === saved.clock.now && shown.cast.length === made.cast.length,
    ),
    check(
      "the first world is still its own: no parent, and its record head moved only with its save",
      firstAfter.parent === null && firstAfter.recordHead === 2,
    ),
    check(
      "nothing of either world is left in the accounts, snapshot branches included",
      report.leftOfTheseWorlds.length === 0,
    ),
  ];
  return yield* conclude("snapshot", "the platform's four operations make, save and restore whole worlds", checks, {
    made,
    startBlock,
    saved,
    refusals: { again, notOwner, missing, outlives, notTemplate, taken },
    restored,
    entries: { first: firstEntries, second: secondEntries },
    danaSafe: { first: danaHere.toString(), second: danaThere.toString() },
    inventory: report,
  });
});

/** Whatever ends the proof early, its worlds go: the restored one first, as Neon needs. */
const cleanup = Effect.forEach([SECOND, FIRST], (name) => Effect.ignore(destroy(name)), { discard: true });

const operators = Layer.effect(
  Operators,
  Effect.gen(function* () {
    const first = Redacted.make(yield* traceId);
    const second = Redacted.make(yield* traceId);
    return { first: { name: OWNER, token: first }, second: Option.some({ name: OTHER, token: second }) };
  }),
);

/** The proof, with two operators of its own, fresh tokens for them, and its record of the worlds it made. */
export const snapshot = proof.pipe(
  Effect.onError(() => cleanup),
  Effect.mapError((error) =>
    isProofFailed(error) ? error : ProofFailed.make({ message: `snapshot: ${describeFailure(error)}` }),
  ),
  // A proof is its own program, as each of this package's proofs is, handed the platform's services it alone needs.
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the proof's own operators and its record of what it made
  Effect.provide(Layer.mergeAll(Made.layer, Tried.layer, operators)),
);
