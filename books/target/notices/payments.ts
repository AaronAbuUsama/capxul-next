// The payments area: the emails a dated payment sends (old payments' notices, ADR-0034 ruling 6A).
// The payee is told when it is scheduled, sent, cancelled or failed; the payer a day ahead when it
// may not go (the warning approvals leaves to payments' `come_due`, approvals.held-sends) and when it
// failed. A Payment with no date sends nothing: its payer is following it, and `payment retry` is
// offered where they are (decision notices.dated-payments).
//
// Who is the payer: a person's own Payment tells that person; an Organization's tells the principal
// who asked for it (its command's `requested_by`), so a Board or budget payment reaches someone (old
// M9 found no one). The payer's notices are keyed by the command, so a batch of several Payments
// tells its payer once (old R8 sent one email per Payment). The payee's are keyed per Payment.

import { table_principals } from "../access/data.ts";
import { table_organizations } from "../organizations/data.ts";
import { machine_payment, table_payment_commands, table_payments } from "../payments/data.ts";
import { contract_safe } from "../shared/external.ts";
import { DIRECTORS, PERSON, noticeWorkflow } from "./kit.ts";

const OLD = "packages/backend/src/payments/notices";

const p = machine_payment.t;

const PAYEE = {
  name: "payee",
  about:
    "The payee by `payee_kind` and `payee_id`: a person at their principal's email, an Organization through its " +
    "Directors; a payee Capxul does not know (an outside address) is told nothing.",
} as const;

const PAYER = {
  name: "payer",
  about:
    "The payer: the owner, when a person; for an Organization, the principal who asked for the payment (its command's " +
    "`requested_by`). One notice per command, listing every Payment of it on that day.",
} as const;

const DATED_ONLY = { name: "payment", about: "Reads the Payment; one with no `pay_at` ends here with no notice." } as const;

const READS = [table_payments, table_payment_commands, table_organizations, table_principals];

/** The payer's notice is keyed by the command and the day, so a batch tells its payer once. */
const BY_COMMAND =
  "The payee's notice id is `<template>:<the transition's outbox id>`; the payer's is `<template>:<command id>:<pay_at>`, " +
  "so every Payment of a batch after the first finds its payer's row and sends nothing. A send lost before its record " +
  "is repeated under the same provider idempotency key, taken once.";

export const workflow_notices_payments_scheduled = noticeWorkflow({
  id: "notices.payments.scheduled",
  title: "Tell a payee a payment to them is scheduled",
  about:
    "Follows `schedule`: a dated payment's operation is signed and held for its day, or its budget reserves it. Sends " +
    `\`payment-scheduled\` to the payee with the payer's name, the amount and asset, and the day it pays. ${PERSON} ${DIRECTORS}`,
  trigger: { transition: p.schedule },
  reads: READS,
  steps: [DATED_ONLY, PAYEE],
  chain: [contract_safe.f.getOwners],
  was: [`${OLD}/rules.ts:62`, `${OLD}/operations/notify.ts:1`, `${OLD}/reads.ts:41`],
});

export const workflow_notices_payments_short = noticeWorkflow({
  id: "notices.payments.short",
  title: "Warn a payer the day before that a dated payment may not go",
  about:
    "Follows `come_due`, a day before a dated payment's day, when payments read its funding and kept a shortfall: the " +
    "personal Safe's balance is too low, or the budget is spent. Sends `payment-scheduled-short` to the payer with what " +
    "is missing and when it pays, so they can fund it in time. A Payment that came due fully funded sends nothing.",
  trigger: { transition: p.come_due },
  reads: READS,
  steps: [{ name: "payment", about: "Reads the Payment that came due; with no `shortfall` it ends here." }, PAYER],
  idempotency: BY_COMMAND,
  was: [`${OLD}/rules.ts:107`, "books/target/payments/decisions.ts (payments.dated: come_due for notices)"],
});

export const workflow_notices_payments_failed = noticeWorkflow({
  id: "notices.payments.failed",
  title: "Tell both sides a dated payment did not go",
  about:
    "Follows `lapse` of a dated payment: its signed window closed with the Safe still short, or its operation reverted " +
    "or was displaced; nothing moved. Sends `payment-scheduled-failed` to the payee and to the payer (worded for each, " +
    "with why), the payer's naming `payment retry` and `payment reschedule`. An undated lapse sends nothing. " +
    `${PERSON} ${DIRECTORS}`,
  trigger: { transition: p.lapse },
  reads: READS,
  steps: [DATED_ONLY, PAYEE, PAYER],
  chain: [contract_safe.f.getOwners],
  idempotency: BY_COMMAND,
  was: [`${OLD}/rules.ts:85`, "docs/as-is/payments.md (R8, M9)"],
});

export const workflow_notices_payments_sent = noticeWorkflow({
  id: "notices.payments.sent",
  title: "Tell a payee a scheduled payment reached them",
  about:
    "Follows `settle` of a dated payment: the indexed PaymentSent matched every term. Sends `payment-scheduled-sent` " +
    `to the payee with the amount and the payer's name. An undated settlement sends nothing. ${PERSON} ${DIRECTORS}`,
  trigger: { transition: p.settle },
  reads: READS,
  steps: [DATED_ONLY, PAYEE],
  chain: [contract_safe.f.getOwners],
  was: [`${OLD}/rules.ts:66`],
});

export const workflow_notices_payments_cancelled = noticeWorkflow({
  id: "notices.payments.cancelled",
  title: "Tell a payee a scheduled payment was cancelled",
  about:
    "Follows `cancel` of a dated payment: the payer cancelled or rescheduled it, its Board proposal was rejected, or " +
    "Budgets released it. Sends `payment-scheduled-cancelled` to the payee; a reschedule's new date then reaches them " +
    `as its own \`payment-scheduled\`. An undated cancel sends nothing. ${PERSON} ${DIRECTORS}`,
  trigger: { transition: p.cancel },
  reads: READS,
  steps: [DATED_ONLY, PAYEE],
  chain: [contract_safe.f.getOwners],
  was: [`${OLD}/rules.ts:74`],
});
