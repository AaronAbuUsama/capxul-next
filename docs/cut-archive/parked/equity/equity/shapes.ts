// Equity's wire shapes: the inputs and outputs of its rpcs and flows, and what each operation prints
// with `--json` (its frozen `returns` fields, by name). Schemas only: this module holds no records and
// is not in ./index.ts's `modules`.

import { Schema } from "effect";
import { TRANSFER_RULES, VOTE_MATTERS, WRITE_CHANGES, WRITE_FAILURES, WRITE_STATUSES } from "./data.ts";

const S = Schema.String;
const N = Schema.Number;
const Int = Schema.Int;
const B = Schema.Boolean;
const Null = Schema.NullOr;
const opt = Schema.optionalKey;
const A = Schema.Array;

/** Whom a command names: an email, an `@handle` or a 0x address, resolved to a Party and its Safe. */
const Who = S;

// ── common ──────────────────────────────────────────────────────────────────────────────────

export const OrgInput = Schema.Struct({ orgId: S });

/** The Board's proposal of a matter, as board holds it: its approvals so far of the threshold. */
export const Proposal = Schema.Struct({
  proposalId: S,
  nonce: N,
  approvals: Int,
  threshold: Int,
  status: S,
  /** The command another Director runs while it waits. */
  next: Null(S),
});

/** One write as it stands. */
export const Write = Schema.Struct({
  writeId: S,
  change: Schema.Literals(WRITE_CHANGES),
  status: Schema.Literals(WRITE_STATUSES),
  failure: Null(Schema.Literals(WRITE_FAILURES)),
  approvalId: Null(S),
  proposalId: Null(S),
  txHash: Null(S),
  landedAt: Null(N),
  paymentId: Null(S),
});

export const WriteRef = Schema.Struct({ orgId: S, writeId: S });

/** What every prepare rpc answers: the write, the approval to sign, and the Board proposal when there is one. */
export const Prepared = Schema.Struct({
  write: Write,
  approvalId: S,
  approvalUrl: S,
  proposal: Null(Proposal),
  /** False when the same request answered a write that already waits. */
  opened: B,
});

export const Status = S;

// ── setup and issue ─────────────────────────────────────────────────────────────────────────

export const SetupInput = Schema.Struct({
  orgId: S,
  template: S,
  authorised: S,
  founders: A(Schema.Struct({ who: Who, shares: S })),
  pool: opt(S),
  vest: opt(S),
  cliff: opt(S),
});

const PlanClass = Schema.Struct({ name: S, weight: Int, transferRule: Schema.Literals(TRANSFER_RULES), authorised: S });
const PlanFounder = Schema.Struct({ email: S, safe: S, shares: S, vestingMonths: Int, cliffMonths: Int, start: S, end: S });

export const SetupReturns = Schema.Struct({
  status: Schema.Literals(["deploying", "awaiting_approvals", "installed"]),
  template: S,
  summary: S,
  capTable: Schema.Struct({ fullyDiluted: S, authorised: Schema.Record(S, S), pool: S, classes: A(PlanClass), founders: A(PlanFounder) }),
  governor: Schema.Struct({ address: Null(S), votingDelay: Int, votingPeriod: Int, quorumPercent: N, proposalThreshold: S }),
  contracts: Schema.Record(S, S),
  proposal: Null(Proposal),
});

/** The install as its setup flow follows it: its batch's write and proposal once it is proposed. */
export const InstallView = Schema.Struct({ installId: S, returns: SetupReturns, write: Null(Write), approvalId: Null(S), approvalUrl: Null(S) });

export const IssueInput = Schema.Struct({ orgId: S, className: S, to: Who, shares: S, reason: S });

export const IssueReturns = Schema.Struct({
  status: Schema.Literals(["awaiting_approvals", "issued"]),
  issue: Schema.Struct({
    captable: S,
    classId: Int,
    className: S,
    to: S,
    email: Null(S),
    shares: S,
    reasonHash: S,
    authorised: S,
    leftToIssue: S,
  }),
  proposal: Proposal,
});

// ── grants ──────────────────────────────────────────────────────────────────────────────────

export const GrantInput = Schema.Struct({
  orgId: S,
  grants: A(
    Schema.Struct({ to: Who, shares: S, strike: S, strikeToken: opt(S), vest: opt(S), cliff: opt(S), window: opt(S), agreement: opt(S) }),
  ),
});

