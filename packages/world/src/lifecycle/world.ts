// Bringing one world up, taking it down and parking it, step by step. Used by the lifecycle (run.ts), by the
// command line and by the sweeper.
import { Errors } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { CoreHost } from "../core/host.ts";
import { LifetimeTooLong, SiteFailed } from "../failures.ts";
import { forget, openHub } from "../hub/hub.ts";
import { BenchStage, removeSites } from "../site/Bench.ts";
import { destroyStage, forgetStage, recordOutput, recordedOutput } from "../stack/engine.ts";
import { stageOf } from "../stack/names.ts";
import { dropBranches } from "../platform/branches.ts";
import { registry, release } from "./claim.ts";
import { expiryOf, lifetimeAllowed } from "./expiry.ts";
import { WorldOutput } from "./handle.ts";
import { forgetWorld } from "./kept.ts";
import { open, stop } from "./parts.ts";
import { Limits, type WorldSpec } from "./spec.ts";
import type { Stopwatch } from "./steps.ts";
import { describe } from "./describe.ts";
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
  if (Arr.isReadonlyArrayNonEmpty(spec.companies ?? []) && Option.isNone(yield* BenchStage))
    return yield* SiteFailed.make({
      step: "plan",
      message: "companies need a bench: set WORLD_BENCH to a platform stage",
    });
  return {
    stage: stageOf(name),
    owner,
    expiresAt: expiryOf(yield* DateTime.now, spec.lifetime),
    forkedFrom: Option.map(from, stageOf),
  } satisfies Plan;
});

/** The bench a world's outputs name, so its take-down finds its sites whatever `WORLD_BENCH` says then. */
const benchOf = (output: unknown): Option.Option<string> =>
  Option.filter(
    Option.flatMap(Schema.decodeUnknownOption(Schema.Struct({ bench: Schema.String }))(output), (found) =>
      Option.some(found.bench),
    ),
    (bench) => bench !== "none",
  );

/** Stops the world's Core where its host runs it; nothing when no host does. */
const unhostCore = (stage: string) =>
  Effect.flatMap(CoreHost, (host) => (Option.isSome(host) ? host.value.stop(stage) : Effect.void));

/**
 * Takes a world down: destroys everything its stage created, removes what the shared state still holds for it, and
 * gives its name back. It works from the shared state alone, so it also removes a world that was only half created.
 */
export const takeDown = (stage: string, watch: Stopwatch, holder: Option.Option<string> = Option.none()) =>
  Effect.gen(function* () {
    // The sites go first, and their removal is not allowed to stop the destroy. If it or the destroy fails, the
    // world's remains are recorded again (`keepRemains`) and its name is kept, so the sweeper, which reads them, takes
    // the world down again at its next sweep, its sites first.
    const recorded = yield* recordedOutput(stage);
    const bench = benchOf(recorded);
    const unsited = yield* Effect.exit(watch.step("unsite", removeSites(stage, bench)));
    yield* unhostCore(stage);
    const destroyed = yield* Effect.exit(
      watch.step(
        "destroy",
        // Its hub's part (containers, objects, saved chain states), its stack (Core, the Hyperdrive configuration, its
        // secrets) and every branch of it (its own, its snapshots' and what in-place resets preserved, children first)
        // do not depend on one another, so they go side by side.
        Effect.all([forgetOnHub(stage, recorded), destroyStage(stage), dropBranches(stage)], { concurrency: 3 }).pipe(
          Effect.map(([, resources]) => resources),
        ),
      ),
    );
    if (Exit.isFailure(destroyed)) {
      yield* keepRemains(stage, recorded, "destroy failed");
      return yield* Effect.failCause(destroyed.cause);
    }
    if (Exit.isFailure(unsited)) {
      yield* keepRemains(stage, recorded, "unsite failed");
      return yield* Effect.failCause(unsited.cause);
    }
    yield* forgetStage(stage);
    yield* watch.step(
      "release",
      Effect.flatMap(registry, (names) => release(names, stage, holder)),
    );
    yield* Effect.logInfo(`world ${stage}: destroyed (${destroyed.value} resources) and its name released`);
    return destroyed.value;
  }).pipe(Effect.ensuring(forgetWorld(stage)));

/** What a world's record says that its take-down needs again: who owns it, its bench, its hub. */
const Remains = Schema.Struct({
  owner: Schema.optionalKey(Schema.String),
  forkedFrom: Schema.optionalKey(Schema.String),
  bench: Schema.optionalKey(Schema.String),
  hub: Schema.optionalKey(Schema.String),
});

/**
 * Records what is left of a world whose take-down did not finish, due at once, so `world list` shows it and the next
 * sweep takes it down again. Alchemy's destroy deletes the stage's record with its resources, so a destroy that went
 * through leaves nothing for the sweeper to read: then the record is written again, with its owner, its bench and,
 * when the destroy itself failed, its hub. A record the destroy did not reach keeps what it says. Nothing here may
 * hide the take-down's own failure, so a failure to record is logged and nothing more.
 */
const keepRemains = (stage: string, recorded: unknown, status: "unsite failed" | "destroy failed") =>
  Effect.gen(function* () {
    const still = yield* recordedOutput(stage);
    const remains = Option.getOrElse(Schema.decodeUnknownOption(Remains)(recorded), (): typeof Remains.Type => ({}));
    const { hub, ...rest } = remains;
    const base =
      still !== undefined && Predicate.isObject(still)
        ? still
        : { ...rest, ...(status === "destroy failed" && hub !== undefined ? { hub } : {}), world: stage };
    yield* recordOutput(stage, { ...base, status, expiresAt: DateTime.formatIso(yield* DateTime.now) });
    yield* Effect.logWarning(`world ${stage}: ${status}; its record is kept, due at once, for the next sweep`);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError(`world ${stage}: its remains could not be recorded: ${describe(cause)}`),
    ),
  );

/**
 * Removes everything of the world from its hub: its containers, its Durable Objects' state and its saved chain states.
 * A world whose record names no hub (it died before its claim was recorded) has nothing there.
 */
const forgetOnHub = (stage: string, recorded: unknown) =>
  Option.match(Schema.decodeUnknownOption(Schema.Struct({ hub: Schema.String }))(recorded), {
    onNone: () => Effect.void,
    onSome: ({ hub }) =>
      openHub(hub).pipe(
        Effect.flatMap((found) => forget(found, stage)),
        Effect.asVoid,
      ),
  });

/** A world's stage and what the shared state holds for it, read once, or the contract's WorldNotFound. */
export const recordedWorld = Effect.fn("world.mustExist")(function* (name: string) {
  const checked = yield* checkName(name);
  const stage = stageOf(checked);
  const recorded = yield* recordedOutput(stage);
  if (recorded === undefined) return yield* Errors.WorldNotFound.make({ world: checked });
  return { stage, recorded };
});

/** Fails with the contract's WorldNotFound unless the shared state holds something for the world. */
export const mustExist = (name: string) => Effect.map(recordedWorld(name), (found) => found.stage);

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
