// What a budget announces.
import { event } from "@capxul/blueprint-tools";
import { BudgetCreationId, OrgId, ProposalId } from "../../common/values.ts";
import { BudgetId } from "./values.ts";

/** A budget's creation was proposed to the Directors. It carries neither its holder, its name nor its amount. */
export class BudgetProposed extends event<BudgetProposed, { readonly brand: unique symbol }>()("budget_proposed", {
  creation: BudgetCreationId,
  org: OrgId,
  parent: BudgetId,
  proposal: ProposalId,
}) {}
