// The acceptance claims of the budgets operations. Rendered into claims.md.
import { claim, type ClaimsOf } from "../claims/claim.ts";
import { BudgetNotFound, ExceedsParent, MemberHasNoSafe, NotADirector, NotAMember, OrgNotFound } from "../errors.ts";
import { startingWorlds as w } from "../starting-worlds.ts";
import * as Budgets from "./operations.ts";

export const create: ClaimsOf = {
  operation: Budgets.create,
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

export const show: ClaimsOf = {
  operation: Budgets.show,
  claims: [
    claim(
      "A budget reads as the chain holds it now, with the people who hold it.",
      w.founded,
      "Every org.budget.show answers what chain.budget of the world's Budgets gives for that id: the company Safe's budget, its parent (null for the top one), hat, asset, period, amount, spent, committed, left and whether it is closed. Its holders are the people of the cast whose Safe wears its hat (chain.wears), in the cast's order; the top budget is named as the company is. The record gains no entry.",
      { thinLine: true },
    ),
    claim(
      "Its company's Directors and members and the world's owner may read a budget; anyone else, and a budget the company does not have, are refused.",
      w.founded,
      "As dana, as sam and as the world's owner it answers the top budget; as olga it is refused with NotAMember naming Northwind and olga; a budget no budget of Northwind is, with BudgetNotFound naming it; a company nobody founded, with OrgNotFound. record.export shows no new entry.",
      { refusals: [NotAMember, BudgetNotFound, OrgNotFound] },
    ),
  ],
  dropped: [],
};

export const list: ClaimsOf = {
  operation: Budgets.list,
  claims: [
    claim(
      "A company's budgets are every budget the chain made for its Safe, its top budget first, each as org.budget.show reads it.",
      w.founded,
      "From founded it answers one budget: the top budget founding made, named Northwind Trading, 1,000,000 USDC a month with all of it left, whose hat is Books (chain.hat) and which nobody holds. Once sam's is made it answers the two, in the order of the BudgetCreated logs of the world's Budgets for the company Safe (chain.logs), each as org.budget.show answers it. A budget proposed and not yet signed is not among them. The record gains no entry.",
      { thinLine: true },
    ),
    claim(
      "Anyone who does not belong to the company, and a company nobody founded, are refused.",
      w.founded,
      "As olga it is refused with NotAMember naming Northwind and olga; for a company nobody founded, with OrgNotFound. record.export shows no new entry.",
      { refusals: [NotAMember, OrgNotFound] },
    ),
  ],
  dropped: [],
};
