// Bringing one world up, taking it down and parking it, step by step. Used by the lifecycle (run.ts), by the
// command line and by the sweeper.
import { Errors } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { bringUpBundler } from "../bundler/setup.ts";
import { ensureToken, mintAll, TEST_USDC } from "../chain/faucet.ts";
import { CORE_MIGRATIONS } from "../core/Core.ts";
import { migrate } from "../database/sql.ts";
import { LifetimeTooLong } from "../failures.ts";
import { deployStage, destroyStage, forgetStage, recordOutput, recordedOutput } from "../stack/engine.ts";
import { PLATFORM, stageOf } from "../stack/names.ts";
import { liftBranchExpiry } from "./account.ts";
import { claim, registry, release } from "./claim.ts";
import { expiryOf, lifetimeAllowed } from "./expiry.ts";
import { adoptChain, chainAnswers, coreAnswers, handle, indexReady, open, rpc, stop, WorldOutput } from "./parts.ts";
import { Limits, type World, type WorldSpec } from "./spec.ts";
import type { Stopwatch } from "./steps.ts";
import { checkName, checkOwner } from "./validate.ts";

/** What is known about a world before anything of it exists. */
export interface Plan {
  readonly stage: string;
  readonly owner: string;
  readonly expiresAt: string;
  readonly forkedFrom: Option.Option<string>;
}

/** Checks the name, the owner and the lifetime, and decides the expiry. Nothing is created. */
export const planOf = Effect.fn("world.plan")(function* (spec: WorldSpec) {
  const name = yield* checkName(spec.name);
  const owner = yield* checkOwner(spec.owner);
  const from = yield* Effect.transposeOption(Option.map(Option.fromUndefinedOr(spec.from), checkName));
  const { maxLifetime } = yield* Limits;
  if (!lifetimeAllowed(spec.lifetime, maxLifetime)) {
    return yield* LifetimeTooLong.make({
      world: name,
      askedMs: Duration.toMillis(spec.lifetime),
      mostMs: Duration.toMillis(maxLifetime),
      message: `a world may live at most ${Duration.format(maxLifetime)}; ${Duration.format(spec.lifetime)} was asked for`,
    });
  }
  return {
    stage: stageOf(name),
    owner,
    expiresAt: expiryOf(yield* DateTime.now, spec.lifetime),
    forkedFrom: Option.map(from, stageOf),
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
const makeForkable = Effect.fn("world.makeForkable")(function* (parent: string, child: string) {
  const { projectId } = yield* Schema.decodeUnknownEffect(Platform)(yield* recordedOutput(PLATFORM));
  const output = yield* Schema.decodeUnknownEffect(WorldOutput)(yield* recordedOutput(parent));
  yield* liftBranchExpiry(projectId, output.branch);
  yield* recordOutput(parent, { ...output, neonExpiry: `lifted so that ${child} could be made from it` });
});

/**
 * Brings the world up. The name is claimed first, and `held` is set the moment the claim holds, so whoever runs
 * this knows whether there is anything of theirs to take down. Owner and expiry are written to the shared state
 * before the deploy, so a world whose creation dies half-way is still found, and deleted, by the sweeper.
 */
export const bringUp = (spec: WorldSpec, plan: Plan, watch: Stopwatch, held: Ref.Ref<Option.Option<string>>) =>
  Effect.gen(function* () {
    const parent = yield* Effect.transposeOption(Option.map(plan.forkedFrom, open));
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
        return yield* deployStage(plan.stage, Option.some(settings)).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(WorldOutput)),
        );
      }),
    );
    const world = yield* handle(output);
    yield* Effect.logInfo(`world ${plan.stage}: deployed`);
    const applied = yield* watch.step("migrate", migrate(world.database, spec.migrations ?? CORE_MIGRATIONS));
    const migrated = Arr.isReadonlyArrayEmpty(applied) ? "none new" : Arr.join(applied, ", ");
    yield* Effect.logInfo(`world ${plan.stage}: migrations applied (${migrated})`);
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
    // The index and the bundler come up side by side: neither waits on the other, and each step has its own duration.
    const [, bundler] = yield* Effect.all(
      [watch.step("index", indexReady(world)), watch.step("bundler", bringUpBundler(world, call))],
      { concurrency: 2 },
    );
    yield* Effect.logInfo(`world ${plan.stage}: the index is ready`);
    yield* Effect.logInfo(
      `world ${plan.stage}: the bundler serves ${Arr.join(bundler.entryPoints, ", ")}, paymaster ${world.paymaster}`,
    );
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
      Effect.flatMap(registry, (names) => release(names, stage, holder)),
    );
    yield* Effect.logInfo(`world ${stage}: destroyed (${removed} resources) and its name released`);
    return removed;
  });

/** Fails with the contract's WorldNotFound unless the shared state holds something for the world. */
export const mustExist = Effect.fn("world.mustExist")(function* (name: string) {
  const checked = yield* checkName(name);
  const stage = stageOf(checked);
  if ((yield* recordedOutput(stage)) === undefined) return yield* Errors.WorldNotFound.make({ world: checked });
  return stage;
});

/** The moment a kept world is deleted: `keepFor` from now, at most the declared limit, never past its own expiry. */
export const keptUntil = (
  now: DateTime.Utc,
  expiresAt: string,
  keepFor: Duration.Duration,
  maxKeep: Duration.Duration,
) =>
  DateTime.formatIso(
    DateTime.min(DateTime.addDuration(now, Duration.min(keepFor, maxKeep)), DateTime.makeUnsafe(expiresAt)),
  );

/**
 * Parks a world that is kept after a failure: its chain is saved and both containers are stopped, so it costs
 * nothing while it waits, and its recorded expiry becomes the end of its keep, so the sweeper deletes it then.
 */
export const park = Effect.fn("world.park")(function* (stage: string, until: string) {
  const output = yield* Schema.decodeUnknownEffect(WorldOutput)(yield* recordedOutput(stage));
  yield* Effect.flatMap(open(stage), stop);
  yield* recordOutput(stage, { ...output, status: "parked", expiresAt: until, expiryBeforeParking: output.expiresAt });
});