const GrantTerms = Schema.Struct({
  grantId: S,
  grantee: S,
  email: Null(S),
  className: S,
  shares: S,
  strike: S,
  strikeToken: S,
  vesting: Schema.Struct({ months: Int, cliffMonths: Int, start: S, cliff: S, end: S }),
  offerExpiresAt: S,
  expiresAt: S,
  exerciseWindowDays: Int,
  agreementHash: S,
});

export const GrantReturns = Schema.Struct({
  status: Schema.Literals(["awaiting_approvals", "granted"]),
  grant: Schema.Union([GrantTerms, A(GrantTerms)]),
  pool: Schema.Struct({ size: S, left: S }),
  proposal: Proposal,
});

export const EndGrantInput = Schema.Struct({ orgId: S, grantId: S, lastDay: S });
export const EndGrantReturns = Schema.Struct({
  grantId: S,
  vested: S,
  returnedToPool: S,
  exerciseBy: Null(S),
  status: Schema.Literals(["awaiting_approvals", "ended"]),
  proposal: Proposal,
});

export const GrantShowInput = Schema.Struct({ orgId: S, grantId: opt(S) });
const GrantRow = Schema.Struct({
  grantId: S,
  grantee: Schema.Struct({ name: Null(S), email: Null(S), safe: S }),
  shares: Schema.Struct({ granted: S, className: S, strike: Null(S), strikeToken: Null(S), expiresAt: Null(S) }),
  vested: S,
  status: Schema.Literals(["proposed", "offered", "active", "ended", "lapsed", "abandoned"]),
});
export const GrantShowReturns = Schema.Union([GrantRow, Schema.Struct({ grants: A(GrantRow) })]);

export const GrantRef = Schema.Struct({ grantId: S });
export const ExerciseInput = Schema.Struct({ grantId: S, shares: S });
export const AcceptReturns = Schema.Struct({
  grantId: S,
  status: Schema.Literals(["awaiting_approval", "active"]),
  vested: S,
  nextVest: Null(Schema.Struct({ on: S, shares: S })),
});
export const ExerciseReturns = Schema.Struct({
  grantId: S,
  paid: S,
  received: Schema.Struct({ class: S, shares: S }),
});

// ── rounds and SAFEs ────────────────────────────────────────────────────────────────────────

export const RoundTermsInput = Schema.Struct({
  orgId: S,
  className: S,
  preMoney: S,
  raise: S,
  poolTarget: opt(S),
  convertSafes: opt(B),
  closes: opt(S),
  token: opt(S),
});

export const RoundPreviewReturns = Schema.Struct({
  price: S,
  postMoney: S,
  poolTopUp: S,
  conversions: A(Schema.Struct({ safeId: S, investor: S, amount: S, shares: S, at: S })),
  downRound: Schema.Struct({ down: B, classes: A(S) }),
});

export const RoundCreateInput = Schema.Struct({
  ...RoundTermsInput.fields,
  terms: S,
  approvedBy: opt(S),
});

export const RoundCreateReturns = Schema.Struct({
  status: Schema.Literals(["awaiting_approvals", "opened"]),
  round: Schema.Struct({
    roundId: S,
    className: S,
    token: S,
    preMoney: S,
    raise: S,
    fullyDiluted: S,
    price: S,
    maxShares: S,
    poolTopUp: S,
    payBy: S,
    termsHash: S,
  }),
  proposal: Proposal,
});

export const InviteInput = Schema.Struct({ orgId: S, roundId: S, investors: A(Schema.Struct({ investor: Who, amount: S })) });
export const InviteReturns = Schema.Struct({
  status: Status,
  invited: A(Schema.Struct({ investor: S, email: Null(S), safe: S, amount: S })),
  proposal: Proposal,
});

export const AllocateInput = Schema.Struct({ orgId: S, roundId: S, overrides: A(Schema.Struct({ investor: Who, shares: S })) });
export const AllocateReturns = Schema.Struct({
  status: Status,
  allocations: A(Schema.Struct({ investor: S, shares: S, amount: S, payBy: S })),
  proposal: Proposal,
});

