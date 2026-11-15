// The concept "board": a company's Board, its Directors and how many of them must sign. A Director is a signer of the
// company Safe: their personal Safe wears the company's Director hat, and its Signer Gate makes every wearer an owner
// of the company Safe. The Board cannot change itself: the Gate refuses any transaction of the company Safe that calls
// the Safe, and the Director hat and the Gate's threshold are administered by the Shareholders' top hat, which the
// founder's personal Safe wears until shares are issued (packages/contracts, InstallerMoney). So a change to the Board
// is never a Board proposal: it is one UserOperation of the founder's own Safe, with one approval, the founder's, and
// `approval.sign` sends it. All three are served through a world's door. order.md says more.
//
// A Board's values, and what approvals of a change to it authorise.
import * as Schema from "effect/Schema";
import { Approval, BoardChangeId, PersonId } from "../../common/values.ts";

/** What an approval of a Board change authorises (`Subject`): a change to a company's Board, its Directors or its
 * threshold, by its change id (`org.director.add`, `org.threshold.set`). */
export const subjects = [Schema.Struct({ kind: Schema.Literal("board_change"), id: BoardChangeId })] as const;

/**
 * How many must sign: at least one.
 *
 * @internal Shared by the Board's and the Directors' verbs; not exported from the package.
 */
export const Threshold = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** A Board's size: how many Directors it has and how many of them must sign the company Safe's transactions. */
export const Seats = Schema.Struct({ directors: Schema.Int, threshold: Threshold });

/** What a change to the Board does: seat a Director, or set the threshold. */
export const BoardAction = Schema.Literals(["add", "threshold"]);

/** A change to a company's Board, proposed and waiting for its founder's signature. */
export const BoardChange = Schema.Struct({
  id: BoardChangeId,
  action: BoardAction,
  /** The person it seats; null for a threshold. */
  person: Schema.NullOr(PersonId),
  /** The Board now, as the company Safe and its Signer Gate hold it. */
  before: Seats,
  /** The Board once it lands. Seating a Director leaves the threshold as the Signer Gate computes it. */
  after: Seats,
  state: Schema.Literal("proposed"),
});

/**
 * What `org.director.add` and `org.threshold.set` answer: the change, and the one approval that lands it.
 *
 * @internal Shared by `director add` and `board set-threshold`; not exported from the package.
 */
export const Proposed = Schema.Struct({
  change: BoardChange,
  /**
   * The founder's, of one UserOperation of their own Safe (the wearer of the Shareholders' top hat), whose digest is
   * that operation's hash. Its signature alone sends it: `approval.sign` answers `Sent`, never `Collected`.
   */
  approval: Approval,
});
