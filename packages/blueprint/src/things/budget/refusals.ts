// The ways the budget's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import { refusal } from "@capxul/blueprint-tools";
import { Amount, OrgId } from "../../common/values.ts";
import { BudgetId } from "./values.ts";

/** The company has no budget with this id on the chain: none was made, or it is another company's. */
export class BudgetNotFound extends refusal<BudgetNotFound, { readonly brand: unique symbol }>()(
  "BudgetNotFound",
  {
    org: OrgId,
    budget: BudgetId,
  },
  2,
) {}

/**
 * The amount asked is more than the parent budget has left in this period, as the chain says now: a budget fits
 * inside its parent (Budgets.sol, `ChildrenExceedParent`). Both amounts are in the parent's asset.
 */
export class ExceedsParent extends refusal<ExceedsParent, { readonly brand: unique symbol }>()(
  "ExceedsParent",
  {
    org: OrgId,
    parent: BudgetId,
    left: Amount,
    amount: Amount,
  },
  2,
) {}

export const refusals = { BudgetNotFound, ExceedsParent } as const;
