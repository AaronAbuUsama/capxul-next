// The payments area: the emails a dated payment sends (old payments' notices, ADR-0034 ruling 6A),
// and the money-waiting email of a claim escrow (Aaron's ruling aaron.money-waiting).
// The payee is told when it is scheduled, sent, cancelled or failed; the payer a day ahead when it
// may not go (the warning approvals leaves to payments' `come_due`, approvals.held-sends) and when it
// failed. Any other Payment with no date sends nothing: its payer is following it, and `payment retry` is
// offered where they are (decision notices.dated-payments). A payment to a mailbox with no account
// tells that mailbox the money waits, and how to collect it (decision notices.claim-escrow); while it
// waits, one process per escrowed Payment reminds the mailbox after 3, 10 and 30 days and tells the
// payer at 10 and 30 that it is still uncollected, and a refund tells the mailbox the money was taken
// back (aaron.money-waiting-reminders, decision notices.money-waiting-reminders).
//
// Who is the payer: a person's own Payment tells that person; an Organization's tells the principal
// who asked for it (its command's `requested_by`), so a Board or budget payment reaches someone (old
// M9 found no one). The payer's notices are keyed by the command, so a batch of several Payments
// tells its payer once (old R8 sent one email per Payment). The payee's are keyed per Payment.

import { table_hat_wearers } from "../indexing/data.ts";
import { budget, defineWorkflow } from "../../packages/blueprint-engine/src/index.ts";
import { table_principals } from "../access/data.ts";
import { table_organizations } from "../organizations/data.ts";
import { event_payment_transitioned, machine_payment, table_payment_commands, table_payments } from "../payments/data.ts";
import { concept_notices } from "../shared/foundation.ts";
import { contract_safe, integration_mail } from "../shared/external.ts";
import { machine_notice, table_notices } from "./data.ts";
import { DIRECTORS, PERSON, SEND_STEPS, noticeWorkflow } from "./kit.ts";

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
    "The payer: a person owner; for an Organization, the paying budget's current hat wearers (indexing), the requester " +
    "only while still one, or a Board payment's Directors. One notice per command, listing its Payments that day.",
} as const;

const DATED_ONLY = { name: "payment", about: "Reads the Payment; one with no `pay_at` ends here with no notice." } as const;

const READS = [table_payments, table_payment_commands, table_organizations, table_principals, table_hat_wearers];

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
  was: [`${OLD}/rules.ts:107`, "blueprint/payments/decisions.ts (payments.dated: come_due for notices)"],
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

export const workflow_notices_payments_money_waiting = noticeWorkflow({
  id: "notices.payments.money-waiting",
  title: "Tell someone with no account that money is waiting for them",
  about:
    "Follows `escrow`: the funding's PaymentSent is indexed (payments.escrow-on-funding), so a claim escrow holds the " +
    "money for a mailbox (aaron.money-waiting). Sends `money-waiting` once, to the Payment's `payee_mailbox` (the " +
    "mailbox its owner Safe is derived from), naming the amount and asset, the sender and how to collect: with no " +
    "account yet, sign up at the link with this email address, set up the account and sign the collection the setup " +
    "opens; with an account already set up, run `capxul payment claim` " +
    "(aaron.payment-claim, payments.claim-command); until then the sender may take it back. No one else is told: the sender is following the payment. Its world is payments' " +
    "`person-with-funded-safe`: Dana's signed `payment send nobody@outside.test 5`, then `dev mail notices --to " +
    "nobody@outside.test --template money-waiting` reads the delivery record and `notice_transitioned` says it went.",
  trigger: { transition: p.escrow },
  reads: READS,
  steps: [
    {
      name: "payment",
      about:
        "Reads the escrowed Payment: route `claim_escrow`, its `payee_mailbox`, amount, asset and escrow address; one with no mailbox ends here.",
    },
    {
      name: "facts",
      about:
        "The payer: a person's `payer_label`, an Organization's name. The amount and asset, the escrow on the chain's explorer, and the web app's sign-up link for the mailbox.",
    },
  ],
  was: ["blueprint/shared/rulings.ts (aaron.money-waiting)", "blueprint/payments/decisions.ts (payments.claim-escrow-mailbox)"],
});

// ── money waiting: reminders, and a refund (aaron.money-waiting-reminders) ───────────────────

const DAY_MS = 86_400_000;

const n = machine_notice.t;

