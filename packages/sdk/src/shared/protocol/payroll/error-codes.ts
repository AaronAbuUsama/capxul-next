// The error codes the payroll operations add to the platform's own: see
// `#errors/code-table`. An operation that adds a code adds it here.

import { conceptErrors } from "../errors/code-table.ts";

export const PAYROLL_ERRORS = conceptErrors({
  codes: [
    // A payment agreement would take its department over its yearly budget (F3).
    "PAYROLL_BUDGET_EXCEEDED",
    // The Organization Safe holds less than a collection pays (F3).
    "PAYER_BALANCE_TOO_LOW",
    // A token departments cannot budget or pay in on this chain (CAP-1012).
    "TOKEN_NOT_SUPPORTED",
    // An offer named no token and its department budgets in more than one (CAP-1012).
    "TOKEN_REQUIRED",
    // An offer named a token its department has no open budget in (CAP-1012).
    "TOKEN_NOT_BUDGETED",
    // A v4 budget set below what the budget already uses: this period's own
    // spend, its commitments and its teams' amounts (CAP-1156, `AmountBelowUse`).
    "AMOUNT_BELOW_USE",
  ],
  classes: {
    PAYROLL_BUDGET_EXCEEDED: "state",
    PAYER_BALANCE_TOO_LOW: "state",
    TOKEN_NOT_SUPPORTED: "input",
    TOKEN_REQUIRED: "input",
    TOKEN_NOT_BUDGETED: "state",
    AMOUNT_BELOW_USE: "state",
  },
  expected: [
    // An offer or a raise the department's budget has no room for; the payer
    // Safe short of what a collection pays (F3). Holders and Directors act.
    "PAYROLL_BUDGET_EXCEEDED",
    "PAYER_BALANCE_TOO_LOW",
    // A token the chain does not admit, an offer that must name its token, or
    // one in a token its department has no budget in (CAP-1012).
    "TOKEN_NOT_SUPPORTED",
    "TOKEN_REQUIRED",
    "TOKEN_NOT_BUDGETED",
    // A Director lowers a budget below what it uses; they wait or choose more (CAP-1156).
    "AMOUNT_BELOW_USE",
  ],
  reasons: [],
});
