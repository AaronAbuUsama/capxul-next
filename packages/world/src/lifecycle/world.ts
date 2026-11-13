// Bringing one world up and taking it down, step by step. Both are used by the lifecycle (run.ts), by the command
// line and by the sweeper.
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { ensureToken, mintAll, TEST_USDC } from "../chain/faucet.ts";
import { migrate } from "../database/sql.ts";
import { deployStage, destroyStage, forgetStage, recordOutput, recordedOutput } from "../stack/engine.ts";
import { InvalidWorldName, nameOf, PLATFORM, stageOf, WorldName } from "../stack/names.ts";
import { liftBranchExpiry } from "./account.ts";
import { claim, registry, release } from "./claim.ts";
import { expiryOf, lifetimeAllowed } from "./expiry.ts";
import { adoptChain, chainAnswers, coreAnswers, handle, indexReady, open, rpc, WorldOutput } from "./parts.ts";
import { LifetimeTooLong, Limits, type World, WorldNotFound, type WorldSpec } from "./spec.ts";
import type { Stopwatch } from "./steps.ts";

/** The migrations of the placeholder Core, applied when the caller names no directory of its own. */
export const DEFAULT_MIGRATIONS = `${import.meta.dirname}/../../migrations`;

/** What is known about a world before anything of it exists. */
export interface Plan {
  readonly stage: string;
  readonly owner: string;
  readonly expiresAt: string;
  readonly forkedFrom: Option.Option<string>;
}

/** Checks the name and decides the expiry. Nothing is created. */
export const planOf = Effect.fn("world.plan")(function* (spec: WorldSpec) {
  yield* Schema.decodeUnknownEffect(WorldName)(nameOf(spec.name)).pipe(
    Effect.mapError(
      () => new InvalidWorldName({ name: spec.name, message: "a world's name is 2 to 15 lower case letters, digits or dashes, starting with a letter" }),
    ),
  );
  const { maxLifetime } = yield* Limits;
  if (!lifetimeAllowed(spec.lifetime, maxLifetime)) {
    const [askedMs, mostMs] = [Duration.toMillis(spec.lifetime), Duration.toMillis(maxLifetime)];
    return yield* new LifetimeTooLong({
      world: stageOf(spec.name),
      askedMs,
      mostMs,
      message: `a world may live at most ${Duration.format(maxLifetime)}; ${Duration.format(spec.lifetime)} was asked for`,
    });
  }
  return {
    stage: stageOf(spec.name),
    owner: spec.owner,
    expiresAt: expiryOf(yield* DateTime.now, spec.lifetime),
    forkedFrom: Option.map(Option.fromNullishOr(spec.from), stageOf),
  } satisfies Plan;
});

const recordOf = (plan: Plan, status: string) => ({
  world: plan.stage,
  owner: plan.owner,
  expiresAt: plan.expiresAt,
  forkedFrom: Option.getOrElse(plan.forkedFrom, () => "nothing"),
  status,
});

const Platform = Schema.Struct({ projectId: Schema.String });

/**
 * Lets `child` be made from `parent`: Neon will not fork a branch that has an expiry of its own, so the parent's is
 * taken off, and the parent's record in the shared state says so. The parent still expires: the sweeper reads its
 * recorded expiry, not Neon's.
 */
const makeForkable = (parent: string, child: string) =>
  Effect.gen(function* () {
    const { projectId } = yield* Schema.decodeUnknownEffect(Platform)(yield* recordedOutput(PLATFORM));
    const output = yield* recordedOutput(parent);
    const { branch } = yield* Schema.decodeUnknownEffect(WorldOutput)(output);
    yield* liftBranchExpiry(projectId, branch);
    yield* recordOutput(parent, { ...(typeof output === "object" && output !== null ? output : {}), neonExpiry: `lifted so that ${child} could be made from it` });
  });

/**
 * Brings the world up. The name is claimed first, and `held` is set the moment the claim holds, so whoever runs
 * this knows whether there is anything of theirs to take down. Owner and expiry are written to the shared state
 * before the deploy, so a world whose creation dies half-way is still found, and deleted, by the sweeper.
 */