export const RoundRef = Schema.Struct({ orgId: S, roundId: S });
export const CloseReturns = Schema.Struct({
  roundId: S,
  adjusted: A(Schema.Struct({ class: S, before: S, after: S })),
  status: Status,
  proposal: Proposal,
});
export const CancelReturns = Schema.Struct({ roundId: S, status: Status, proposal: Proposal });

export const RoundShowReturns = Schema.Struct({
  roundId: S,
  status: Schema.Literals(["proposed", "open", "allocated", "closed", "cancelled", "abandoned"]),
  raised: Schema.Struct({ committed: S, paid: S, of: S }),
  investors: A(Schema.Struct({ investor: S, email: Null(S), committed: Null(S), allocated: Null(S), paid: B, status: S })),
});

export const SafeCreateInput = Schema.Struct({
  orgId: S,
  kind: Schema.Literal("post-money"),
  cap: S,
  discount: opt(S),
  raise: S,
  minTicket: opt(S),
  closes: S,
  terms: S,
  token: opt(S),
});

export const SafeCreateReturns = Schema.Struct({
  status: Schema.Literals(["awaiting_approvals", "opened"]),
  safeRound: Schema.Struct({
    safeRoundId: S,
    kind: Schema.Literal("post-money"),
    token: S,
    cap: S,
    discountPercent: N,
    raise: S,
    minTicket: Null(S),
    closes: S,
    termsHash: S,
  }),
  proposal: Proposal,
});

export const SafeCloseReturns = Schema.Struct({
  roundId: S,
  status: Schema.Literals(["closed", "awaiting_approval", "awaiting_approvals"]),
  raised: S,
  proposal: Null(Proposal),
});

export const SafeShowReturns = Schema.Struct({
  roundId: S,
  terms: Schema.Struct({ kind: S, cap: S, discountPercent: N, raise: S, minTicket: Null(S), closes: S }),
  signed: A(Schema.Struct({ safeId: S, investor: S, email: Null(S), amount: S })),
  status: Schema.Literals(["proposed", "open", "closed", "abandoned"]),
});

// ── investors ───────────────────────────────────────────────────────────────────────────────

export const InvestOffer = Schema.Struct({
  roundId: S,
  kind: Schema.Literals(["priced", "safe"]),
  company: S,
  price: Null(S),
  cap: Null(S),
  invitedFor: S,
  status: S,
  documentsMatch: B,
});

export const InvestShowInput = Schema.Struct({ roundId: S });
export const InvestShowReturns = Schema.Struct({
  roundId: S,
  terms: Schema.Struct({
    company: S,
    className: Null(S),
    price: Null(S),
    preMoney: Null(S),
    cap: Null(S),
    discountPercent: Null(N),
    raise: S,
    classTerms: Null(S),
    documents: A(Schema.Struct({ documentId: S, hash: S, onChain: Null(S) })),
  }),
  documentsMatch: B,
});

export const CommitInput = Schema.Struct({ roundId: S, amount: S });
export const CommitReturns = Schema.Struct({
  commitmentId: S,
  amount: S,
  shares: S,
  status: Schema.Literals(["awaiting_approval", "committed"]),
});

/** `invest pay <rd_…>` pays an allocation; `invest pay <tr_…>` buys an approved secondary sale. */
export const PayInput = Schema.Struct({ id: S });
export const PayReturns = Schema.Struct({ paid: S, received: Schema.Struct({ class: S, shares: S }) });

export const SignInput = Schema.Struct({ roundId: S, amount: S });
export const SignReturns = Schema.Struct({
  safe: Schema.Struct({ safeId: S, amount: S, cap: S, ownershipAtCap: N, status: Schema.Literals(["awaiting_approval", "outstanding"]) }),
});

// ── holdings ────────────────────────────────────────────────────────────────────────────────

export const CapTableInput = Schema.Struct({ orgId: S, fullyDiluted: opt(B), at: opt(S) });
export const CapTableReturns = Schema.Struct({
  at: S,
  total: S,
  options: S,
  pool: S,
  fullyDiluted: S,
  rows: A(
    Schema.Struct({
      holder: S,
      member: Null(S),
      byClass: Schema.Record(S, S),
      asConverted: S,
      fullyDilutedFraction: N,
    }),
  ),
});

