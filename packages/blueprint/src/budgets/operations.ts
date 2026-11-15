// The concept "budgets": a company gives a holder an allowance to spend from its Safe, as a budget on the world's
// chain inside one of its budgets (Budgets.sol). Creating one is a Directors' proposal, like an officer change: it
// answers the approvals to sign, and `approval.sign` takes the signatures; the transaction the last one sends makes a
// hat for the budget, mints it to the holder's personal Safe and creates the budget under its parent, in one company
// Safe transaction. Reading budgets reads the chain, which is the only gate on spending: nothing here keeps a figure
// of its own. All three are served through a world's door, as the person the call names.
import * as Arr from "effect/Array";
import * as Str from "effect/String";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import {
  BudgetNotFound,
  ExceedsParent,
  MemberHasNoSafe,
  NotADirector,
  NotAMember,
  NotImplemented,
  OrgNotFound,
} from "../errors.ts";
import { declare } from "../operation.ts";
import { ProposalOpened } from "../organizations/operations.ts";
import { Amount, Approval, Asset, BudgetCreationId, OrgId, PersonId, ProposalId } from "../values.ts";
import { exampleAddress as address } from "../world/example.ts";
import { Allowance, Budget, BudgetId, BudgetName, Period } from "./values.ts";

export { Allowance, Budget, BudgetId, BudgetName, Period } from "./values.ts";

/** A budget's creation was proposed to the Directors. It carries neither its holder, its name nor its amount. */
export class BudgetProposed extends Schema.TaggedClass<BudgetProposed, { readonly brand: unique symbol }>()(
  "budget_proposed",
  {
    creation: BudgetCreationId,
    org: OrgId,
    parent: BudgetId,
    proposal: ProposalId,
  },
) {}

const BUDGETS_BUDGET = {
  excludes: ["waking a parked world"],
  provisional: true,
} as const;

const approval = (id: string, signer: string, n: number) => ({
  id,
  signer,
  signerAddress: address(n),
  digest: `0x${Str.repeat(32)("cd")}`,
  expiresAt: "2026-11-14T09:30:00Z",
});

const TOP_HAT = "26960358049567071831564234593151059434471056821808218863738184065024";
const OFFICE_HAT = "26960358049567071831564234593151059434471056821808218863738184065025";

const top = {
  id: "7",
  org: "org_northwind1",
  name: "Northwind Trading",
  parent: null,
  hat: TOP_HAT,
  holders: [],
  asset: "USDC" as const,
  period: "month" as const,
  amount: "1000000",
  spent: "0",
  committed: "0",
  left: "999000",
  closed: false,
};

const office = {
  ...top,
  id: "8",
  name: "Office costs",
  parent: "7",
  hat: OFFICE_HAT,
  holders: ["sam"],
  amount: "1000",
  left: "1000",
};

export const create = declare({
  rpc: Rpc.make("org.budget.create", {
    payload: {
      org: OrgId,
      /** The budget it goes inside: the company's top budget, or any budget of the company below it. */
      parent: BudgetId,
      name: BudgetName,
      /** Who may spend from it: a Director or a member of the company, with a personal Safe to wear its hat. */
      holder: PersonId,
      /** Per period, in the parent's asset. Its period and asset are the parent's: the chain gives a child no other. */
      amount: Allowance,
    },
    success: Schema.Struct({
      creation: Schema.Struct({
        id: BudgetCreationId,
        org: OrgId,
        parent: BudgetId,
        name: BudgetName,
        holder: PersonId,
        asset: Asset,
        period: Period,
        amount: Amount,
        state: Schema.Literal("proposed"),
      }),
      proposal: Schema.Struct({ id: ProposalId, nonce: Schema.Int, threshold: Schema.Int }),
      /** One approval per Director. The budget is made once `threshold` of them are signed and it executes. */
      approvals: Schema.Array(Approval),
    }),
    error: Schema.Union([
      OrgNotFound,
      NotADirector,
      NotAMember,
      MemberHasNoSafe,
      BudgetNotFound,
      ExceedsParent,
      NotImplemented,
    ]),
  }),
  emits: [
    {
      event: BudgetProposed,
      carries: ({ payload, success }) => ({
        creation: success.creation.id,
        org: payload.org,
        parent: payload.parent,
        proposal: success.proposal.id,
      }),
    },
    {
      event: ProposalOpened,
      carries: ({ payload, success }) => ({
        proposal: success.proposal.id,
        org: payload.org,
        nonce: success.proposal.nonce,
        threshold: success.proposal.threshold,
        approvals: Arr.map(success.approvals, (each) => each.id),
      }),
    },
  ],
  budget: {
    ...BUDGETS_BUDGET,
    ms: 4_000,
    basis:
      "live reads of the Safe, the parent budget and the holder's Safe on the world's chain, then opening one approval per Director",
  },
  examples: [
    {
      payload: { org: "org_northwind1", parent: "7", name: "Office costs", holder: "sam", amount: "1000" },
      success: {
        creation: {
          id: "bcr_office1",
          org: "org_northwind1",
          parent: "7",
          name: "Office costs",
          holder: "sam",
          asset: "USDC",
          period: "month",
          amount: "1000",
          state: "proposed",
        },
        proposal: { id: "prp_office1", nonce: 1, threshold: 2 },
        approvals: [approval("apr_office1", "dana", 1), approval("apr_office2", "eli", 2)],
      },
    },
  ],
});

export const show = declare({
  rpc: Rpc.make("org.budget.show", {
    payload: { org: OrgId, budget: BudgetId },
    /** The budget as the chain holds it now. Its Directors and members see it, and so does the world's owner. */
    success: Budget,
    error: Schema.Union([OrgNotFound, NotAMember, BudgetNotFound, NotImplemented]),
  }),
  emits: [],
  budget: {
    ...BUDGETS_BUDGET,
    ms: 1_500,
    basis: "reads of the budget and of its hat's wearers on the world's chain, and of its name in the database",
  },
  examples: [{ payload: { org: "org_northwind1", budget: "8" }, success: office }],
});

export const list = declare({
  rpc: Rpc.make("org.budget.list", {
    payload: { org: OrgId },
    success: Schema.Struct({
      org: OrgId,
      /**
       * Every budget of the company on the chain, in the order the chain made them: its top budget first. A budget
       * proposed and not yet made is not among them. Its Directors and members see them, and so does the world's
       * owner; anyone else is refused with `NotAMember`.
       */
      budgets: Schema.Array(Budget),
    }),
    error: Schema.Union([OrgNotFound, NotAMember, NotImplemented]),
  }),
  emits: [],
  budget: {
    ...BUDGETS_BUDGET,
    ms: 2_000,
    basis: "the company's BudgetCreated logs, then each budget and its hat's wearers, read on the world's chain",
  },
  examples: [{ payload: { org: "org_northwind1" }, success: { org: "org_northwind1", budgets: [top, office] } }],
});
