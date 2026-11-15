// world.create and world.show, as the platform serves them (decisions.md, 13 to 15, 20 and 25). A new world is this
// package's create (src/things/world), owned by the calling operator, with its owner's token bound into its Core; then
// its cast is claimed and funded on its chain, its start block mined, its facts written into its database and its
// `world_created` into its record. It answers once the world runs. Nothing is made for a refused call: the grade and
// the clock are refused before the name is claimed, and the registry refuses a taken name or a full quota.
import { CurrentOperator, Errors, type World as Blueprint } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { CHAIN_ID } from "../parts/chain/Anvil.ts";
import { CONTRACTS, SEED_HEAD, SETUP_ROOM_SECONDS } from "../parts/chain/contracts.ts";
import { rpc } from "../things/world/client.ts";
import { create as createWorld } from "../things/world/create.ts";
import { destroy } from "../things/world/destroy.ts";
import { mustExist, recordedWorld } from "../things/world/take-down.ts";
import { stageOf } from "../stack/names.ts";
import { makeCast, type Member } from "../things/world/cast.ts";
import { refusalsOnly } from "./refusals.ts";
import { instantOf, writeBirth } from "../things/world/store.ts";
import { tokenOf } from "./operators.ts";
import { emitDeclared, viewOf } from "./view.ts";

type CreatePayload = (typeof Blueprint.create.rpc.payloadSchema)["Type"];
type ShowPayload = (typeof Blueprint.show.rpc.payloadSchema)["Type"];

/** Every world the platform made in this process, in order, by stage: what its caller must see destroyed. */
export class Made extends Context.Service<Made, Ref.Ref<ReadonlyArray<string>>>()("@capxul/world/account/worlds/Made") {
  static readonly layer = Layer.effect(Made, Ref.make<ReadonlyArray<string>>([]));
}

/**
 * Every world the platform tried to make in this process, by stage, the refused and the failed included: what a
 * caller reads the accounts for afterwards. A create that fails after its claim takes down what it made itself.
 */
export class Tried extends Context.Service<Tried, Ref.Ref<ReadonlyArray<string>>>()(
  "@capxul/world/account/worlds/Tried",
) {
  static readonly layer = Layer.effect(Tried, Ref.make<ReadonlyArray<string>>([]));
}

/** Notes that a world of this name is about to be made. */
export const tried = (world: string) =>
  Effect.flatMap(Effect.service(Tried), (all) => Ref.update(all, (was) => [...was, stageOf(world)]));

/** The earliest a world may start: the seed's last block, and room for the blocks that make the world. */
export const EARLIEST_MS = (SEED_HEAD.timestamp + SETUP_ROOM_SECONDS) * 1000;

const isNotFound = Schema.is(Errors.WorldNotFound);
/** The registry's refusals of a new world: its name is taken, or its owner has as many as one may. */
export const isTaken = Schema.is(Schema.Union([Errors.WorldExists, Errors.WorldQuotaReached]));

/** The stage of a world the shared state holds, or the contract's WorldNotFound; any other failure is a fault. */
export const existing = (world: string) => mustExist(world).pipe(refusalsOnly(isNotFound));

/** As `existing`, with what the shared state holds for the world, so a caller does not read it again. */
export const existingRecorded = (world: string) => recordedWorld(world).pipe(refusalsOnly(isNotFound));

const millisOf = (instant: string) => DateTime.toEpochMillis(DateTime.makeUnsafe(instant));

/** The world's token for its owner: the operator's own, which the platform holds for every operator it signs in. */
const ownerToken = (operator: string) =>
  Effect.flatMap(tokenOf(operator), (token) =>
    Option.match(token, {
      onNone: () => Effect.die(`the platform holds no token for ${operator}`),
      onSome: (found) => Effect.succeed(found),
    }),
  );

/** Notes a world as made, and destroys it if what follows fails, so a refused or failed call leaves nothing. */
export const keptOrDestroyed = <A, E, R>(stage: string, rest: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const made = yield* Made;
    yield* Ref.update(made, (all) => [...all, stage]);
    return yield* rest.pipe(
      Effect.onError(() =>
        destroy(stage).pipe(
          Effect.andThen(Ref.update(made, (all) => Arr.filter(all, (each) => each !== stage))),
          Effect.ignore,
        ),
      ),
    );
  });

export const create = Effect.fn("platform.world.create")(function* (payload: CreatePayload) {
  const { operator } = yield* CurrentOperator;
  if (payload.grade === "real") return yield* Errors.GradeNotOffered.make({ grade: payload.grade });
  const hostMs = yield* Clock.currentTimeMillis;
  const startMs = payload.clock.startAt === null ? hostMs : millisOf(payload.clock.startAt);
  if (startMs < EARLIEST_MS)
    return yield* Errors.ClockBeforeSeed.make({
      asked: payload.clock.startAt ?? instantOf(startMs),
      earliest: instantOf(EARLIEST_MS),
    });
  yield* tried(payload.world);
  // The cast is claimed and funded on the chain's lane of the create, beside alto's start and while the database's
  // lane deploys Core and starts the index (src/things/world/bring-up.ts).
  const cast = yield* Deferred.make<ReadonlyArray<Member>>();
  const made = yield* createWorld({
    name: payload.world,
    owner: operator,
    lifetime: Duration.minutes(payload.lifetimeMinutes),
    operatorToken: yield* ownerToken(operator),
    atSeed: true,
    startAtMs: startMs,
    onChain: (world) =>
      Effect.flatMap(
        makeCast((method, params) => rpc(world, method, params)),
        (members) => Deferred.succeed(cast, members),
      ),
  }).pipe(refusalsOnly(isTaken));
  const stage = made.world.stage;
  return yield* keptOrDestroyed(
    stage,
    Effect.gen(function* () {
      const members = yield* Deferred.await(cast);
      const bornAtMs = yield* Clock.currentTimeMillis;
      // The view is what was just made, not read back: the world's facts and its record's first entry are written
      // side by side (src/account/view.ts reads the same rows for world.show).
      const view = {
        world: payload.world,
        owner: operator,
        grade: payload.grade,
        state: "running" as const,
        expiresAt: made.world.expiresAt,
        door: made.world.coreUrl,
        chainId: CHAIN_ID,
        contracts: CONTRACTS,
        clock: { mode: payload.clock.mode, now: instantOf(startMs) },
        recordHead: 1,
        parent: null,
        cast: members,
        companies: [],
      };
      yield* Effect.all(
        [
          writeBirth(made.world.database, {
            chainId: CHAIN_ID,
            contracts: CONTRACTS,
            clock: { mode: payload.clock.mode, worldMs: startMs, hostMs: bornAtMs },
            cast: members,
          }),
          emitDeclared("world.create", { payload, success: view }, stage, made.world.database, startMs),
        ],
        { concurrency: 2 },
      );
      return view;
    }).pipe(Effect.orDie),
  );
});

export const show = Effect.fn("platform.world.show")(function* (payload: ShowPayload) {
  const { stage, recorded } = yield* existingRecorded(payload.world);
  const { view } = yield* viewOf(stage, {}, { recorded }).pipe(Effect.orDie);
  return view;
});