export const bringUp = (spec: WorldSpec, plan: Plan, watch: Stopwatch, held: Ref.Ref<Option.Option<string>>) =>
  Effect.gen(function* () {
    const parent = Option.isSome(plan.forkedFrom) ? Option.some(yield* open(plan.forkedFrom.value)) : Option.none();
    yield* watch.step(
      "claim",
      Effect.gen(function* () {
        const names = yield* registry;
        const { maxPerOwner } = yield* Limits;
        yield* claim(names, plan.stage, plan.owner, plan.expiresAt, maxPerOwner).pipe(
          Effect.tap((holder) => Ref.set(held, Option.some(holder))),
          Effect.uninterruptible,
        );
        yield* recordOutput(plan.stage, recordOf(plan, "creating"));
      }),
    );
    yield* Effect.logInfo(`world ${plan.stage}: claimed for ${plan.owner} until ${plan.expiresAt}`);
    const output = yield* watch.step(
      "deploy",
      Effect.gen(function* () {
        if (Option.isSome(plan.forkedFrom)) yield* makeForkable(plan.forkedFrom.value, plan.stage);
        const settings = { owner: plan.owner, expiresAt: plan.expiresAt, forkedFrom: plan.forkedFrom };
        return yield* deployStage(plan.stage, Option.some(settings)).pipe(Effect.flatMap(Schema.decodeUnknownEffect(WorldOutput)));
      }),
    );
    const world = yield* handle(output);
    yield* Effect.logInfo(`world ${plan.stage}: deployed`);
    const applied = yield* watch.step("migrate", migrate(world.database, spec.migrations ?? DEFAULT_MIGRATIONS));
    yield* Effect.logInfo(`world ${plan.stage}: migrations applied (${applied.join(", ") || "none new"})`);
    yield* watch.step(
      "chain",
      Effect.gen(function* () {
        if (Option.isSome(parent)) yield* adoptChain(world, parent.value);
        return yield* chainAnswers(world);
      }),
    );
    yield* Effect.logInfo(`world ${plan.stage}: the chain answers`);
    const call = (method: string, params: ReadonlyArray<unknown>) => rpc(world, method, params);
    const funded = yield* watch.step("fund", Effect.andThen(ensureToken(call), mintAll(call, spec.mint ?? [])));
    yield* Effect.logInfo(`world ${plan.stage}: test USDC at ${TEST_USDC}, minted to ${funded.length} addresses`);
    yield* watch.step("index", indexReady(world));
    yield* Effect.logInfo(`world ${plan.stage}: the index is ready`);
    yield* watch.step("core", coreAnswers(world));
    yield* Effect.logInfo(`world ${plan.stage}: Core answers`);
    return { ...world, funded } satisfies World;
  });

/**
 * Takes a world down: destroys everything its stage created, removes what the shared state still holds for it, and
 * gives its name back. It works from the shared state alone, so it also removes a world that was only half created.
 */
export const takeDown = (stage: string, watch: Stopwatch, holder: Option.Option<string> = Option.none()) =>
  Effect.gen(function* () {
    const removed = yield* watch.step("destroy", destroyStage(stage).pipe(Effect.tap(() => forgetStage(stage))));
    yield* watch.step(
      "release",
      registry.pipe(Effect.flatMap((names) => release(names, stage, Option.getOrUndefined(holder)))),
    );
    yield* Effect.logInfo(`world ${stage}: destroyed (${removed} resources) and its name released`);
    return removed;
  });

/** Fails unless the shared state holds something for the world. */
export const mustExist = Effect.fn("world.mustExist")(function* (name: string) {
  const stage = stageOf(name);
  const output = yield* recordedOutput(stage);
  if (output === undefined) return yield* new WorldNotFound({ world: stage, message: `the shared state holds no world called ${nameOf(stage)}` });
  return stage;
});

/** Marks a kept world in the shared state, so a listing says why it is still there. */
export const markParked = (output: unknown) =>
  Schema.decodeUnknownEffect(WorldOutput)(output).pipe(
    Effect.flatMap((world) => recordOutput(world.world, { ...world, status: "parked" })),
  );