export const workflow_notices_payments_money_reminders = defineWorkflow({
  id: "notices.payments.money-reminders",
  title: "Remind someone money waits for them, and tell the payer it is uncollected",
  about:
    "Started by `escrow`, one instance per escrowed Payment: money waits in a claim escrow with no expiry, so someone " +
    "must be reminded (aaron.money-waiting-reminders). It keeps the instant of the `escrow` transition (the one clock's, " +
    "from its outbox event) and waits with `Timers.until` for each of three stops: 3, 10 and 30 days after it. At each " +
    "stop it reads the Payment again; still `escrowed`, it sends `money-waiting-reminder` to the Payment's " +
    "`payee_mailbox` (the amount and asset, the payer, how long it has waited, how to collect, and that the payer may " +
    "take it back until then; the 30-day one says it is the last reminder), and at 10 and 30 days `money-uncollected` " +
    "to its sender (the payer rule of the dated notices: a person, or for a budget's whoever wears its hat then), naming the mailbox, " +
    "the amount, how long, and how to take it back (`payment cancel`). Its notice ids name the Payment and the stop " +
    "(`money-waiting-reminder:<payment>:<days>`), so a resume or a warp sends each once. It ends when the Payment " +
    "leaves `escrowed` (collected, settled, or taken back) or after the 30-day stop; the money still waits, and the " +
    "payer has been told twice. A warp stops at each instant (devnet.warp-barrier), so a simulated month sends the " +
    "same three reminders a real one would.",
  concept: concept_notices,
  priority: "normal",
  trigger: { transition: p.escrow },
  instance: { per: table_payments },
  waits: [
    {
      name: "stop",
      for: "timer",
      timeoutMs: 30 * DAY_MS,
      about: "Timers.until the next stop: 3, then 10, then 30 days after the escrow's instant, each on the one clock.",
    },
    {
      name: "moved",
      for: "signal",
      key: [{ on: [event_payment_transitioned], props: ["payment_id"] }],
      about: "The Payment left `escrowed`: collected (`settle`, or `mismatch` on a differing term) or taken back (`cancel`, outcome refunded). Nothing more is sent.",
    },
  ],
  steps: [
    {
      name: "arm",
      about:
        "Reads the escrowed Payment: route `claim_escrow` with a `payee_mailbox`, else it ends here. Keeps the escrow's instant and arms the 3-day stop.",
    },
    {
      name: "recheck",
      about: "At a stop: reads the Payment again; no longer `escrowed`, it ends with no notice.",
    },
    {
      name: "remind",
      about:
        "`money-waiting-reminder` to the mailbox; at 10 and 30 days also `money-uncollected` to the payer, keyed by the command and the stop (`money-uncollected:<command>:<days>`) and naming every Payment of that command still `escrowed`, so a batch tells its payer once per stop.",
    },
    ...SEND_STEPS,
    { name: "next", about: "Arms the next stop, or ends after the 30-day one." },
  ],
  reads: [...READS, table_notices],
  writes: [table_notices],
  drives: [n.send, n.hold, n.refuse],
  invokes: [],
  emits: [],
  calls: [integration_mail.c.send],
  chain: [],
  idempotency:
    "`money-reminders:<payment>` for the instance; the recipient's notice id names the Payment and its stop, the " +
    "payer's the command and the stop, so a rerun, a replayed timer or a batch's other Payments find their rows and " +
    "send nothing again.",
  timeoutMs: 31 * DAY_MS,
  retries: { max: 5, backoff: "exponential" },
  compensation: "None: a reminder reports money that is still waiting; the Payment is payments' alone.",
  budget: { ...budget("background"), excludes: ["wait.stop", "wait.moved"] },
  was: ["blueprint/shared/rulings.ts (aaron.money-waiting-reminders)", "blueprint/payments/decisions.ts (payments.claim-escrow-fit, gap 2: no expiry)"],
});

export const workflow_notices_payments_money_taken_back = noticeWorkflow({
  id: "notices.payments.money-taken-back",
  title: "Tell someone the money that waited for them was taken back",
  about:
    "Follows `cancel` of a Payment that was `escrowed`: its sender (for a budget's, whoever wears the budget's hat " +
    "then, or the Board) took the claim escrow back before the recipient collected, and the money is the sender's " +
    "again (outcome refunded). Sends " +
    "`money-taken-back` once to the Payment's `payee_mailbox`: who took back how much, that nothing waits for them now, " +
    "and that they may still sign up with this address, since the money's admission to the beta stands " +
    "(accounts.money-waiting-admits). The payer is told nothing: they asked for it. Any other cancel sends nothing here.",
  trigger: { transition: p.cancel },
  reads: READS,
  steps: [
    {
      name: "payment",
      about:
        "Reads the cancelled Payment: only route `claim_escrow`, cancelled from `escrowed` with outcome refunded and a `payee_mailbox`, goes on.",
    },
    { name: "facts", about: "The payer's name (a person's `payer_label`, an Organization's name), the amount and asset, and the sign-up link." },
  ],
  was: ["blueprint/shared/rulings.ts (aaron.money-waiting-reminders)"],
});
