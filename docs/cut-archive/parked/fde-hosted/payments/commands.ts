// Moved out of the built book by the cut, 10 November 2026, from books/target/payments/commands.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_payments } from "../shared/foundation.ts";
import {
  contract_budgets,
  contract_companies_house_claimer,
  contract_erc20,
  contract_escrow_factory,
  contract_payments,
  contract_roles,
  integration_chain_rpc,
} from "../shared/external.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_INVALID_RECIPIENT,
  error_NOT_AUTHENTICATED,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import * as approvals from "../approvals/procedures.ts";
import * as booksData from "../books/data.ts";
import * as budgetsData from "../budgets/data.ts";
import { table_chain_budgets, table_hat_wearers } from "../indexing/data.ts";
import * as orgsData from "../organizations/data.ts";
import * as parties from "../parties/procedures.ts";
import * as partiesData from "../parties/data.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { ReceiptContent, procedure_documents_store } from "../documents/procedures.ts";
import { Route, machine_payment, table_payment_commands, table_payments } from "./data.ts";

export const rpc_payments_commands_pay_fde_hosting = defineRpc({
  id: "payments.commands.pay-fde-hosting",
  title: "Prepare a hosting payment for the FDE: one budget payment to Capxul for n months",
  about:
    "Births the Organization's payment for `months` calendar months of its hosted FDE (aaron.fde-hosted) at the " +
    "deployment's FDE_HOSTING_PRICE (20 USDC a month, aaron.test-prices), from the `--from` budget to Capxul's receiving " +
    "Safe. Before its transaction it checks, in order: a session (else NOT_AUTHENTICATED); a current Seat in the " +
    "Organization held by a person, since no agent pays for hosting, the FDE least of all (else ROLE_PERMISSION_DENIED); " +
    "months a whole number from 1 to 12 (else INVALID_INPUT); the Organization's hosting row in `org-fdes`, not retired " +
    "(none or retired is WRONG_STATE); FDE_HOSTING_PRICE and CAPXUL_RECEIVING_SAFE set, the price in the budget's token " +
    "(else FEATURE_NOT_AVAILABLE); `--from` one of the Organization's budgets (else INVALID_INPUT), on chain (else " +
    "WRONG_STATE); then from the chain `Budgets.authorised(budget, caller's Safe)` now (else ROLE_PERMISSION_DENIED), " +
    "the budget and every budget above it open (else WRONG_STATE), its `leftOf` and the token's payout ceiling (Roles' " +
    "`allowances`) each covering the total (else PAYROLL_BUDGET_EXCEEDED), and the company Safe holding it (else " +
    "INSUFFICIENT_BALANCE). Nothing is written on a refusal. Then, in one transaction, as `payments.commands.buy-seats` " +
    "does: the request key's command (purpose `fde_hosting`, route `budget`, owner the Organization; K1); the payment's " +
    "Invoice from Capxul, one line 'Capxul FDE hosting', the months at the unit price (payments.fde-hosting-purchase); " +
    "one Payment born through `open`, kind one-off, to the receiving Safe as an outside payee, its source `fde-hosting` " +
    "with the command's id, the months and the payer's Party; and one approval from the caller's own Safe whose one " +
    "call is `Budgets.spend`. A paused FDE may be paid: settlement wakes it.",
  concept: concept_payments,
  kind: "action",
  who:
    "A signed-in person with a Seat in the Organization whom `Budgets.authorised` admits on the `--from` budget now: " +
    "a wearer of its hat or of a budget above it. Never an agent, so never the FDE itself.",
  input: PayFdeInput,
  output: FdeHostingHandover,
  errors: [
    error_NOT_AUTHENTICATED,
    error_ROLE_PERMISSION_DENIED,
    error_INVALID_INPUT,
    error_FEATURE_NOT_AVAILABLE,
    error_WRONG_STATE,
    error_PAYROLL_BUDGET_EXCEEDED,
    error_INSUFFICIENT_BALANCE,
    ...READ_FAILURES,
  ],
  reads: [
    table_payment_commands,
    table_payments,
    orgsData.table_organizations,
    orgsData.table_org_members,
    orgsData.table_org_deployments,
    orgsData.table_org_fdes,
    budgetsData.table_budgets,
    table_chain_budgets,
  ],
  writes: [table_payment_commands, table_payments],
  drives: [machine_payment.t.open],
  invokes: [procedure_documents_store, approvals.procedure_approvals_open],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [
    contract_budgets.f.budgetOf,
    contract_budgets.f.authorised,
    contract_budgets.f.leftOf,
    contract_roles.f.allowances,
    contract_erc20.f.balanceOf,
    contract_budgets.f.spend,
  ],
  spans: [],
  budget: budget("chain-read"),
  was: [
    "books/target/shared/rulings.ts (aaron.fde-hosted, aaron.test-prices, aaron.departments)",
    "docs/design/new-commands.md (section 5.5)",
    "books/target/organizations/decisions.ts (organizations.fde-hosting)",
  ],
});
