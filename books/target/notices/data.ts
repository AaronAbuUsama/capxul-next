// Notices' tables, its two state machines and each machine's one event (P7), in the target design.
//
// Notices sends every email Capxul sends after a change (concepts.notices): one outbox workflow per
// transition that causes a notice (the area files), and one retry process per notice whose first
// attempt failed (processes.ts). Two tables:
//
// - `notices`: the delivery record, one row per notice and recipient: what was sent, to whom, why,
//   and how delivery went (sent, retrying or failed, the attempts, the last error). It replaces old
//   operator's `noticeDeliveries`, and its key is what makes a notice go once. Devnet's
//   `dev mail notices` reads it (operations.dev-mail-notices-in-devnet).
// - `balance-alerts`: whether an Organization's Safe is known to be short, in one token, of what its
//   payees can collect now, so the daily agreement notices alert its Directors once per shortfall.
//   It replaces old payroll's notice-claim rows for the low-balance alert.
//
// The other old notice claims (pay ready, a fixed term's last week, an ended agreement) are the
// notices rows themselves: their id names the period or the agreement, so a second day finds them.
//
// Paths in `was` are relative to the old repository root (/home/user/factory, integration/factory).

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_notices } from "../shared/foundation.ts";

const OLD = "packages/backend/src";
const MAIL = `${OLD}/integrations/mail`;
const ASIS = "docs/as-is/archive/operator/data.ts";

const S = Schema.String;
const N = Schema.Number;
const Int = Schema.Int;
const Null = Schema.NullOr;

/**
 * Every notice the target sends, by the name the mail sink and `dev mail notices --template` show.
 * Old names are kept where the notice is the old one (decision notices.kinds).
 */
export const TEMPLATES = [
  // accounts
  "beta-welcome",
  "account-ready",
  // organizations
  "organization-invitation",
  "head-stalled",
  "fde-ready",
  "fde-guest-named",
  "fde-hosting-due",
  "fde-paused",
  // budgets
  "allowance-assigned",
  "department-holder-added",
  "department-holder-removed",
  // board
  "director-seated",
  "director-removed",
  "threshold-changed",
  "proposal-waiting",
  "officer-hat-granted",
  // payments: dated payments
  "payment-scheduled",
  "payment-scheduled-short",
  "payment-scheduled-sent",
  "payment-scheduled-cancelled",
  "payment-scheduled-failed",
  // payments: a claim escrow (aaron.money-waiting, aaron.money-waiting-reminders)
  "money-waiting",
  "money-waiting-reminder",
  "money-uncollected",
  "money-taken-back",
  // payroll: agreements
  "agreement-offer",
  "agreement-accepted",
  "pay-changed",
  "agreement-paused",
  "agreement-resumed",
  "agreement-ending",
  "agreement-ended",
  "pay-received",
  "collection-refused",
  "pay-ready",
  "low-balance-alert",
  // payroll: Frappe HR's salary slips
  "payslip",
  // banking
  "person-verification",
  "bank-verified",
  "bank-payout-sent",
  "bank-payout-delivered",
  "bank-payout-returned",
  // requests: Invoices
  "invoice-received",
  "invoice-to-pay",
  "invoice-paid",
  "invoice-receipt",
  "invoice-declined",
  // equity
  "round-invitation",
] as const;
export const Template = Schema.Literals(TEMPLATES);

/** The record a notice tells about: the row of the transition that caused it, or the agreement the daily notices read. */
export const SUBJECTS = [
  "admission",
  "personal-safe",
  "invitation",
  "org-setup",
  "org-head",
  "budget-change",
  "board-change",
  "proposal",
  "officer-change",
  "payment",
  "agreement",
  "agreement-write",
  "salary-slip",
  "verification",
  "verification-person",
  "bank-payout",
  "request",
  "investment",
  "balance-alert",
] as const;
export const Subject = Schema.Literals(SUBJECTS);

/** The provider's classified failure: the error code the mail call mapped it to, and its message. Never the cause. */
const LastError = Schema.Struct({ code: Schema.Literals(["PROVIDER_ERROR", "RATE_LIMITED", "INVALID_INPUT"]), message: S });

// ── notices: the delivery record ────────────────────────────────────────────────────────────

const NOTICE_STATES = ["sent", "retrying", "failed"] as const;
const NoticeState = Schema.Literals(NOTICE_STATES);

