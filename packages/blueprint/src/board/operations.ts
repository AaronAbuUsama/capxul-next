// The concept "board": a company's Board, its Directors and how many of them must sign. A Director is a signer of the
// company Safe: their personal Safe wears the company's Director hat, and its Signer Gate makes every wearer an owner
// of the company Safe. The Board cannot change itself: the Gate refuses any transaction of the company Safe that calls
// the Safe, and the Director hat and the Gate's threshold are administered by the Shareholders' top hat, which the
// founder's personal Safe wears until shares are issued (packages/contracts, InstallerMoney). So a change to the Board
// is never a Board proposal: it is one UserOperation of the founder's own Safe, with one approval, the founder's, and
// `approval.sign` sends it. All three are served through a world's door. order.md says more.
import * as Str from "effect/String";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import {
  AlreadyADirector,
  BoardChangeWaiting,
  CannotChangeBoard,
  MemberHasNoSafe,
  NotAMember,
  NotImplemented,
  OrgNotFound,
  ThresholdTooHigh,
  ThresholdUnchanged,
} from "../errors.ts";
import { declare } from "../operation.ts";
import { Address, Approval, BoardChangeId, HatId, OrgId, PersonId } from "../values.ts";
import { exampleAddress as address } from "../world/example.ts";

/** How many must sign: at least one. */
const Threshold = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

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

/** One Director of a company: the person and the personal Safe that signs the company Safe. */
export const Director = Schema.Struct({ person: PersonId, safe: Address });

/** A change to a company's Board was proposed to its founder. It carries neither the person nor the threshold. */
export class BoardChangeProposed extends Schema.TaggedClass<BoardChangeProposed, { readonly brand: unique symbol }>()(
  "board_change_proposed",
  {
    change: BoardChangeId,
    org: OrgId,
    action: BoardAction,
  },
) {}

/** What `org.director.add` and `org.threshold.set` answer: the change, and the one approval that lands it. */
const Proposed = Schema.Struct({
  change: BoardChange,
  /**
   * The founder's, of one UserOperation of their own Safe (the wearer of the Shareholders' top hat), whose digest is
   * that operation's hash. Its signature alone sends it: `approval.sign` answers `Sent`, never `Collected`.
   */
  approval: Approval,
});

const BOARD_BUDGET = {
  ms: 4_000,
  excludes: ["waking a parked world"],
  provisional: true,
  basis:
    "live reads of the company Safe, the Hats protocol and the Signer Gate on the world's chain, then preparing one UserOperation of the founder's Safe",
} as const;

const proposed = (event: { readonly payload: { readonly org: string }; readonly success: typeof Proposed.Type }) => ({
  change: event.success.change.id,
  org: event.payload.org,
  action: event.success.change.action,
});

const founderApproval = (id: string) => ({
  id,
  signer: "dana",
  signerAddress: address(1),
  digest: `0x${Str.repeat(32)("cd")}`,
  expiresAt: "2026-11-14T09:00:00Z",
});

export const directorAdd = declare({
  rpc: Rpc.make("org.director.add", {
    payload: { org: OrgId, person: PersonId },
    success: Proposed,
    error: Schema.Union([
      OrgNotFound,
      CannotChangeBoard,
      NotAMember,
      MemberHasNoSafe,
      AlreadyADirector,
      BoardChangeWaiting,
      NotImplemented,
    ]),
  }),
  emits: [{ event: BoardChangeProposed, carries: proposed }],
  budget: BOARD_BUDGET,
  examples: [
    {
      payload: { org: "org_northwind1", person: "sam" },
      success: {
        change: {
          id: "bch_seatsam1",
          action: "add",
          person: "sam",
          before: { directors: 2, threshold: 2 },
          after: { directors: 3, threshold: 2 },
          state: "proposed",
        },
        approval: founderApproval("apr_seatsam1"),
      },
    },
  ],
});

export const thresholdSet = declare({
  rpc: Rpc.make("org.threshold.set", {
    payload: {
      org: OrgId,
      /** How many Directors must sign every transaction of the company Safe, from 1 to the number of Directors. */
      threshold: Threshold,
    },
    success: Proposed,
    error: Schema.Union([
      OrgNotFound,
      CannotChangeBoard,
      ThresholdTooHigh,
      ThresholdUnchanged,
      BoardChangeWaiting,
      NotImplemented,
    ]),
  }),
  emits: [{ event: BoardChangeProposed, carries: proposed }],
  budget: BOARD_BUDGET,
  examples: [
    {
      payload: { org: "org_northwind1", threshold: 3 },
      success: {
        change: {
          id: "bch_three001",
          action: "threshold",
          person: null,
          before: { directors: 3, threshold: 2 },
          after: { directors: 3, threshold: 3 },
          state: "proposed",
        },
        approval: founderApproval("apr_three001"),
      },
    },
  ],
});

export const directorList = declare({
  rpc: Rpc.make("org.director.list", {
    payload: { org: OrgId },
    success: Schema.Struct({
      org: OrgId,
      /** The hat every Director's Safe wears, by its id on the world's Hats protocol. */
      directorHat: HatId,
      /** How many Directors must sign: the company Safe's threshold. */
      threshold: Threshold,
      /**
       * Its Directors, the founder first, then each in the order they were seated: the owners of the company Safe, read
       * from the chain. Its Directors and members see it, and so does the world's owner; anyone else is refused with
       * `NotAMember`.
       */
      directors: Schema.Array(Director),
    }),
    error: Schema.Union([OrgNotFound, NotAMember, NotImplemented]),
  }),
  emits: [],
  budget: {
    ms: 2_000,
    excludes: ["waking a parked world"],
    provisional: true,
    basis: "live reads of the company Safe's owners and threshold on the world's chain, and of the world's cast",
  },
  examples: [
    {
      payload: { org: "org_northwind1" },
      success: {
        org: "org_northwind1",
        directorHat: "26959946667150639794667015087019630673637144422540572481103610249216",
        threshold: 2,
        directors: [
          { person: "dana", safe: address(11) },
          { person: "eli", safe: address(12) },
        ],
      },
    },
  ],
});
