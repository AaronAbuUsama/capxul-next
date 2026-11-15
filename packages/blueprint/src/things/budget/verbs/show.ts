// `capxul budget show` (today `org.budget.show`): one budget as the chain holds it.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { declare, claim } from "@capxul/blueprint-tools";
import { NotImplemented, OrgNotFound } from "../../../common/refusals.ts";
import { OrgId } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { NotAMember } from "../../company/refusals.ts";
import { office } from "../examples.ts";
import { BudgetNotFound } from "../refusals.ts";
import { Budget, BudgetId } from "../values.ts";

export const show = declare({
  rpc: Rpc.make("org.budget.show", {
    payload: { org: OrgId, budget: BudgetId },
    /** The budget as the chain holds it now. Its Directors and members see it, and so does the world's owner. */
    success: Budget,
    error: Schema.Union([OrgNotFound, NotAMember, BudgetNotFound, NotImplemented]),
  }),
  emits: [],
  budget: {
    excludes: ["waking a parked world"],
    provisional: true,
    ms: 1_500,
    basis: "reads of the budget and of its hat's wearers on the world's chain, and of its name in the database",
  },
  examples: [{ payload: { org: "org_northwind1", budget: "8" }, success: office }],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** It moves no thing with a lifecycle (the machine format): why. */
export const stateless = "a read: shows one budget from the chain and changes nothing";

/** What `org.budget.show` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: show,
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
