// The values of the domain "budgets": a company's money planned as a tree of budgets on the world's chain, in its
// Budgets contract, keyed by the company Safe (packages/contracts, src/money/Budgets.sol). A budget is an amount of
// one asset per calendar period, inside its parent's, and a hat: whoever wears it may spend from it, and from every
// budget below it. The chain owns every figure of a budget and is its only gate; Core keeps only its name. Declared
// here once; the domain's operations and refusals import them from here, and its door exports them.
import * as Schema from "effect/Schema";
import { Amount, Asset, HatId, OrgId, PersonId } from "../values.ts";

/** A budget, by its id in the world's Budgets contract: a whole number from 1, as a decimal string. */
export const BudgetId = Schema.String.check(Schema.isPattern(/^[1-9]\d*$/));

/**
 * The calendar period a budget's amount is for, in UTC: it refills when the period turns. The chain's `ICalendar`
 * codes are 0, 1 and 2. A budget has its parent's period and asset; a company's top budget is monthly.
 */
export const Period = Schema.Literals(["month", "quarter", "year"]);

/** What a company calls a budget. Kept by Core, never on the chain and never in an event. */
export const BudgetName = Schema.Trim.check(Schema.isBetweenLength(1, 140));

/** An amount a budget may be given: more than nothing. */
export const Allowance = Amount.check(Schema.makeFilter((amount) => /[1-9]/.test(amount) || "a budget's amount is 0"));

/**
 * One budget of a company, as the chain holds it now. Every figure is the chain's (`Budgets.budgetOf` and `leftOf`
 * at the latest block), in the asset's own decimals, for the period now running.
 */
export const Budget = Schema.Struct({
  id: BudgetId,
  org: OrgId,
  /** The company's own name for its top budget; for any other, the name it was proposed with. */
  name: BudgetName,
  /** The budget it is inside; null for the company's top budget, which founding made. */
  parent: Schema.NullOr(BudgetId),
  /** The hat whose wearers may spend from it. A top budget's is the Books hat. */
  hat: HatId,
  /** The people of the world's cast whose personal Safe wears its hat now, in the cast's order. */
  holders: Schema.Array(PersonId),
  asset: Asset,
  period: Period,
  /** What it may pay out in each period, its children's amounts included. */
  amount: Amount,
  /** Paid out in this period, from it and from the budgets below it. */
  spent: Amount,
  /** Reserved in it and below it, not yet paid. */
  committed: Amount,
  /**
   * What it may still pay out, or give a new budget below it, in this period: its amount less its children's amounts
   * and less what it paid and reserved itself.
   */
  left: Amount,
  closed: Schema.Boolean,
});
