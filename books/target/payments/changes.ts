// Area changes: the rpcs that change a Payment's plan after its birth. Each is a signal of the Payment's
// durable process (./processes.ts): it records what now carries the change (a new approval, a void, a
// Budgets cancel, an escrow refund, a Board proposal) and the process waits on that instead. None of them
// moves a Payment to `cancelled` or `scheduled` itself: only the chain's answer does, so a held payment
// stays held when its cancel is never signed (`payment cancel` #3).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_payments } from "../shared/foundation.ts";
import {
  contract_budgets,
  contract_erc20,
  contract_escrow,
  contract_payments,
  integration_chain_rpc,
} from "../shared/external.ts";
import {
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import * as approvals from "../approvals/procedures.ts";
import * as approvalsData from "../approvals/data.ts";
import * as budgetsData from "../budgets/data.ts";
import * as orgsData from "../organizations/data.ts";
import { Handover } from "./commands.ts";
import { procedure_board_propose } from "../board/procedures.ts";
import { machine_payment, table_payment_commands, table_payments } from "./data.ts";

const OLD = "packages/backend/src/payments";
const S = Schema.String;
const Null = Schema.NullOr;

/** A change names one Payment, and the Organization it is in when it is one's. */
export const ChangeInput = Schema.Struct({ payment_id: S, org: Null(S), as_directors: Schema.Boolean });

const READ_FAILURES = [error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID] as const;
const AUTHORITY_READS = [table_payments, table_payment_commands, orgsData.table_org_members, budgetsData.table_budgets];

export const rpc_payments_changes_retry = defineRpc({
  id: "payments.changes.retry",
  title: "Send a lapsed payment's exact terms again",
  about:
    "Retries one Payment that needs it (its approval expired, was displaced or reverted, or its dated window closed): the " +
    "same recipient, amount, asset, kind, document and job nonce, so the same v4 payment id, which the chain consumes " +
    "once: a retry can never pay twice. It refuses a Payment that does not need a retry, an incoming Payment as an " +
    "Organization's retry source, and a caller who no longer holds the authority the first send needed. Before its " +
    "transaction it reads the funding again (the Safe's balance, or the budget's `leftOf` and `authorised`) and that the " +
    "id is not consumed (`Payments.paid`). In one transaction it opens the carrier the first send had (an approval from " +
    "the caller's own Safe, or a Board proposal at the Safe's next nonce for a Board payment) and moves the Payment " +
    "`needs_retry` → `prepared` (`retry`), which resumes its process on the new carrier.",
  concept: concept_payments,
  kind: "action",
  who:
    "The payer: the person who made the payment; for a budget payment the wearer of the budget's hat or one above it; for " +
    "a Board payment a Director. With `--org`, in that Organization.",
  input: ChangeInput,
  output: Handover,
  errors: [
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_WRONG_STATE,
    error_ROLE_PERMISSION_DENIED,
    error_INSUFFICIENT_BALANCE,
    error_PAYROLL_BUDGET_EXCEEDED,
    ...READ_FAILURES,
  ],
  reads: [...AUTHORITY_READS, approvalsData.table_approvals],
  writes: [table_payments],
  drives: [machine_payment.t.retry],
  invokes: [approvals.procedure_approvals_open, procedure_board_propose],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_erc20.f.balanceOf, contract_budgets.f.leftOf, contract_budgets.f.authorised, contract_payments.f.paid],
  spans: [],
  budget: budget("chain-read"),
  was: [`${OLD}/lifecycles/operations/prepare-scoped.ts`, `${OLD}/lifecycles/reads/previews.ts:37`, "apps/docs/factory/operations/payment.retry.yaml"],
});