export const table_notices = defineTable({
  id: "notices",
  title: "Notices: each notice to one recipient, and how its delivery went",
  about:
    "One row per notice and recipient. `notice_id` is `<template>:<occasion>`: the occasion is the outbox id of the " +
    "transition that caused it (so a redelivered transition finds the row and sends nothing again), or, where a " +
    "workflow's idempotency says so, what it is about: the daily agreement notices' agreement and period, a dated " +
    "payer's command and day, a payslip's slip, a money-waiting reminder's Payment and stop. `recipient` is the mailbox it went to, trimmed and lowercased; " +
    "`person_id` names the recipient's principal when Capxul has one, and `org_id` the Organization the notice is about. " +
    "`facts` are the template's inputs (names, amounts, dates, links), never the rendered body: a retry renders the same " +
    "message from them. The row is born by the first attempt's outcome: `sent` when the provider (or the devnet's mail " +
    "sink) took it, `retrying` when it failed and two attempts remain, `failed` when the address was refused. `attempts` " +
    "never goes down; `last_error` keeps the classified code and message and stays after a later success; `mail_id` is " +
    "the provider's or the sink's message id once taken. Replaces old operator's `noticeDeliveries`, whose template " +
    "filter ran after the 200 newest were taken; here an index serves it.",
  concept: concept_notices,
  tenancy: "person",
  tenantField: "recipient",
  scope:
    "The tenant is the mailbox, as accounts' admissions are: a notice can go to an email nobody has signed in with (an " +
    "invitee, an outside payer, a referred friend). Nothing in production reads across mailboxes; devnet's " +
    "`dev mail notices` does, on a local devnet only.",
  fields: Schema.Struct({
    recipient: S,
    notice_id: S,
    template: Template,
    subject_kind: Subject,
    subject_id: S,
    /** What caused it: the transition (`org-invite.resend`), `daily` for the daily agreement notices, or `stop` for a money-waiting reminder. */
    cause: S,
    person_id: Null(S),
    org_id: Null(S),
    facts: Schema.Record(S, Schema.Unknown),
    status: NoticeState,
    attempts: Int,
    last_error: Null(LastError),
    mail_id: Null(S),
    /** When the retry process makes its next attempt; null once sent or failed. */
    next_attempt_at: Null(N),
    created_at: N,
    updated_at: N,
  }),
  key: ["recipient", "notice_id"],
  indexes: [
    {
      name: "by_recipient_changed",
      fields: ["recipient", "updated_at"],
      for: "One address's delivery records, most recently changed first: `dev mail notices --to`, with or without `--template`.",
    },
    {
      name: "by_template_changed",
      fields: ["template", "updated_at"],
      crossTenant: true,
      for: "Devnet only: `dev mail notices --template` across every address, most recently changed first.",
    },
    {
      name: "by_changed",
      fields: ["updated_at"],
      crossTenant: true,
      for: "Devnet only: `dev mail notices` with no filter, the most recently changed records first.",
    },
  ],
  retention: "Kept indefinitely, as before: a delivery record is the only account of what a notice did.",
  was: [`${OLD}/operator/tables.ts:49`, `${OLD}/operator/notices/writes.ts:27`, `${MAIL}/notices.ts:41`, ASIS],
});

export const event_notice_transitioned = defineEvent({
  id: "notice_transitioned",
  about:
    "A notice's delivery moved: taken at the first attempt, held for a retry, taken on a retry, held again, refused or " +
    "given up. Sent by every transition of `notice`, through the outbox. It never carries the mailbox or the facts: " +
    "`person_id` names the recipient when Capxul knows them. Replaces old `[CAPXUL_MAIL_FAILED]` log lines as the signal " +
    "of a failing notice.",
  props: Schema.Struct({
    from: Null(NoticeState),
    to: NoticeState,
    transition: Schema.Literals(["send", "hold", "refuse", "deliver", "defer", "fail"]),
    notice_id: S,
    template: Template,
    cause: S,
    attempts: Int,
    error_code: Null(S),
    person_id: Null(S),
    org_id: Null(S),
  }),
  was: [`${MAIL}/notices.ts:14`, `${MAIL}/notices.ts:97`],
});

