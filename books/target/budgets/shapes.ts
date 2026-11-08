// The input and output shapes of budgets' rpcs, flows and operations. Not records: the area files,
// flows.ts and operations.ts hold them as values. Field names are the camelCase the SDK and
// `--json` print; amounts are decimal strings in the token's units (`2000.00`), chain ids and hat
// ids strings, as the frozen and designed returns print them.

import { Schema } from "effect";
import { BudgetKind, Period, Signer } from "./data.ts";

const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const NullOr = Schema.NullOr;
const Arr = Schema.Array;

// ── inputs ──────────────────────────────────────────────────────────────────────────────────

/** A budget as a command names it: its key (`engineering`), its `dep_` or `allowance_` id, or its chain id. */
export const BudgetRef = S;

/** Every write takes a request key: the same key answers the same change. */
const Write = { orgId: S, requestKey: S, note: NullOr(S) };

export const CreateDepartmentInput = Schema.Struct({
  ...Write,
  name: S,
  /** A team inside this budget; it takes the parent's token and period. Null for a top budget. */
  parent: NullOr(BudgetRef),
  amount: S,
  period: Period,
  /** A top budget's token by symbol (USDC when none); refused with a parent. */
  token: NullOr(S),
  /** The holders of its office, by email: each is minted its new office hat. */
  holders: Arr(S),
});

export const CreateAllowanceInput = Schema.Struct({
  ...Write,
  policy: Schema.Struct({
    name: S,
    asset: S,
    amount: S,
    period: Period,
    /** The budget it sits in; null for the one open top budget in that asset with that period. */
    parent: NullOr(BudgetRef),
    /** Pre-v4 policy parts that have no v4 form: given at all, the policy is refused INVALID_INPUT. */
    limit: NullOr(S),
    recipients: NullOr(Arr(S)),
    allows: NullOr(Arr(S)),
  }),
  /** The member who wears its hat, by email. */
  assignTo: NullOr(S),
});

export const SetAmountInput = Schema.Struct({
  ...Write,
  budget: BudgetRef,
  amount: S,
  /** Refused unless they are the budget's own: a budget keeps its token and period. */
  token: NullOr(S),
  period: NullOr(Period),
});

export const BudgetWriteInput = Schema.Struct({ ...Write, budget: BudgetRef });

export const HolderInput = Schema.Struct({ ...Write, budget: BudgetRef, member: S });

export const CeilingSetInput = Schema.Struct({
  ...Write,
  token: S,
  /** Per the ceiling's period; null for the sum of the token's live top budgets. */
  amount: NullOr(S),
});

export const CeilingFreezeInput = Schema.Struct({ ...Write, token: S, leave: NullOr(S) });

export const CeilingUnfreezeInput = Schema.Struct({ ...Write, token: S });

export const OrgInput = Schema.Struct({ orgId: S });

export const ShowInput = Schema.Struct({
  orgId: S,
  /** This budget and everything under it; null for the whole tree. */
  budget: NullOr(BudgetRef),
  /** An ISO date: the period that holds it; null for the current period. */
  at: NullOr(S),
});

export const AllowanceListInput = Schema.Struct({ orgId: S, limit: NullOr(N), after: NullOr(S) });

export const AllowanceGetInput = Schema.Struct({ orgId: S, allowance: BudgetRef });

export const ChangeGetInput = Schema.Struct({ orgId: S, changeId: S });

// ── views ───────────────────────────────────────────────────────────────────────────────────

export const Token = Schema.Struct({ symbol: S, address: S, decimals: N });

/** A wearer of an office hat: a member by email; a Safe Capxul cannot name shows its address and no invented name. */
export const Holder = Schema.Struct({ email: NullOr(S), safe: S });

export const Office = Schema.Struct({ hat: S, holders: Arr(Holder) });

/** A token's payout ceiling: the most that can leave the company Safe through budgets in its period. */
export const Ceiling = Schema.Struct({
  token: S,
  amount: S,
  left: S,
  period: S,
  frozen: B,
  /** While frozen by Capxul: what the freeze left. */
  leave: NullOr(S),
});

/** One budget as every read shows it: Capxul's name for it and the chain's numbers now. */
export const BudgetLine = Schema.Struct({
  key: NullOr(S),
  id: NullOr(S),
  budgetId: NullOr(S),
  name: NullOr(S),
  kind: NullOr(BudgetKind),
  status: Schema.Literals(["proposed", "active"]),
  parent: NullOr(S),
  token: Token,
  period: Period,
  amount: S,
  childrenAmount: S,
  spent: S,
  committed: S,
  left: S,
  closed: B,
  refillsAt: NullOr(S),
  office: Office,
  offers: N,
  runningAgreements: N,
});

