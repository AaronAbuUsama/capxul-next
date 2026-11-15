// What the checks of org.director.add and org.threshold.set share (claims.md of board): a change to the Board is the
// founder's alone, with one approval, the caller's own, and changes nothing on the chain until it lands; the record
// gains one board_change_proposed carrying only change, org and action. A refused change leaves the record and the
// Board as they were.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { Success } from "../client.ts";
import { boardOf, type OnChain } from "../support/board.ts";
import { same, sameAddress } from "../support/expect.ts";
import { recordedOnly } from "../support/people.ts";
import { castMember } from "../support/world.ts";
import { callerOf, nothingRecorded, worldBefore, type Before } from "./common.ts";
import { check, type Asked, type Check } from "./format.ts";

type Changing = Asked<"org.director.add"> | Asked<"org.threshold.set">;
/** What both answer when they propose, one schema: the change, and the one approval that lands it. */
type Proposed = Success<"org.director.add">;

/** What a change to the Board reads before it is asked: the world, and the Board on the chain when it is known. */
export interface BoardBefore extends Before {
  readonly board: Option.Option<OnChain>;
}

export const boardBefore = (asked: Changing) =>
  Effect.gen(function* () {
    const before = yield* worldBefore(asked.options);
    return { ...before, board: yield* boardOf(asked.payload.org, before.where) } satisfies BoardBefore;
  });

/** The Board on the chain is as it was before the call. */
const boardUnchanged = (what: string, asked: Changing, before: BoardBefore): Check =>
  check(
    `${what} leaves the company Safe's owners and threshold as they were`,
    Effect.gen(function* () {
      if (Option.isNone(before.board)) return;
      const now = yield* boardOf(asked.payload.org, before.where);
      yield* same("the company Safe's owners and threshold", Option.getOrNull(now), before.board.value);
    }),
  );

/** The checks of every change to the Board that is proposed. */
export const proposedChecks = (asked: Changing, proposed: Proposed, before: BoardBefore): ReadonlyArray<Check> => [
  check(
    "it asks one approval, the caller's own, at their signer address",
    Effect.gen(function* () {
      yield* same("the approval's signer", proposed.approval.signer, callerOf(asked.options));
      const signer = yield* castMember(before.world, proposed.approval.signer);
      yield* sameAddress("the approval's address", proposed.approval.signerAddress, signer.signer);
    }),
  ),
  check(
    "it starts from the Board the chain holds: its owners and its threshold",
    Option.match(before.board, {
      onNone: () => Effect.void,
      onSome: (board) =>
        same(
          "the Board before the change",
          [proposed.change.before.directors, proposed.change.before.threshold, proposed.change.state],
          [board.owners.length, board.threshold, "proposed"],
        ),
    }),
  ),
  boardUnchanged("a change waiting for its signature", asked, before),
  check(
    "the record gains one board_change_proposed carrying only change, org and action",
    recordedOnly(
      "board_change_proposed",
      { change: proposed.change.id, org: asked.payload.org, action: proposed.change.action },
      before.head,
      before.where,
    ),
  ),
];

/** What every refusal of a change to the Board holds: nothing is recorded, nothing changes on the chain. */
export const refusedChecks = (
  asked: Changing,
  before: BoardBefore,
  also: ReadonlyArray<Check>,
): ReadonlyArray<Check> => [
  ...also,
  nothingRecorded("the refused change", before),
  boardUnchanged("the refused change", asked, before),
];

/** A refusal names the company asked and a person. */
export const namesOrgAnd = (
  what: string,
  named: { readonly org: string; readonly person: string },
  asked: Changing,
  person: string,
): Check =>
  check(`${what} names the company and ${person}`, same(what, [named.org, named.person], [asked.payload.org, person]));

/** The refusals both operations make, each with its checks. */
export const sharedRefusals = {
  CannotChangeBoard: (
    asked: Changing,
    refused: { readonly org: string; readonly person: string },
    before: BoardBefore,
  ) => refusedChecks(asked, before, [namesOrgAnd("CannotChangeBoard", refused, asked, callerOf(asked.options))]),
  BoardChangeWaiting: (asked: Changing, refused: { readonly org: string }, before: BoardBefore) =>
    refusedChecks(asked, before, [
      check("BoardChangeWaiting names the company asked", same("its org", refused.org, asked.payload.org)),
    ]),
  OrgNotFound: (asked: Changing, refused: { readonly org: string }, before: BoardBefore) =>
    refusedChecks(asked, before, [
      check("OrgNotFound names the company asked", same("its org", refused.org, asked.payload.org)),
    ]),
};
