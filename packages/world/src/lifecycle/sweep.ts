// The sweeper: deletes every world whose recorded expiry has passed, and leaves the rest (roadmap rule 2).
//
// It works from the shared state store alone, so it runs in any container, on a schedule, long after the container
// that created a world is gone. A world that recorded no expiry, or one it cannot read, is never deleted: it is
// left in place and reported, so a person can decide. After the worlds, it removes what `alchemy destroy` leaves
// behind: image repositories of this stack that nothing accounts for any more, and names still held in the
// registry by worlds that no longer exist.
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { recordedStages } from "../stack/engine.ts";
import { CHAIN_IMAGE, IMAGE_PREFIX, INDEX_IMAGE, isWorldStage, PLATFORM } from "../stack/names.ts";
import { imageRepositories, removeImageRepositories } from "./account.ts";
import { claims, registry, release } from "./claim.ts";
import { classify, decide, leftoverRepositories, Verdict } from "./expiry.ts";
import { describe } from "./run.ts";
import { Timeouts } from "./spec.ts";
import { makeStopwatch } from "./steps.ts";
import { takeDown } from "./world.ts";

export const WorldReport = Schema.Struct({
  world: Schema.String,
  owner: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.String),
  verdict: Verdict,
  /** Why a destroy failed, or what could not be read. */
  detail: Schema.NullOr(Schema.String),
  destroyMs: Schema.NullOr(Schema.Number),
});
export type WorldReport = typeof WorldReport.Type;

export const SweepReport = Schema.Struct({
  at: Schema.String,
  dryRun: Schema.Boolean,
  worlds: Schema.Array(WorldReport),
  /** Names given back because their world no longer exists and their claim has expired. */
  namesReleased: Schema.Array(Schema.String),
  /** Image repositories removed because nothing accounts for them any more: the registry no longer lists them. */
  imagesRemoved: Schema.Array(Schema.String),
  /** Image repositories that should have gone and are still listed. */
  imagesLeft: Schema.Array(Schema.String),
});
export type SweepReport = typeof SweepReport.Type;

/** The sweep ran to the end, but at least one expired world is still there. The report says which. */
export class SweepIncomplete extends Schema.TaggedError<SweepIncomplete>()("SweepIncomplete", {
  report: SweepReport,
  message: Schema.String,
}) {}

const blank = { owner: null, expiresAt: null, status: null, detail: null, destroyMs: null };

/** Decides about one world and, when it has expired, destroys it. A destroy that fails does not stop the sweep. */
const sweepWorld =
  (now: DateTime.Utc, dryRun: boolean) => (recorded: { readonly stage: string; readonly output: unknown }) =>
    Effect.gen(function* () {
      const finding = yield* classify(now, recorded.output);
      const decision = decide(finding, dryRun);
      const known =
        finding.kind === "unreadable"
          ? { ...blank, detail: finding.detail }
          : finding.kind === "no-expiry"
            ? { ...blank, owner: finding.owner }
            : { ...blank, owner: finding.owner, expiresAt: finding.expiresAt, status: finding.status };
      if (decision !== "destroy") return { world: recorded.stage, ...known, verdict: decision } satisfies WorldReport;
      const watch = yield* makeStopwatch(yield* Timeouts);
      const gone = yield* Effect.exit(takeDown(recorded.stage, watch));
      const { destroy } = yield* watch.durations;
      return Exit.isSuccess(gone)
        ? ({ world: recorded.stage, ...known, verdict: "destroyed", destroyMs: destroy ?? null } satisfies WorldReport)
        : ({
            world: recorded.stage,
            ...known,
            verdict: "destroy failed",
            detail: describe(gone.cause),
          } satisfies WorldReport);
    });

/** Gives back the names whose world is gone and whose claim has expired. Skipped when the platform is gone too. */
const releaseStaleNames = (now: DateTime.Utc, stages: ReadonlyArray<string>, dryRun: boolean) =>
  Effect.gen(function* () {
    const names = yield* registry;
    const stale = (yield* claims(names)).filter(
      (held) => !stages.includes(held.name) && DateTime.isLessThanOrEqualTo(DateTime.makeUnsafe(held.expires_at), now),
    );
    if (!dryRun) yield* Effect.forEach(stale, (held) => release(names, held.name, held.holder));
    return stale.map((held) => held.name);
  }).pipe(Effect.catchTag("PlatformMissing", () => Effect.succeed<ReadonlyArray<string>>([])));

/** Removes the image repositories of this stack that no stage in the shared state accounts for. */
export const removeLeftoverImages = (stages: ReadonlyArray<string>, dryRun: boolean) =>
  Effect.gen(function* () {
    const { ofThisStack } = yield* imageRepositories;
    const leftovers = leftoverRepositories(ofThisStack, stages, {
      prefix: IMAGE_PREFIX,
      shared: [CHAIN_IMAGE, INDEX_IMAGE],
      platform: PLATFORM,
    });
    if (dryRun) return { removed: leftovers, left: [] as ReadonlyArray<string> };
    yield* removeImageRepositories(leftovers);
    // What is reported as removed is what the registry no longer lists, not what was asked for.
    const still = (yield* imageRepositories).ofThisStack;
    return {
      removed: leftovers.filter((name) => !still.includes(name)),
      left: leftovers.filter((name) => still.includes(name)),
    };
  });

/**
 * Sweeps once. Succeeds with the report when no expired world is left, and fails with `SweepIncomplete` when a
 * destroy failed, so a scheduled job can alert on it.
 */
export const sweep = Effect.fn("world.sweep")(function* (options: { readonly dryRun?: boolean } = {}) {
  const dryRun = options.dryRun === true;
  const now = yield* DateTime.now;
  const stages = yield* recordedStages;
  const worlds = yield* Effect.forEach(
    stages.filter(({ stage }) => isWorldStage(stage)),
    sweepWorld(now, dryRun),
  );
  const remaining = stages
    .map(({ stage }) => stage)
    .filter((stage) => !worlds.some((world) => world.world === stage && world.verdict === "destroyed"));
  const namesReleased = yield* releaseStaleNames(now, remaining, dryRun);
  const images = yield* removeLeftoverImages(remaining, dryRun);
  const report: SweepReport = {
    at: DateTime.formatIso(now),
    dryRun,
    worlds,
    namesReleased,
    imagesRemoved: images.removed,
    imagesLeft: images.left,
  };
  if (worlds.some((world) => world.verdict === "destroy failed") || images.left.length > 0) {
    return yield* new SweepIncomplete({
      report,
      message: "an expired world or a leftover image repository could not be removed",
    });
  }
  return report;
});