export const machine_notice = defineMachine({
  id: "notice",
  title: "A notice's delivery: sent, retrying or failed",
  about:
    "notices.status. Three tries in all, as before: the outbox workflow that plans a notice makes the first and records " +
    "it (a birth: `send`, `hold` or `refuse`); a held notice's own process tries again after a minute and then four " +
    "(`deliver`, `defer`, `fail`). A retryable failure is the provider's outage or throttle (PROVIDER_ERROR, " +
    "RATE_LIMITED); a refused address (INVALID_INPUT) is never retried. Old noticeDeliveries took any status from any " +
    "status with no guard; here every move is one of these transitions.",
  table: table_notices,
  field: "status",
  initial: "sent",
  states: [
    { id: "sent", about: "The provider, or the devnet's mail sink, took the message. It does not prove the inbox received it.", terminal: true },
    { id: "retrying", about: "An attempt failed and another is due at `next_attempt_at`." },
    { id: "failed", about: "The address was refused, or the third attempt failed; nothing more is tried.", terminal: true },
  ],
  transitions: {
    send: {
      from: [],
      to: "sent",
      about: "Birth: the first attempt was taken.",
      emits: [event_notice_transitioned],
    },
    hold: {
      from: [],
      to: "retrying",
      about: "Birth: the first attempt failed with PROVIDER_ERROR or RATE_LIMITED; the next is due in a minute.",
      emits: [event_notice_transitioned],
    },
    refuse: {
      from: [],
      to: "failed",
      about: "Birth: the provider refused the address (INVALID_INPUT) at the first attempt; it is not retried.",
      emits: [event_notice_transitioned],
    },
    deliver: {
      from: ["retrying"],
      to: "sent",
      about: "A retry was taken.",
      guard: "The attempt is the one the row is waiting for: `attempts` has not moved since it was scheduled.",
      emits: [event_notice_transitioned],
    },
    defer: {
      from: ["retrying"],
      to: "retrying",
      about: "The second attempt failed with a retryable error; the last is due in four minutes.",
      guard: "`attempts` is 2 after this attempt.",
      emits: [event_notice_transitioned],
    },
    fail: {
      from: ["retrying"],
      to: "failed",
      about: "The third attempt failed, or a retry's address was refused.",
      emits: [event_notice_transitioned],
    },
  },
  was: [`${OLD}/operator/tables.ts:54`, `${MAIL}/notices.ts:28`, `${MAIL}/notices.ts:51`, ASIS],
});

// ── balance-alerts: a payroll Safe short of what its payees can collect ─────────────────────

const ALERT_STATES = ["raised", "cleared"] as const;
const AlertState = Schema.Literals(ALERT_STATES);

export const table_balance_alerts = defineTable({
  id: "balance-alerts",
  title: "Balance alerts: a company Safe short, in one token, of what payees can collect",
  about:
    "One row per Organization and token the daily agreement notices once found short: the company Safe held less of the " +
    "token than its running agreements' payees could collect in it then. `raised` while the Safe stays short, so its " +
    "Directors are alerted once; `cleared` when a later day finds it covered (or nothing owed), so the next shortfall " +
    "alerts again. `episode` counts the times it was raised and names the alert's notices. `shortfall` is what was owed " +
    "past the balance when last raised, in raw token units. Replaces old payroll's low-balance notice claim.",
  concept: concept_notices,
  tenancy: "organization",
  tenantField: "org_id",
  fields: Schema.Struct({
    org_id: S,
    token_address: S,
    status: AlertState,
    episode: Int,
    shortfall: S,
    raised_at: N,
    cleared_at: Null(N),
    updated_at: N,
  }),
  key: ["org_id", "token_address"],
  indexes: [],
  retention: "Kept for the Organization's life: one row per token it ever ran short in.",
  was: [`${OLD}/payroll/agreements/rules/sweeps.ts:136`, `${OLD}/payroll/agreements/writes/sweeps.ts:22`, `${OLD}/payroll/tables.ts:323`],
});

export const event_balance_alert_transitioned = defineEvent({
  id: "balance_alert_transitioned",
  about:
    "A company Safe was found short in a token of what its payees can collect (raised, or raised again), or covered " +
    "again (cleared). Through the outbox; the funnel sees how often payroll runs dry.",
  props: Schema.Struct({
    from: Null(AlertState),
    to: AlertState,
    transition: Schema.Literals(["raise", "clear", "raise_again"]),
    org_id: S,
    token_address: S,
    episode: Int,
  }),
  was: [`${OLD}/payroll/agreements/rules/sweeps.ts:136`],
});

export const machine_balance_alert = defineMachine({
  id: "balance-alert",
  title: "Balance alert: raised while the Safe is short",
  about:
    "balance-alerts.status, moved only by the daily agreement notices. The first shortfall in a token is a birth " +
    "(`raise`); a covered Safe clears it; a later shortfall raises it again with the next episode. Each raise alerts the " +
    "Directors once.",
  table: table_balance_alerts,
  field: "status",
  initial: "raised",
  states: [
    { id: "raised", about: "The Safe was short when last read; its Directors were alerted for this episode." },
    { id: "cleared", about: "A later day found the Safe covering what its payees can collect in the token, or nothing owed." },
  ],
  transitions: {
    raise: {
      from: [],
      to: "raised",
      about: "Birth: the first day the Safe is found short in the token.",
      emits: [event_balance_alert_transitioned],
    },
    clear: {
      from: ["raised"],
      to: "cleared",
      about: "The Safe holds at least what its payees can collect in the token now, or they can collect nothing.",
      emits: [event_balance_alert_transitioned],
    },
    raise_again: {
      from: ["cleared"],
      to: "raised",
      about: "Short again after being cleared: the episode counts up and the Directors are alerted again.",
      emits: [event_balance_alert_transitioned],
    },
  },
  was: [`${OLD}/payroll/agreements/operations/sweep.ts:70`],
});