export const SharesInput = Schema.Struct({ org: opt(S) });
export const SharesReturns = Schema.Struct({
  companies: A(
    Schema.Struct({
      org: S,
      shares: A(Schema.Struct({ class: S, shares: S, locked: S })),
      waiting: A(Schema.Struct({ grantId: S, shares: S, agreementHash: S, status: S })),
      options: A(Schema.Struct({ grantId: S, shares: S, vested: S, exercised: S, status: S })),
      safes: A(Schema.Struct({ safeId: S, amount: S, cap: S, status: S })),
    }),
  ),
});

export const ConvertInput = Schema.Struct({ org: S, className: S, shares: S });
export const ConvertReturns = Schema.Struct({
  burned: Schema.Struct({ class: S, shares: S }),
  minted: Schema.Struct({ class: S, shares: Null(S) }),
});

export const DelegateInput = Schema.Struct({ org: S, className: S, to: Who });
export const DelegateReturns = Schema.Struct({ class: S, delegate: S });

// ── sales and exits ─────────────────────────────────────────────────────────────────────────

export const SellInput = Schema.Struct({ org: S, to: Who, shares: S, price: S, className: opt(S), agreement: opt(S), noWait: opt(B) });
export const SaleParty = Schema.Struct({ email: Null(S), safe: S });
export const SellReturns = Schema.Struct({
  status: Schema.Literals(["awaiting_approval", "offered"]),
  transferId: S,
  offerId: Null(S),
  shares: Schema.Struct({ count: S, className: S, price: S, total: S }),
  buyer: SaleParty,
  seller: SaleParty,
});

export const SaleRef = Schema.Struct({ orgId: S, transferId: S });
export const TransferApproveReturns = Schema.Struct({
  status: Schema.Literals(["awaiting_approvals", "approved"]),
  transfer: Schema.Struct({ transferId: S, seller: SaleParty, buyer: SaleParty, shares: S, price: S, total: S }),
  proposal: Proposal,
});

export const ExitPreviewInput = Schema.Struct({ orgId: S, proceeds: S });
export const ExitPreviewReturns = Schema.Struct({
  proceeds: S,
  perCommon: S,
  byClass: A(Schema.Struct({ class: S, converts: B, paid: S })),
  holders: A(Schema.Struct({ holder: S, receives: S })),
  check: S,
});

export const ExitPayInput = Schema.Struct({ orgId: S, voteId: S });
export const ExitPayReturns = Schema.Struct({ status: Status, paid: Int, total: S, cancelled: B, proposal: Proposal });

// ── votes ───────────────────────────────────────────────────────────────────────────────────

export const Tally = Schema.Struct({ for: S, against: S, abstain: S });

export const Vote = Schema.Struct({
  voteId: S,
  matter: Schema.Literals(VOTE_MATTERS),
  title: S,
  status: S,
  opensAt: Null(S),
  closesAt: Null(S),
  snapshotVotes: Null(S),
  quorum: Null(S),
  tally: Null(Tally),
  quorumReached: Null(B),
});

export const VoteCreateInput = Schema.Struct({
  orgId: S,
  matter: Schema.Literals(VOTE_MATTERS),
  params: Schema.Record(S, S),
  terms: opt(S),
});
export const VoteRef = Schema.Struct({ orgId: S, voteId: S });
export const VoteWaitInput = Schema.Struct({ orgId: S, voteId: S, until: opt(Schema.Literals(["closed", "executed"])) });
export const VoteReturns = Schema.Struct({ vote: Vote });
export const VotesReturns = Schema.Struct({ votes: A(Vote) });

export const ExecuteReturns = Schema.Struct({
  executionId: S,
  voteId: S,
  tally: Tally,
  status: Schema.Literals(["awaiting_approval", "sent", "executed"]),
  executedAt: Null(S),
});

export const CastInput = Schema.Struct({ voteId: S, support: Schema.Literals(["for", "against", "abstain"]), reason: opt(S) });
export const CastReturns = Schema.Struct({
  voteId: S,
  ballotId: S,
  support: Schema.Literals(["for", "against", "abstain"]),
  weight: S,
  status: Schema.Literals(["awaiting_approval", "sent", "cast"]),
});

export const MyVote = Schema.Struct({
  voteId: S,
  org: S,
  matter: Schema.Literals(VOTE_MATTERS),
  status: Schema.Literals(["pending", "active"]),
  opensAt: Null(S),
  closesAt: Null(S),
  votes: S,
  voted: B,
});
export const MyVotesReturns = Schema.Struct({ votes: A(MyVote) });
