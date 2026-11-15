// The ways the budget's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../../generated/refusals.ts";
import { Amount, OrgId } from "../../common/values.ts";
import { BudgetId } from "./values.ts";

/** The company has no budget with this id on the chain: none was made, or it is another company's. */
export class BudgetNotFound extends Schema.TaggedError<BudgetNotFound, { readonly brand: unique symbol }>()(
  "BudgetNotFound",
  {
    org: OrgId,
    budget: BudgetId,
  },
) {}

/**
 * The amount asked is more than the parent budget has left in this period, as the chain says now: a budget fits
 * inside its parent (Budgets.sol, `ChildrenExceedParent`). Both amounts are in the parent's asset.
 */
export class ExceedsParent extends Schema.TaggedError<ExceedsParent, { readonly brand: unique symbol }>()(
  "ExceedsParent",
  {
    org: OrgId,
    parent: BudgetId,
    left: Amount,
    amount: Amount,
  },
) {}

export const refusals = { BudgetNotFound, ExceedsParent } as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = {
  BudgetNotFound: 2,
  ExceedsParent: 2,
};
