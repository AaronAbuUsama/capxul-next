// `capxul budget create` (today `org.budget.create`): proposing a budget to the Directors.
import * as Arr from "effect/Array";
import * as Str from "effect/String";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { verb, claim } from "@capxul/blueprint-tools";
import { NotImplemented, OrgNotFound } from "../../../common/refusals.ts";
import { Amount, Approval, Asset, BudgetCreationId, OrgId, PersonId, ProposalId } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { ProposalOpened } from "../../company/events.ts";
import { MemberHasNoSafe, NotADirector, NotAMember } from "../../company/refusals.ts";
import { exampleAddress as address } from "../../world/examples.ts";
import { BudgetProposed } from "../events.ts";
import { BudgetNotFound, ExceedsParent } from "../refusals.ts";
import { Allowance, BudgetId, BudgetName, Period } from "../values.ts";

const approval = (id: string, signer: string, n: number) => ({
  id,
  signer,
  signerAddress: address(n),
  digest: `0x${Str.repeat(32)("cd")}`,
  expiresAt: "2026-11-14T09:30:00Z",
});

export const create = verb({
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
    excludes: ["waking a parked world"],
    provisional: true,
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

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** What `org.budget.create` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: create,
  claims: [
    claim(
      "A Director proposes a budget for a holder inside a budget of the company: it waits for the Directors, and nothing is on the chain until they sign.",
      w.founded,
      "org.budget.create as dana of Office costs, 1,000 USDC for sam inside Northwind's top budget, answers its creation proposed as asked, monthly in USDC as its parent is (chain.budget), with a proposal and one approval per Director at their own signer address, dana's among them. The record gains budget_proposed carrying only creation, org, parent and proposal, then proposal_opened; the parent's left on the chain is what it was, and org.budget.list does not list it.",
      { thinLine: true },
    ),
    claim(
      "Once its Directors sign, one company Safe transaction makes the budget: a hat of its own on the holder's Safe, and the amount inside its parent.",
      w.founded,
      "approval.sign as dana is Collected and as eli is Sent, naming the subject budget_creation and the creation's id. Through the door's chain RPC, the logs of the transaction it sent (chain.transaction) hold one BudgetCreated of the world's Budgets (`contracts.budgets`) for the company Safe, inside the parent, whose hat a TransferSingle of the world's Hats in the same transaction minted to sam's Safe. chain.budget of it gives 1,000 USDC a month with nothing spent, and the parent has 1,000 less left. org.budget.show of it answers it, held by sam.",
    ),
    claim(
      "Only a Director may propose a budget; anyone else is refused, and nothing is proposed.",
      w.founded,
      "As sam, a member, it is refused with NotADirector naming Northwind and sam. record.export shows no new entry.",
      { refusals: [NotADirector] },
    ),
    claim(
      "A holder who does not belong to the company, and one with no personal Safe to wear its hat, are refused.",
      w.founded,
      "A budget for olga, who is of the world's cast but of no company, and for zed, who is nobody of the world, is refused with NotAMember naming Northwind and the holder; for pat, a member who has not claimed a Safe, with MemberHasNoSafe. record.export shows no new entry.",
      { refusals: [NotAMember, MemberHasNoSafe] },
    ),
    claim(
      "A parent the company does not have, an amount over what the parent has left, and a company nobody founded are refused.",
      w.founded,
      "A parent no budget of Northwind has is refused with BudgetNotFound naming it. 1,000,000.000001 inside the top budget of 1,000,000 is refused with ExceedsParent naming the parent, what it has left as chain.budget gives it, and the amount; once sam's 1,000 is made, 999,000.000001 is refused the same, with 999,000 left. A company nobody founded is refused with OrgNotFound; an amount of 0 and an empty name with PayloadRejected. record.export shows no new entry for any of them.",
      { refusals: [BudgetNotFound, ExceedsParent, OrgNotFound] },
    ),
    claim(
      "A budget may go inside any budget of the company, not only its top one.",
      w.founded,
      "Once sam's Office costs is made, org.budget.create as dana of Cleaners, 200 USDC for sam inside it, answers its creation proposed inside Office costs, monthly in USDC.",
    ),
  ],
  dropped: [],
};
