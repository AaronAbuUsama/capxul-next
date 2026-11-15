// The ways the board's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../../generated/refusals.ts";
import { BoardChangeId, OrgId, PersonId } from "../../common/values.ts";

/**
 * The caller may not change the company's Board. Only the wearer of its Shareholders' top hat may, which is its
 * founder's personal Safe until shares are issued: neither its other Directors nor its members, nor the world's owner.
 */
export class CannotChangeBoard extends Schema.TaggedError<CannotChangeBoard, { readonly brand: unique symbol }>()(
  "CannotChangeBoard",
  {
    org: OrgId,
    person: PersonId,
  },
) {}

/**
 * The Board would need more signatures than it has Directors, so its Signer Gate would refuse every transaction of
 * the company Safe. `threshold` is what was asked, `directors` how many Directors there are.
 */
export class ThresholdTooHigh extends Schema.TaggedError<ThresholdTooHigh, { readonly brand: unique symbol }>()(
  "ThresholdTooHigh",
  {
    org: OrgId,
    threshold: Schema.Int,
    directors: Schema.Int,
  },
) {}

/** The Board already needs this many signatures: there is nothing to change. */
export class ThresholdUnchanged extends Schema.TaggedError<ThresholdUnchanged, { readonly brand: unique symbol }>()(
  "ThresholdUnchanged",
  {
    org: OrgId,
    threshold: Schema.Int,
  },
) {}

/**
 * Another change to the company's Board waits for its founder's signature, or is on its way to the chain. It is
 * signed and lands, or it expires, before another is proposed: each is built from the Board it finds.
 */
export class BoardChangeWaiting extends Schema.TaggedError<BoardChangeWaiting, { readonly brand: unique symbol }>()(
  "BoardChangeWaiting",
  {
    org: OrgId,
    change: BoardChangeId,
  },
) {}

export const refusals = { CannotChangeBoard, ThresholdTooHigh, ThresholdUnchanged, BoardChangeWaiting } as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = {
  CannotChangeBoard: 4,
  ThresholdTooHigh: 2,
  ThresholdUnchanged: 2,
  BoardChangeWaiting: 2,
};