export const rpc_payments_changes_cancel = defineRpc({
  id: "payments.changes.cancel",
  title: "Prepare the cancel of a waiting payment",
  about:
    "Prepares what takes back a Payment that is still waiting, by its route: a personal dated payment is voided by an " +
    "operation that replaces its held one on the same nonce (`approvals.open` with `replaces`), so at most one of the two " +
    "can land and the void uses up the whole held operation (K14); a budget's dated payment is `Budgets.cancel` from the " +
    "caller's own Safe, which frees its reservation; a Board's dated payment (`--as-directors`) is one Board proposal of " +
    "`Budgets.cancel` per item; a claim escrow is `Escrow.refund()` from its owner, the payer's Safe or, for a company " +
    "escrow, a Board proposal. A Payment that is no longer held (settled, collected, already cancelled) refuses before " +
    "anything is built, after a chain read of `Budgets.scheduledOf` or the escrow's `state` where it has one. It records " +
    "the carrier on the Payment and changes no status: the process cancels it when the chain says the void, the cancel " +
    "or the refund landed.",
  concept: concept_payments,
  kind: "action",
  who:
    "The payer of a waiting payment. For a budget's dated payment, the wearer of the budget's hat or one above it. For a " +
    "dated payment the Board scheduled or an escrow the company Safe owns, a Director (`--as-directors`).",
  input: ChangeInput,
  output: Handover,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED, ...READ_FAILURES],
  reads: [...AUTHORITY_READS, approvalsData.table_approvals],
  writes: [table_payments],
  drives: [],
  invokes: [approvals.procedure_approvals_open, procedure_board_propose],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [
    contract_budgets.f.scheduledOf,
    contract_budgets.f.authorised,
    contract_escrow.f.state,
    contract_budgets.f.cancel,
    contract_escrow.f.refund,
  ],
  spans: [],
  budget: budget("chain-read"),
  was: [
    `${OLD}/lifecycles/operations/prepare-scoped.ts`,
    `${OLD}/verifications/writes/voids.ts:108`,
    `${OLD}/schedules/writes/board-cancels.ts:27`,
    "packages/backend/src/organizations/proposals/operations/cancel-scheduled.ts:13",
  ],
});

export const rpc_payments_changes_reschedule = defineRpc({
  id: "payments.changes.reschedule",
  title: "Move a dated payment to a new day",
  about:
    "Moves a dated Payment to a new day, checking the day first (in the future, 00:00 UTC for a bare day) so a bad day " +
    "changes nothing. A budget's dated payment moves in one approval from the caller's own Safe: `Budgets.cancel` of its " +
    "scheduled id, then `Budgets.schedule` of the same recipient, amount, kind and document on the new day, so the budget " +
    "keeps holding it; the new Payment is born now (`open`, pointing back at the old one) and the old one is cancelled " +
    "when the chain says so. A personal dated payment takes two approvals: the void of the held operation first, as " +
    "`payment cancel` prepares it; once the old Payment reads `cancelled`, the same command run again births the new " +
    "dated Payment with a fresh operation signed now and sent on the new day. Running it again is safe: the new " +
    "Payment's request key is the old Payment's id and the new day, so a repeat answers the same approval.",
  concept: concept_payments,
  kind: "action",
  who: "The payer of the dated payment. For a budget's dated payment, the wearer of the budget's hat or one above it.",
  input: Schema.Struct({ payment_id: S, org: Null(S), on: S }),
  output: Handover,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED, ...READ_FAILURES],
  reads: [...AUTHORITY_READS, approvalsData.table_approvals],
  writes: [table_payment_commands, table_payments],
  drives: [machine_payment.t.open],
  invokes: [approvals.procedure_approvals_open],
  emits: [],
  calls: [integration_chain_rpc.c.readContract],
  chain: [contract_budgets.f.scheduledOf, contract_budgets.f.authorised, contract_budgets.f.cancel, contract_budgets.f.schedule],
  spans: [],
  budget: budget("chain-read"),
  was: [
    `${OLD}/lifecycles/operations/prepare-scoped.ts`,
    `${OLD}/lifecycles/reads/reschedules.ts:66`,
    "packages/backend/src/payments/commands/tests/prepare-budget.test.ts",
    "apps/docs/factory/operations/payment.reschedule.yaml",
  ],
});
