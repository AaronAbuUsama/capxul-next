// The ways the world's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../../generated/refusals.ts";
import { Grade, Instant, OperatorName, WorldName } from "../../common/values.ts";

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

export const refusals = { WorldNotFound, WorldExists, GradeNotOffered, WorldQuotaReached, ClockBeforeSeed } as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = {
  WorldNotFound: 2,
  WorldExists: 2,
  GradeNotOffered: 4,
  WorldQuotaReached: 6,
  ClockBeforeSeed: 2,
};
