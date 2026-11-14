// Bringing one world up, taking it down and parking it, step by step. Used by the lifecycle (run.ts), by the
// command line and by the sweeper.
import { Errors } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
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
import { open, stop, WorldOutput } from "./parts.ts";
import { Limits, type WorldSpec } from "./spec.ts";
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
    // The sites go first, and their removal is not allowed to stop the destroy. If it fails, the world's record and
    // its name are kept, so the sweeper, which reads them, removes the sites at the next sweep.
    const recorded = yield* recordedOutput(stage);
    const bench = benchOf(recorded);
    const unsited = yield* Effect.exit(watch.step("unsite", removeSites(stage, bench)));
    yield* unhostCore(stage);
    const removed = yield* watch.step(
      "destroy",
      // Its hub's part (containers, objects, saved chain states), its stack (Core, the Hyperdrive configuration, its
      // secrets) and every branch of it (its own, its snapshots' and what in-place resets preserved, children first)
      // do not depend on one another, so they go side by side.
      Effect.all([forgetOnHub(stage, recorded), destroyStage(stage), dropBranches(stage)], { concurrency: 3 }).pipe(
        Effect.map(([, resources]) => resources),
        Effect.tap(() => (Exit.isSuccess(unsited) ? forgetStage(stage) : Effect.void)),
      ),
    );
    if (Exit.isFailure(unsited)) return yield* Effect.failCause(unsited.cause);
    yield* watch.step(
      "release",
      Effect.flatMap(registry, (names) => release(names, stage, holder)),
    );
    yield* Effect.logInfo(`world ${stage}: destroyed (${removed} resources) and its name released`);
    return removed;
  });

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
