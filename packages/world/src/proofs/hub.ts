// Proof (roadmap step 1.15): on the fleet hub, `world.create` makes a world whose chain, index and bundler answer and
// whose Core answers, with its migrations and its cast, in under 20 s, and `world destroy` removes it in a few
// seconds, its Durable Objects' state and its saved chain states included. Three worlds, one after another, each made
// through the platform's handler as `world.create` serves it and destroyed before the next; the hub's containers are
// read before and after (what it runs when no world is in use). Nothing of the three is left in the accounts or in
// the hub's ledger, and the hub refuses a destroyed world's token.
import { CurrentCall, CurrentOperator } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { servesEntryPoint } from "../bundler/client.ts";
import { ProofFailed } from "../failures.ts";
import { HubStage, ledger, openHub } from "../hub/hub.ts";
import { hubContainers, hubIdle } from "../hub/idle.ts";
import { describeFailure } from "../lifecycle/describe.ts";
import { destroy } from "../lifecycle/operations.ts";
import { coreAnswers, indexStatus, open, partStatus, rpcHex } from "../lifecycle/parts.ts";
import { create, Made, Tried } from "../platform/create.ts";
import { Operators } from "../platform/operators.ts";
import { check, conclude, inventoryReport, stackListing } from "./support.ts";

const isProofFailed = Schema.is(ProofFailed);
const OWNER = "proof-hub";
const WORLDS = ["p-hub1", "p-hub2", "p-hub3"];
/** The step's promise: a world in under 20 s, Core, migrations and the cast included. */
const CREATE_MS = 20_000;
/** "A few seconds": the slowest destroy measured before the hub was 18 s (spikes/world-speed, 1.6). */
const DESTROY_MS = 8_000;

const hex32 = Effect.map(
  Effect.forEach(Arr.range(1, 32), () => Random.nextIntBetween(0, 16)),
  (digits) =>
    Arr.join(
      Arr.map(digits, (digit) => digit.toString(16)),
      "",
    ),
);

/** One world: made by the platform's world.create, every part asked, then destroyed; each timed. */
const oneWorld = (name: string) =>
  Effect.gen(function* () {
    const trace = yield* hex32;
    const began = yield* Clock.currentTimeMillis;
    const view = yield* create({
      world: name,
      grade: "private",
      lifetimeMinutes: 30,
      clock: { mode: "running", startAt: null },
    }).pipe(
      Effect.provideService(CurrentOperator, { operator: OWNER }),
      Effect.provideService(CurrentCall, { traceId: trace, operation: "world.create" }),
    );
    const createMs = (yield* Clock.currentTimeMillis) - began;
    const world = yield* open(name);
    const chainId = yield* rpcHex(world, "eth_chainId");
    const index = yield* indexStatus(world);
    const entryPoints = yield* servesEntryPoint(world);
    const core = yield* coreAnswers(world);
    const parts = {
      chain: yield* partStatus(world, "chain"),
      index: yield* partStatus(world, "index"),
    };
    const destroyBegan = yield* Clock.currentTimeMillis;
    const destroyed = yield* destroy(name);
    const destroyMs = (yield* Clock.currentTimeMillis) - destroyBegan;
    // The world's token, once it is forgotten, reaches nothing.
    const afterwards = yield* Effect.exit(rpcHex(world, "eth_chainId"));
    return {
      world: name,
      createMs,
      destroyMs,
      destroySteps: destroyed.ms,
      answered: {
        chainId,
        indexReady: index.ready === 200,
        entryPoints,
        core: core.world,
        cast: Arr.map(view.cast, (member) => ({ person: member.person, safe: member.safe })),
        recordHead: view.recordHead,
      },
      parts,
      tokenRefusedAfterDestroy: Exit.isFailure(afterwards),
      refusedWith: Exit.isFailure(afterwards) ? describeFailure(afterwards.cause) : null,
    };
  });

const proof = Effect.gen(function* () {
  const stage = yield* HubStage;
  const hub = yield* openHub(stage);
  const before = yield* stackListing;
  const containersBefore = yield* hubContainers(stage);
  const runs = yield* Effect.forEach(WORLDS, oneWorld);
  const { containers: containersAfter, idleAfterMs } = yield* hubIdle(stage);
  const held = yield* ledger(hub);
  const report = inventoryReport(
    before,
    yield* stackListing,
    Arr.map(WORLDS, (name) => `w-${name}`),
  );
  const checks = [
    check(
      "each world's chain, index and bundler answered and its Core answered, its cast made",
      Arr.every(
        runs,
        (run) =>
          run.answered.chainId === "0x14a34" &&
          run.answered.indexReady &&
          Arr.isReadonlyArrayNonEmpty(run.answered.entryPoints) &&
          Arr.length(Arr.filter(run.answered.cast, (member) => member.safe !== null)) === 4,
      ),
    ),
    check(
      `each world.create took under ${CREATE_MS / 1000} s`,
      Arr.every(runs, (run) => run.createMs < CREATE_MS),
    ),
    check(
      `each destroy took under ${DESTROY_MS / 1000} s`,
      Arr.every(runs, (run) => run.destroyMs < DESTROY_MS),
    ),
    check(
      "a destroyed world's token reaches nothing on the hub",
      Arr.every(runs, (run) => run.tokenRefusedAfterDestroy),
    ),
    check(
      "the hub's ledger holds none of the three",
      !Arr.some(held, (world) => Arr.contains(WORLDS, Str.replace(/^w-/, "")(world))),
    ),
    check(
      "the hub runs no container within a minute of the worlds being gone",
      Arr.every(containersAfter, (app) => app.active === 0),
    ),
    check("nothing of the three worlds is left in the accounts", report.leftOfTheseWorlds.length === 0),
  ];
  return yield* conclude(
    "hub",
    "on the fleet hub a world is made, with Core, migrations and its cast, in under 20 s, and destroyed in a few seconds",
    checks,
    {
      hub: { stage: hub.stage, owner: hub.owner, expiresAt: hub.expiresAt, doorUrl: hub.doorUrl },
      runs,
      createMs: Arr.map(runs, (run) => run.createMs),
      destroyMs: Arr.map(runs, (run) => run.destroyMs),
      containersBefore,
      containersAfter,
      idleAfterMs,
      ledgerAfter: held,
      inventory: report,
    },
  );
});

const cleanup = Effect.forEach(WORLDS, (name) => Effect.ignore(destroy(name)), { discard: true });

const operators = Layer.effect(
  Operators,
  Effect.map(hex32, (token) => ({ first: { name: OWNER, token: Redacted.make(token) }, second: Option.none() })),
);

/** The proof, with an operator of its own and its record of the worlds it made. */
export const hubProof = proof.pipe(
  Effect.onError(() => cleanup),
  Effect.mapError((error) =>
    isProofFailed(error) ? error : ProofFailed.make({ message: `hub: ${describeFailure(error)}` }),
  ),
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the proof's own operator and its record of what it made
  Effect.provide(Layer.mergeAll(Made.layer, Tried.layer, operators)),
);
