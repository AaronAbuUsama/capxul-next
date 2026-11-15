// The refusals of the domain "world": worlds, snapshots and a world's clock. Each is declared once, here;
// ../errors.ts gathers them all.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../errors.ts";
import { Grade, Instant, OperatorName, SnapshotName, WorldName } from "../values.ts";

export class WorldNotFound extends Schema.TaggedError<WorldNotFound, { readonly brand: unique symbol }>()(
  "WorldNotFound",
  {
    world: WorldName,
  },
) {}

/** The name is taken by a live world. Nothing about that world changes. */
export class WorldExists extends Schema.TaggedError<WorldExists, { readonly brand: unique symbol }>()("WorldExists", {
  world: WorldName,
  owner: OperatorName,
  expiresAt: Instant,
}) {}

/** This operation does not make a world of this grade. A real world is made only by the platform's own deploy. */
export class GradeNotOffered extends Schema.TaggedError<GradeNotOffered, { readonly brand: unique symbol }>()(
  "GradeNotOffered",
  {
    grade: Grade,
  },
) {}

/** The owner already has as many live worlds as one owner may have. */
export class WorldQuotaReached extends Schema.TaggedError<WorldQuotaReached, { readonly brand: unique symbol }>()(
  "WorldQuotaReached",
  {
    owner: OperatorName,
    live: Schema.Int,
    limit: Schema.Int,
  },
) {}

/** A world's clock cannot start before its seeded chain's last block. */
export class ClockBeforeSeed extends Schema.TaggedError<ClockBeforeSeed, { readonly brand: unique symbol }>()(
  "ClockBeforeSeed",
  {
    asked: Instant,
    earliest: Instant,
  },
) {}

/** A world's clock only moves forward. */
export class ClockBackwards extends Schema.TaggedError<ClockBackwards, { readonly brand: unique symbol }>()(
  "ClockBackwards",
  {
    now: Instant,
    asked: Instant,
  },
) {}

export class SnapshotExists extends Schema.TaggedError<SnapshotExists, { readonly brand: unique symbol }>()(
  "SnapshotExists",
  {
    world: WorldName,
    snapshot: SnapshotName,
  },
) {}

export class SnapshotNotFound extends Schema.TaggedError<SnapshotNotFound, { readonly brand: unique symbol }>()(
  "SnapshotNotFound",
  {
    world: WorldName,
    snapshot: SnapshotName,
  },
) {}

/**
 * A live world hangs from the snapshot: a world restored from it, or the snapshot's own world once reset to it in
 * place. That world's database is a branch of the snapshot's, which cannot go while it does, so the snapshot stays
 * until those worlds are gone. Nothing changes.
 */
export class SnapshotInUse extends Schema.TaggedError<SnapshotInUse, { readonly brand: unique symbol }>()(
  "SnapshotInUse",
  {
    world: WorldName,
    snapshot: SnapshotName,
    /** The live worlds that hang from it. */
    worlds: Schema.Array(WorldName),
  },
) {}

/** A world made from a snapshot cannot outlive the world the snapshot belongs to. */
export class ExpiryBeyondSource extends Schema.TaggedError<ExpiryBeyondSource, { readonly brand: unique symbol }>()(
  "ExpiryBeyondSource",
  {
    source: WorldName,
    asked: Instant,
    latest: Instant,
  },
) {}

export const refusals = {
  WorldNotFound,
  WorldExists,
  GradeNotOffered,
  WorldQuotaReached,
  ClockBeforeSeed,
  ClockBackwards,
  SnapshotExists,
  SnapshotNotFound,
  SnapshotInUse,
  ExpiryBeyondSource,
} as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = {
  WorldNotFound: 2,
  WorldExists: 2,
  GradeNotOffered: 4,
  WorldQuotaReached: 6,
  ClockBeforeSeed: 2,
  ClockBackwards: 2,
  SnapshotExists: 2,
  SnapshotNotFound: 2,
  SnapshotInUse: 2,
  ExpiryBeyondSource: 2,
};
