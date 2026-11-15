// The refusals of the domain "board": who may change a company's Board, whom it may seat, and what threshold it may
// need. Each is declared once, here; ../errors.ts gathers them all.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../errors.ts";
import { BoardChangeId, OrgId, PersonId } from "../values.ts";

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

/** The person named is a Director of the company already: their Safe signs the company Safe. */
export class AlreadyADirector extends Schema.TaggedError<AlreadyADirector, { readonly brand: unique symbol }>()(
  "AlreadyADirector",
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

export const refusals = {
  CannotChangeBoard,
  AlreadyADirector,
  ThresholdTooHigh,
  ThresholdUnchanged,
  BoardChangeWaiting,
} as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = {
  CannotChangeBoard: 4,
  AlreadyADirector: 2,
  ThresholdTooHigh: 2,
  ThresholdUnchanged: 2,
  BoardChangeWaiting: 2,
};
