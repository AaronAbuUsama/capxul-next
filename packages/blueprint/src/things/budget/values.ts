// The concept "budgets": a company gives a holder an allowance to spend from its Safe, as a budget on the world's
// chain inside one of its budgets (Budgets.sol). Creating one is a Directors' proposal, like an officer change: it
// answers the approvals to sign, and `approval.sign` takes the signatures; the transaction the last one sends makes a
// hat for the budget, mints it to the holder's personal Safe and creates the budget under its parent, in one company
// Safe transaction. Reading budgets reads the chain, which is the only gate on spending: nothing here keeps a figure
// of its own. All three are served through a world's door, as the person the call names.
//
// The values of the domain "budgets": a company's money planned as a tree of budgets on the world's chain, in its
// Budgets contract, keyed by the company Safe (packages/contracts, src/money/Budgets.sol). A budget is an amount of
// one asset per calendar period, inside its parent's, and a hat: whoever wears it may spend from it, and from every
// budget below it. The chain owns every figure of a budget and is its only gate; Core keeps only its name. Declared
// here once; the domain's operations and refusals import them from here, and its door exports them.
//
// The chain as the only gate is Aaron's (14 November 2026): a budget's Cost Center on its company's site, with at
// most an ERPNext Budget set to Warn, comes in a later unit. A budget's holders are the people of the cast whose Safe
// wears its hat now, so the top budget, of the Books hat, has none in `founded`. Its creation is known by a `bcr_` id
// until it lands; which admin hat the new hat sits under, and how many may wear it, are the builder's within the
// contracts. Not declared, because nothing yet asks for them: closing, reopening and changing a budget, a budget's own
// refusals for a parent too deep or closed, and spending from it, which settles one sealed document (docs/roadmap.md).
import * as Schema from "effect/Schema";
import { Amount, Asset, BudgetCreationId, HatId, OrgId, PersonId } from "../../common/values.ts";

/** What an approval of a budget authorises (`Subject`): its creation by its id (`org.budget.create`). */
export const subjects = [Schema.Struct({ kind: Schema.Literal("budget_creation"), id: BudgetCreationId })] as const;

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
