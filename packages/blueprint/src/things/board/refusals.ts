// The ways the board's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import { refusal } from "@capxul/blueprint-tools";
import * as Schema from "effect/Schema";
import { BoardChangeId, OrgId, PersonId } from "../../common/values.ts";

/**
 * The caller may not change the company's Board. Only the wearer of its Shareholders' top hat may, which is its
 * founder's personal Safe until shares are issued: neither its other Directors nor its members, nor the world's owner.
 */
export class CannotChangeBoard extends refusal<CannotChangeBoard, { readonly brand: unique symbol }>()(
  "CannotChangeBoard",
  {
    org: OrgId,
    person: PersonId,
  },
  4,
) {}

/**
 * The Board would need more signatures than it has Directors, so its Signer Gate would refuse every transaction of
 * the company Safe. `threshold` is what was asked, `directors` how many Directors there are.
 */
export class ThresholdTooHigh extends refusal<ThresholdTooHigh, { readonly brand: unique symbol }>()(
  "ThresholdTooHigh",
  {
    org: OrgId,
    threshold: Schema.Int,
    directors: Schema.Int,
  },
  2,
) {}

/** The Board already needs this many signatures: there is nothing to change. */
export class ThresholdUnchanged extends refusal<ThresholdUnchanged, { readonly brand: unique symbol }>()(
  "ThresholdUnchanged",
  {
    org: OrgId,
    threshold: Schema.Int,
  },
  2,
) {}

/**
 * Another change to the company's Board waits for its founder's signature, or is on its way to the chain. It is
 * signed and lands, or it expires, before another is proposed: each is built from the Board it finds.
 */
export class BoardChangeWaiting extends refusal<BoardChangeWaiting, { readonly brand: unique symbol }>()(
  "BoardChangeWaiting",
  {
    org: OrgId,
    change: BoardChangeId,
  },
  2,
) {}

export const refusals = { CannotChangeBoard, ThresholdTooHigh, ThresholdUnchanged, BoardChangeWaiting } as const;
