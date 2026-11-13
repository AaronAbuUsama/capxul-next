// The refusals of the contract about who is calling, and worlds and snapshots. Each is declared once, here; ../errors.ts gathers them all.
import * as Schema from "effect/Schema";
import { Grade, Instant, OperatorName, SnapshotName, WorldName } from "../values.ts";

// Who is calling.

/** No caller could be established: no credential, or one this world or the platform does not know. */
export class NotSignedIn extends Schema.TaggedError<NotSignedIn, { readonly brand: unique symbol }>()("NotSignedIn", {
  reason: Schema.Literals(["no_credential", "unknown_caller"]),
}) {}

/** Only the world's owner may do this; the caller is someone else (another operator, or a person of the world). */
export class NotWorldOwner extends Schema.TaggedError<NotWorldOwner, { readonly brand: unique symbol }>()(
  "NotWorldOwner",
  {
    world: WorldName,
    owner: OperatorName,
  },
) {}

// Worlds and snapshots.

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

/** A world made from a snapshot cannot outlive the world the snapshot belongs to. */
export class ExpiryBeyondSource extends Schema.TaggedError<ExpiryBeyondSource, { readonly brand: unique symbol }>()(
  "ExpiryBeyondSource",
  {
    source: WorldName,
    asked: Instant,
    latest: Instant,
  },
) {}

/** A real world's record is not exported until a rule for its owners' consent exists. */
export class ExportNotAllowed extends Schema.TaggedError<ExportNotAllowed, { readonly brand: unique symbol }>()(
  "ExportNotAllowed",
  {
    grade: Grade,
  },
) {}
