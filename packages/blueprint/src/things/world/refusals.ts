// The ways the world's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import { refusal } from "@capxul/blueprint-tools";
import * as Schema from "effect/Schema";
import { Grade, Instant, OperatorName, WorldName } from "../../common/values.ts";

export class WorldNotFound extends refusal<WorldNotFound, { readonly brand: unique symbol }>()(
  "WorldNotFound",
  {
    world: WorldName,
  },
  2,
) {}

/** The name is taken by a live world. Nothing about that world changes. */
export class WorldExists extends refusal<WorldExists, { readonly brand: unique symbol }>()(
  "WorldExists",
  {
    world: WorldName,
    owner: OperatorName,
    expiresAt: Instant,
  },
  2,
) {}

/** This operation does not make a world of this grade. A real world is made only by the platform's own deploy. */
export class GradeNotOffered extends refusal<GradeNotOffered, { readonly brand: unique symbol }>()(
  "GradeNotOffered",
  {
    grade: Grade,
  },
  4,
) {}

/** The owner already has as many live worlds as one owner may have. */
export class WorldQuotaReached extends refusal<WorldQuotaReached, { readonly brand: unique symbol }>()(
  "WorldQuotaReached",
  {
    owner: OperatorName,
    live: Schema.Int,
    limit: Schema.Int,
  },
  6,
) {}

/** A world's clock cannot start before its seeded chain's last block. */
export class ClockBeforeSeed extends refusal<ClockBeforeSeed, { readonly brand: unique symbol }>()(
  "ClockBeforeSeed",
  {
    asked: Instant,
    earliest: Instant,
  },
  2,
) {}

export const refusals = { WorldNotFound, WorldExists, GradeNotOffered, WorldQuotaReached, ClockBeforeSeed } as const;