export const TreeNode = Schema.Struct({ ...BudgetLine.fields, children: Arr(S) });

export const Tree = Schema.Struct({
  token: Token,
  period: Period,
  payoutCeiling: NullOr(Ceiling),
  nodes: Arr(TreeNode),
});

export const DepartmentList = Schema.Struct({ items: Arr(BudgetLine) });

export const DepartmentTree = Schema.Struct({ trees: Arr(Tree) });

/** An allowance as `org allowance list` and `get` show it: its budget and its hat (designed returns). */
export const AllowanceLine = Schema.Struct({
  allowanceId: S,
  key: S,
  name: S,
  budgetId: NullOr(S),
  status: Schema.Literals(["proposed", "active"]),
  parent: NullOr(S),
  asset: Token,
  amount: S,
  period: Period,
  spent: S,
  committed: S,
  left: S,
  refillsAt: NullOr(S),
  closed: B,
  hat: S,
  wearers: Arr(S),
});

export const AllowancePage = Schema.Struct({ items: Arr(AllowanceLine), nextCursor: NullOr(S) });

// ── a prepared change ───────────────────────────────────────────────────────────────────────

/** What a change's carrier is doing: an office holder's approval, a Board proposal, or how it ended. */
export const ChangeStatus = Schema.Literals([
  "awaiting_approval",
  "awaiting_approvals",
  "executed",
  "rejected",
  "replaced",
  "failed",
  "declined",
  "expired",
]);

export const Proposal = Schema.Struct({
  proposalId: S,
  nonce: S,
  threshold: Schema.Struct({ needed: N, of: N }),
  approvals: Arr(S),
});

/** Every write answers these: the change, the caller's own approval, and the Board proposal when the Board signs. */
const Prepared = {
  status: ChangeStatus,
  changeId: S,
  requestKey: S,
  signer: Signer,
  approvalId: S,
  approvalUrl: S,
  proposal: NullOr(Proposal),
};

export const ChangeView = Schema.Struct({
  ...Prepared,
  kind: S,
  state: Schema.Literals(["proposed", "applied", "abandoned"]),
  budget: NullOr(S),
  budgetId: NullOr(S),
});

const PlannedBudget = Schema.Struct({
  key: S,
  id: S,
  name: S,
  parent: NullOr(S),
  token: S,
  period: Period,
  amount: S,
  office: Office,
});

const ParentRoom = NullOr(Schema.Struct({ key: NullOr(S), childrenAmount: S, left: S }));

export const DepartmentCreated = Schema.Struct({
  ...Prepared,
  department: PlannedBudget,
  parent: ParentRoom,
  office: Schema.Struct({ hat: S, period: Period }),
  /** How many of the proposal's calls do each part of the write. */
  groups: Schema.Struct({ office: N, holders: N, ceiling: N, budget: N }),
});

export const AllowanceCreated = Schema.Struct({
  ...Prepared,
  allowance: Schema.Struct({
    allowanceId: S,
    key: S,
    name: S,
    budgetId: NullOr(S),
    hat: S,
    amount: S,
    period: Period,
    parent: S,
    wearers: Arr(S),
  }),
});

export const AmountPrepared = Schema.Struct({
  ...Prepared,
  budget: Schema.Struct({ key: NullOr(S), kind: NullOr(BudgetKind), amount: S, previous: S, left: S }),
  parent: ParentRoom,
  payoutCeiling: NullOr(Ceiling),
});

export const OpenStatePrepared = Schema.Struct({
  ...Prepared,
  department: Schema.Struct({ key: NullOr(S), closed: B, runningAgreements: N }),
  office: Schema.Struct({ budgetId: S, period: Period }),
});

export const HolderPrepared = Schema.Struct({
  ...Prepared,
  budget: Schema.Struct({ key: NullOr(S), kind: NullOr(BudgetKind) }),
  office: Office,
  /** The hat's places before and after: an add takes one more place when every place is worn. */
  supply: Schema.Struct({ before: N, after: N }),
  wearers: Arr(S),
});

export const CeilingPrepared = Schema.Struct({ ...Prepared, payoutCeiling: Ceiling });

/** `org allowance replace` is refused on v4; it answers nothing. */
export const Nothing = Schema.Struct({});
