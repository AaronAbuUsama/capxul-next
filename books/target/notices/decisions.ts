// Notices' own judgments, as decision records. Made by Claude on 8 November 2026 while designing the
// target notices concept, under A1-A4 and P1-P10 and the shared decisions (concepts.notices,
// dependencies.notices-top, dependencies.notices-budgets, dependencies.of-notices,
// operations.dev-mail-notices-in-devnet, vocabulary.drop-email-delivery-failed), with the old code
// (/home/user/factory, integration/factory), docs/as-is/archive/operator/ and the designed concepts'
// decisions that expect a notice as evidence.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_budgets, concept_devnet, concept_notices, concept_payments } from "../shared/foundation.ts";
import { machine_payment } from "../payments/data.ts";
import { machine_org_head, machine_org_setup } from "../organizations/data.ts";
import { machine_salary_slip } from "../payroll/data.ts";
import { machine_proposal } from "../board/data.ts";
import { machine_agreement_write } from "../payroll/data.ts";
import { integration_chain_rpc, integration_mail } from "../shared/external.ts";
import {
  event_balance_alert_transitioned,
  event_notice_transitioned,
  machine_balance_alert,
  machine_notice,
  table_balance_alerts,
  table_notices,
} from "./data.ts";
import {
  workflow_notices_accounts_account_ready,
  workflow_notices_accounts_welcome,
  workflow_notices_accounts_welcome_unlisted,
} from "./accounts.ts";
import {
  workflow_notices_organizations_fde_due,
  workflow_notices_organizations_fde_paused,
  workflow_notices_organizations_fde_ready,
  workflow_notices_organizations_head_stalled,
  workflow_notices_organizations_invitation_opened,
  workflow_notices_organizations_invitation_resent,
  workflow_notices_organizations_invitation_sent,
} from "./organizations.ts";
import { workflow_notices_budgets_office_changed } from "./budgets.ts";
import {
  workflow_notices_board_director_removed,
  workflow_notices_board_director_seated,
  workflow_notices_board_officer_granted,
  workflow_notices_board_proposal_waiting,
  workflow_notices_board_threshold_changed,
} from "./board.ts";
import {
  workflow_notices_payments_cancelled,
  workflow_notices_payments_failed,
  workflow_notices_payments_money_reminders,
  workflow_notices_payments_money_taken_back,
  workflow_notices_payments_money_waiting,
  workflow_notices_payments_scheduled,
  workflow_notices_payments_sent,
  workflow_notices_payments_short,
} from "./payments.ts";
import {
  workflow_notices_payroll_agreement_ended,
  workflow_notices_payroll_collection_refused,
  workflow_notices_payroll_payslip,
  workflow_notices_payroll_write_landed,
} from "./payroll.ts";
import {
  workflow_notices_banking_payout_delivered,
  workflow_notices_banking_payout_returned,
  workflow_notices_banking_payout_sent,
  workflow_notices_banking_person_invited,
  workflow_notices_banking_verified,
} from "./banking.ts";
import {
  workflow_notices_requests_declined,
  workflow_notices_requests_issued,
  workflow_notices_requests_matched,
  workflow_notices_requests_paid,
} from "./requests.ts";
import { workflow_notices_equity_round_invitation } from "./equity.ts";
import { workflow_notices_delivery_retry, workflow_notices_payroll_daily } from "./processes.ts";

const by = (evidence: string) => `Claude, notices target design, 8 November 2026; evidence: ${evidence}`;
const OLD = "packages/backend/src";

/** Every outbox workflow that makes a notice's first attempt. */
const OUTBOX = [
  workflow_notices_accounts_welcome,
  workflow_notices_accounts_welcome_unlisted,
  workflow_notices_accounts_account_ready,
  workflow_notices_organizations_invitation_sent,
  workflow_notices_organizations_invitation_opened,
  workflow_notices_organizations_invitation_resent,
  workflow_notices_organizations_fde_ready,
  workflow_notices_organizations_fde_due,
  workflow_notices_organizations_fde_paused,
  workflow_notices_organizations_head_stalled,
  workflow_notices_budgets_office_changed,
  workflow_notices_board_director_seated,
  workflow_notices_board_director_removed,
  workflow_notices_board_threshold_changed,
  workflow_notices_board_proposal_waiting,
  workflow_notices_board_officer_granted,
  workflow_notices_payments_scheduled,
  workflow_notices_payments_short,
  workflow_notices_payments_failed,
  workflow_notices_payments_sent,
  workflow_notices_payments_cancelled,
  workflow_notices_payments_money_waiting,
  workflow_notices_payments_money_taken_back,
  workflow_notices_payroll_write_landed,
  workflow_notices_payroll_collection_refused,
  workflow_notices_payroll_agreement_ended,
  workflow_notices_payroll_payslip,
  workflow_notices_banking_person_invited,
  workflow_notices_banking_verified,
  workflow_notices_banking_payout_sent,
  workflow_notices_banking_payout_delivered,
  workflow_notices_banking_payout_returned,
  workflow_notices_requests_issued,
  workflow_notices_requests_paid,
  workflow_notices_requests_matched,
  workflow_notices_requests_declined,
  workflow_notices_equity_round_invitation,
] as const;

/** The workflows that tell an Organization through its Directors. */
const TO_DIRECTORS = [
  workflow_notices_organizations_head_stalled,
  workflow_notices_organizations_fde_due,
  workflow_notices_organizations_fde_paused,
  workflow_notices_board_threshold_changed,
  workflow_notices_board_proposal_waiting,
  workflow_notices_payments_scheduled,
  workflow_notices_payments_failed,
  workflow_notices_payments_sent,
  workflow_notices_payments_cancelled,
  workflow_notices_payroll_write_landed,
  workflow_notices_payroll_collection_refused,
  workflow_notices_payroll_agreement_ended,
  workflow_notices_requests_issued,
  workflow_notices_requests_paid,
  workflow_notices_requests_matched,
  workflow_notices_requests_declined,
  workflow_notices_payroll_daily,
] as const;

// ── what is sent ────────────────────────────────────────────────────────────────────────────

export const decision_notices_kinds = defineDecision({
  id: "notices.kinds",
  title: "Which notices the target sends",
  question:
    "Old Capxul sent 44 kinds of email (the sign-in code among them) from a dozen notify actions. Notices owns no " +
    "frozen operation, so no frozen text " +
    "lists them. Which does the target send?",
  options: [
    {
      label: "live-subjects",
      text:
        "Every old notice whose subject lives on in the target, to its old audience and under its old template name " +
        "unless that name no longer says what it is, plus the ones the architecture and the designed concepts name; none " +
        "for a subject the target dropped.",
    },
    { label: "port-all", text: "Port all 43 notices, mapping each old event to the nearest target transition." },
    { label: "claims-only", text: "Only the notices a frozen claim or note names (the allowance, the resume, the seat, the invite)." },
  ],
  chosen: "live-subjects",
  why:
    "A notice tells a person their money or authority changed (old G5), so each one is behaviour people rely on even " +
    "where no frozen line names it; claims-only would silently stop the invoice, payout and dated-payment emails. " +
    "Port-all would invent subjects for notices whose objects are gone. Kept, by source: the beta welcome and the " +
    "account-ready message (accounts), the invitation (organizations), the allowance and department-holder emails " +
    "(budgets), a Director seated or removed, the threshold changed, a proposal waiting and an officer hat granted " +
    "(board; old owner-added, owner-removed, approvals-changed, approval-request and the three permission emails, " +
    "renamed for v4's words), the five dated-payment emails (payments), eleven " +
    "agreement emails (payroll), person verification, verified and payout sent and delivered (banking), the Invoice " +
    "emails (requests). Added because a decision names them: a payout returned and an Invoice declined " +
    "(dependencies.of-notices), a round or SAFE invitation (equity's design), and, by the money-waiting rulings, money waiting in " +
    "a claim escrow, its reminders and its refund (notices.claim-escrow, notices.money-waiting-reminders); by the Frappe " +
    "redesign, a paid salary slip's payslip (notices.payslip), a stalled head and a ready FDE (notices.head-and-fde). " +
    "Dropped with their subjects: pay runs' " +
    "pay-run-approval and pay-run-payment, approval-pending (an approval's own signer is at the page; approvals' " +
    "decision on notify), beta-waitlist (accounts.admission-paths), invoice-part-received (requests.escrow-process) and " +
    "payout-ceiling-alert (notices.agreements). The sign-in code stays access' (concepts.notices).",
  source: by(`${OLD}/integrations/mail/service.ts:58 (MailTemplate); packages/protocol/src/templates/emails/; concepts.notices; dependencies.of-notices`),
  affects: [table_notices, ...OUTBOX, workflow_notices_payroll_daily, workflow_notices_payments_money_reminders],
});

export const decision_notices_one_workflow_per_transition = defineDecision({
  id: "notices.one-workflow-per-transition",
  title: "One outbox workflow per transition a notice follows",
  question:
    "concepts.notices says one workflow per notice kind, triggered by the source's transition. But a trigger names one " +
    "transition, and the invitation email follows three (send, open, resend) and the welcome two (admit, admit_unlisted).",
  options: [
    { label: "per-transition", text: "One workflow per transition, sharing its steps with the kind's other workflows (kit.ts)." },
    { label: "after-rpc", text: "Trigger each kind after the producer's rpcs, the way organizations' invitation process starts." },
    { label: "per-kind", text: "One workflow per kind on its first transition, its `about` naming the others." },
  ],
  chosen: "per-transition",
  why:
    "A workflow's trigger is a transition the outbox delivers (P4); `after` an rpc would couple notices to the " +
    "producer's rpcs, miss transitions its processes drive (`open` is the invitation process's, `finish` the setup's), " +
    "and make notices name rpcs of concepts that know nothing of it. Per-kind would leave transitions nobody follows " +
    "while the book claimed they were. So the kinds with several causes have one small workflow each, and the build " +
    "links each to exactly the transition it follows: 35 outbox workflows, each of three to six steps. Two follow " +
    "payments' `cancel` (a dated payment's, and a claim escrow taken back), each sending only for its own Payments.",
  source: by("packages/book/src/records/behaviour.ts (Trigger: one transition); P4; books/target/organizations/decisions.ts (organizations.invitation-process)"),
  affects: [
    workflow_notices_organizations_invitation_sent,
    workflow_notices_organizations_invitation_opened,
    workflow_notices_organizations_invitation_resent,
    workflow_notices_accounts_welcome,
    workflow_notices_accounts_welcome_unlisted,
  ],
});

export const decision_notices_no_staleness_check = defineDecision({
  id: "notices.no-staleness-check",
  title: "A notice tells the transition that committed, even if the subject moved on",
  question:
    "Old notify actions sent nothing when the subject had left the state its event put it in by the time they ran " +
    "(a scheduled payment already sent, an invoice already paid). Keep that check?",
  options: [
    { label: "tell-what-happened", text: "Send what the transition says; each later transition sends its own notice." },
    { label: "check-state", text: "Read the subject's state first and send nothing if it moved on." },
  ],
  chosen: "tell-what-happened",
  why:
    "The outbox delivers a transition within a second, so a moved-on subject is rare, and each move it made sends its " +
    "own true notice in order (scheduled, then cancelled). The old check made a notice depend on a second read, and a " +
    "read that failed sent nothing at all with no record (old R8). Facts are still read when the notice is sent, so an " +
    "amount is the one current then (the allowance's, `org allowance assign` #5).",
  source: by(`${OLD}/payments/notices/rules.ts:40 (STATE_OF_EVENT); ${OLD}/banking/payouts/rules/notices.ts:40; docs/as-is/payments.md (R8)`),
  affects: [...OUTBOX],
});

// ── how it is sent ──────────────────────────────────────────────────────────────────────────

export const decision_notices_first_attempt = defineDecision({
  id: "notices.first-attempt",
  title: "The outbox workflow makes the first attempt; a held notice gets a retry process",
  question:
    "Three tries, a minute then four apart (integration mail). Who makes them, and when is the delivery record born?",
  options: [
    {
      label: "first-then-retry",
      text:
        "Each outbox workflow sends to each recipient and records the outcome as the row's birth (sent, retrying or " +
        "failed); a row born retrying starts one retry process, instance per notice, which makes the other two tries.",
    },
    {
      label: "queue-then-deliver",
      text: "Each outbox workflow writes a queued row; one delivery process per notice makes every attempt.",
    },
    { label: "each-retries", text: "Each outbox workflow sends and retries itself, with its own timers." },
  ],
  chosen: "first-then-retry",
  why:
    "`dev mail notices` shows each record 'sent, retrying or failed' (frozen about); a queued state would show a " +
    "fourth, and start a second workflow for every notice that is sent at once, nearly all of them. Retries in every " +
    "outbox workflow would repeat the backoff and its guard in each and make each one wait minutes. Here a notice is " +
    "the long-lived object only when it is held, and then it has one process (A3) that owns its last two attempts. The " +
    "provider's idempotency key is the notice's, so an attempt repeated after a crash is taken once; the mail call " +
    "itself never retries (integrations.timeouts).",
  source: by(`dev.mail.notices.yaml (about); ${OLD}/integrations/mail/notices.ts:17 (NOTICE_ATTEMPTS, delays); integration mail`),
  affects: [machine_notice, table_notices, workflow_notices_delivery_retry, ...OUTBOX],
});

export const decision_notices_refused_address = defineDecision({
  id: "notices.refused-address",
  title: "A refused address fails at once; an outage or a throttle is retried",
  question: "The mail call fails three ways: PROVIDER_ERROR, RATE_LIMITED, INVALID_INPUT (the recipient refused). Retry which?",
  options: [
    { label: "retry-retryable", text: "Retry PROVIDER_ERROR and RATE_LIMITED; record INVALID_INPUT as `failed` at once (`refuse`)." },
    { label: "retry-all", text: "Retry every failure, as old sendNotice did." },
  ],
  chosen: "retry-retryable",
  why:
    "A provider that refused the address will refuse it a minute later too; retrying only delays a record that says so. " +
    "The devnet's mail sink answers its fail switch as a provider failure (PROVIDER_ERROR), so `dev mail fail` still " +
    "shows a notice retrying, as its frozen about says. The error codes are the shared vocabulary's; " +
    "EMAIL_DELIVERY_FAILED stays dropped (vocabulary.drop-email-delivery-failed).",
  source: by("books/target/shared/external.ts (integration mail failures); dev.mail.fail.yaml (about); vocabulary.drop-email-delivery-failed"),
  affects: [machine_notice, workflow_notices_delivery_retry, integration_mail],
});

export const decision_notices_delivery_record = defineDecision({
  id: "notices.delivery-record",
  title: "One delivery record per notice and recipient, keyed so a notice goes once",
  question: "What does the delivery record hold, and what makes a notice go once?",
  options: [
    {
      label: "keyed-row",
      text:
        "One row per (recipient, notice id), the id `<template>:<occasion>` with the transition's outbox id as the " +
        "occasion; the template's facts, not the body; status, attempts, last error and mail id; an index per filter " +
        "`dev mail notices` takes.",
    },
    { label: "as-is", text: "Port noticeDeliveries: an upsert keyed by `${operation}:${subject}:${event}` and recipient, any status from any status." },
  ],
  chosen: "keyed-row",
  why:
    "The outbox id is unique per transition and the same on every redelivery, so the key itself is the idempotency, " +
    "with no claim table and no event naming scheme; the daily notices name their agreement and period instead. Facts " +
    "let a retry render the same message without storing every body. Old noticeDeliveries took any status from any " +
    "status (P7 makes each a transition with its event), and its template filter ran after the 200 newest rows were " +
    "taken, so it missed older matches; an index serves it. `notice_transitioned` replaces the old " +
    "`[CAPXUL_MAIL_FAILED]` and `[CAPXUL_NOTICE_RECORD_FAILED]` log lines: a record that cannot be written is the " +
    "workflow's own retry, not a log line.",
  source: by(`docs/as-is/archive/operator/data.ts (notice-deliveries, notice-delivery); docs/as-is/archive/operator/notices.ts; ${OLD}/integrations/mail/notices.ts:41`),
  affects: [table_notices, machine_notice, event_notice_transitioned],
});

export const decision_notices_mailbox_tenancy = defineDecision({
  id: "notices.mailbox-tenancy",
  title: "A delivery record is its recipient's, keyed by mailbox",
  question: "Whose row is a delivery record (P8)? Old noticeDeliveries had no tenant column at all.",
  options: [
    { label: "mailbox", text: "`person` tenancy with the mailbox as `tenantField`, as accounts' admissions; devnet's reads across are cross-tenant indexes." },
    { label: "subject", text: "`owner` tenancy: the Organization or person the notice is about." },
    { label: "global", text: "`global`: written only by the system." },
  ],
  chosen: "mailbox",
  why:
    "A notice is what was said to its recipient, at their mailbox, and many recipients have no principal yet (an " +
    "invitee, an outside payer, a referred friend), as with accounts.mailbox-tenancy. The subject's tenant would put a " +
    "payee's email under the payer's tenant. Global would leave personal data with no row policy. Only devnet's `dev " +
    "mail notices` reads across mailboxes, so the two cross-tenant indexes say so; `org_id` and `person_id` are kept on " +
    "the row for the event and for readers that know them.",
  source: by("books/target/accounts/decisions.ts (accounts.mailbox-tenancy); P8; docs/as-is/archive/operator/data.ts (notice-deliveries: no tenant column)"),
  affects: [table_notices],
});

// ── who is told, and from what ──────────────────────────────────────────────────────────────

export const decision_notices_recipients = defineDecision({
  id: "notices.recipients",
  title: "Who a notice reaches: a mailbox, a principal, the Directors, a budget's wearers",
  question: "Notices must turn a subject's parties into mailboxes. How, for a person, an agent and an Organization?",
  options: [
    {
      label: "directors-and-wearers",
      text:
        "A person at the mailbox the source row carries, else at their principal's email; an agent never (it has no " +
        "mailbox); an Organization through its Directors, the company Safe's owners now, each to its principal's email. " +
        "A notice about a budget's money (an agreement accepted, a payout, a payment sent, due or uncollected) also goes " +
        "to whoever wears that budget's hat now, read from indexing's hat-wearers when it is sent; the person who acted " +
        "(an offerer, a payout's maker, a payment's requester) is told only while they still wear it.",
    },
    {
      label: "directors",
      text: "An Organization through its Directors only, and the person who acted where the source row names one.",
    },
    { label: "seats", text: "An Organization through every Seat (old paid-invoice notices)." },
  ],
  chosen: "directors-and-wearers",
  why:
    "Parties holds only a mailbox's digest (parties.mailbox-digest), so the mailbox comes from the row that named it " +
    "(an invitation's grantee, an offer's payee, a request's payer, a named person) or from access' principal. The " +
    "Directors can act on every subject a notice tells about, while every Seat would tell people with no authority. A " +
    "department's money is acted on by whoever wears its hat now, so its current wearers must hear about it, and a " +
    "person swapped out of the hat must not keep hearing about money they can no longer act on " +
    "(docs/design/authority.md, contradiction 11). Who wears a hat is an indexed chain fact, so notices reads " +
    "indexing's hat-wearers (dependencies.of-notices); the Directors stay the company Safe's owners read now " +
    "(notices.chain-reads).",
  source: by(`${OLD}/requests/receivables/reads/notices.ts:30, :89; ${OLD}/payroll/agreements/operations/sweep.ts:44; parties.mailbox-digest`),
  affects: [...TO_DIRECTORS],
});

export const decision_notices_chain_reads = defineDecision({
  id: "notices.chain-reads",
  title: "Live chain state for a notice is read through chain-rpc, not indexing",
  question:
    "Some notices need the chain as it is now: an allowance's amount, what a payee can collect, a Safe's balance, the " +
    "Directors. Notices does not depend on indexing. Where does it read them?",
  options: [
    { label: "chain-rpc", text: "Read the view functions through chain-rpc when the notice is sent." },
    { label: "add-indexing", text: "Add indexing to notices' dependencies and read Ponder's views." },
    { label: "producer-copies", text: "Ask each producing concept to copy the figures onto its rows." },
  ],
  chosen: "chain-rpc",
  why:
    "The concept map gives notices no indexing edge (dependencies.of-notices), and a designer does not add one. These " +
    "are live state, not facts that happened: an amount after any change that applied, what an agreement has released " +
    "by now, a balance, the current owners; the view functions answer exactly, which is what chain-rpc is for. " +
    "Producers copying figures would put chain state in rows that drift, which payroll and budgets designed away " +
    "(payroll.live-reads, budgets.chain-is-the-record). A failed read is the workflow's own retry.",
  source: by("books/target/shared/external.ts (integration chain-rpc); payroll.live-reads; budgets.chain-is-the-record; dependencies.of-notices"),
  affects: [
    concept_notices,
    integration_chain_rpc,
    workflow_notices_budgets_office_changed,
    ...TO_DIRECTORS.filter((w) => w !== workflow_notices_payroll_daily),
    workflow_notices_payroll_daily,
  ],
});

export const decision_notices_allowance_amount = defineDecision({
  id: "notices.allowance-amount",
  title: "The allowance email follows budgets' apply, at the chain's amount when sent",
  question:
    "'Once a v4 assign executes, the member is emailed the allowance at its amount now, after any change that applied' " +
    "(org allowance assign #5). budgets.notices-need-budgets asks for the edge. What is needed?",
  options: [
    {
      label: "apply-and-read",
      text:
        "One workflow on `budget-change.apply`; for an allowance it reads `Budgets.budgetOf` when it sends. Budgets is " +
        "already in notices' dependsOn (dependencies.notices-budgets), so foundation.ts is unchanged.",
    },
    { label: "change-terms", text: "Use the amount in the change's terms." },
  ],
  chosen: "apply-and-read",
  why:
    "The terms hold the amount proposed, which a later `org allowance change` may have replaced before the assign " +
    "executed; the chain's amount at send time is 'its amount now, after any change that applied'. The shared map " +
    "already carries the edge the budgets designer asked for, recorded by dependencies.notices-budgets, so the " +
    "concept map needs no change. The same workflow tells department holders (old department-holder emails), so one " +
    "workflow follows budgets.",
  source: by("org.allowance.assign.yaml #5; books/target/budgets/decisions.ts (budgets.notices-need-budgets); dependencies.notices-budgets"),
  affects: [workflow_notices_budgets_office_changed, concept_notices, concept_budgets],
});

export const decision_notices_admission = defineDecision({
  id: "notices.admission",
  title: "Welcome every admission but an invitation's; account-ready after the setup",
  question: "Which admissions send the beta welcome, and where does the account-ready message come from?",
  options: [
    {
      label: "admission-rules",
      text:
        "Welcome on `admit` and `admit_unlisted` unless admitted `invitation:<org>` or `escrow:<payment>`; the referrer " +
        "named when admitted by a referral; nothing for a reward of invites; account-ready on the personal Safe's `finish`.",
    },
    { label: "every-admission", text: "Welcome every admission, the invitation's included." },
  ],
  chosen: "admission-rules",
  why:
    "`org member invite` admits the invitee 'with no second welcome email' (#1), and procedures.accounts-admit says the " +
    "invitation email is the welcome; money waiting admits its recipient as an invitation does, and its money-waiting " +
    "email is that welcome (accounts.money-waiting-admits). `referral invite` 'sends them the invite email': old code sent the welcome, so " +
    "the welcome names who invited them. A referrer rewarded with an invite got no email before, and still does not; " +
    "rewarded with their own admission, they get the welcome. The 'on the list' email went with the hold " +
    "(accounts.admission-paths). Account-ready moved from profiles to the Safe's setup (parties.no-process).",
  source: by(`${OLD}/access/waitlist/writes.ts:110; ${OLD}/access/referrals/operations/invite.ts:57; org.member.invite.yaml #1; procedures.accounts-admit`),
  affects: [workflow_notices_accounts_welcome, workflow_notices_accounts_welcome_unlisted, workflow_notices_accounts_account_ready],
});

export const decision_notices_invitations = defineDecision({
  id: "notices.invitations",
  title: "The invitation email follows send, open and resend; a refusal is notices'",
  question: "organizations.invitation-delivery gives the email and its delivery to notices. Which transitions send it?",
  options: [
    {
      label: "three",
      text: "`send` (a Seat-only offer, open at once), `open` (an offer with grants, once the Board's batch ran) and `resend`; never to an `@handle`.",
    },
    { label: "birth-only", text: "Email at both births, including an offer still authorizing its grants." },
  ],
  chosen: "three",
  why:
    "An offer with grants cannot be accepted until it opens, so emailing at its birth would invite someone to nothing. " +
    "Each resend is its own transition with its own outbox id, so each delivers exactly one message and a redelivery " +
    "none (`org invite resend` #2, as organizations rewrote it). A provider refusal is a row here and never touches the " +
    "offer (#3). An agent has no mailbox and finds its offer with `invite list` (`org member invite` note 5).",
  source: by("books/target/organizations/decisions.ts (organizations.invitation-delivery); org.invite.resend.yaml #2-#3; org.member.invite.yaml note 5"),
  affects: [
    workflow_notices_organizations_invitation_sent,
    workflow_notices_organizations_invitation_opened,
    workflow_notices_organizations_invitation_resent,
  ],
});

export const decision_notices_dated_payments = defineDecision({
  id: "notices.dated-payments",
  title: "Dated payments send five notices; the payer is the requester, once per batch",
  question:
    "Payments gives notices `come_due` for the day-ahead warning and `lapse` for a failed payment. Which Payment " +
    "transitions notify whom?",
  options: [
    {
      label: "dated-only",
      text:
        "For a Payment with `pay_at`: schedule, settle and cancel tell the payee; come_due with a shortfall tells the " +
        "payer; lapse tells both. Any other undated Payment sends nothing (a claim escrow's money-waiting email is " +
        "notices.claim-escrow's). The payer of an Organization's Payment is its " +
        "command's requester, told once per command.",
    },
    { label: "every-payment", text: "Also tell the payee of every settled Payment and the payer of every lapsed one." },
  ],
  chosen: "dated-only",
  why:
    "These are old payments' notices (ADR-0034 ruling 6A): a dated payment happens while nobody watches, so both sides " +
    "need telling; an undated one is followed live by its payer (`payment send` follows it, `payment retry` is " +
    "offered there), and old Capxul sent no general payment-received email, so adding one is a product choice left " +
    "open. Old M9 looked the payer up through the execution and found no one for a Board payment; the command's " +
    "`requested_by` always names a principal. Old R8 sent a batch's payer one email per Payment; the payer's notice id " +
    "is the command's, so they get one.",
  source: by(`${OLD}/payments/notices/rules.ts:1; docs/as-is/payments.md (R8, M9); books/target/payments/decisions.ts (payments.dated, payments.machine)`),
  affects: [
    workflow_notices_payments_scheduled,
    workflow_notices_payments_short,
    workflow_notices_payments_failed,
    workflow_notices_payments_sent,
    workflow_notices_payments_cancelled,
  ],
});

export const decision_notices_agreements = defineDecision({
  id: "notices.agreements",
  title: "Agreement emails follow landed writes, a refused collection and the end",
  question:
    "payroll.notices-elsewhere hands every agreement email to notices, fed by payroll's two events. Which transitions, " +
    "and what of old notices with no target cause?",
  options: [
    {
      label: "writes-and-end",
      text:
        "A landed write sends by its change (none for a withdrawal); a payee's reverted collection sends " +
        "collection-refused; `finish` sends agreement-ended; the calendar notices are the daily cron's.",
    },
    { label: "status", text: "Follow `agreement_transitioned` only, one workflow per status change." },
  ],
  chosen: "writes-and-end",
  why:
    "The frozen lines are about writes: 'a landed resume tells the payee once; a prepared one tells no one' (`org payroll " +
    "agreement resume` #2) and 'a landed withdrawal sends the payee no email' (`withdraw` #2). A write lands once, so " +
    "its outbox id makes one email; a rate change, a cancelled lowering and a collection move no status, so status " +
    "alone would miss them. The end is the process's timer now (payroll.one-process), so it sends agreement-ended and " +
    "the sweep no longer looks for ended agreements. The old payout-ceiling alert to the Directors needed the revert " +
    "reason, which a failed write does not keep; the low-balance alert still warns them of a short Safe.",
  source: by(`${OLD}/payroll/agreements/rules/notices.ts:178; org.agreement.resume.yaml #2; org.agreement.withdraw.yaml #2; payroll.notices-elsewhere`),
  affects: [workflow_notices_payroll_write_landed, workflow_notices_payroll_collection_refused, workflow_notices_payroll_agreement_ended],
});

export const decision_notices_daily_agreement_notices = defineDecision({
  id: "notices.daily-agreement-notices",
  title: "The daily agreement notices: a cron, notice ids as claims, a balance alert",
  question: "P3 keeps the daily agreement notices as a cron. What does it send, and what stops it sending twice?",
  options: [
    {
      label: "ids-and-alert",
      text:
        "Pay ready per release period and a fixed term's last week, keyed by notice ids that name the period; a " +
        "balance-alerts row per Organization and token, raised and cleared, so a short Safe alerts once per episode.",
    },
    { label: "claim-table", text: "Port payroll's notice-claim table, deleted when a low balance recovers." },
  ],
  chosen: "ids-and-alert",
  why:
    "A notice id that names its agreement and period is its own claim, so a second run, a devnet warp or a resume " +
    "finds the rows. Only the low-balance alert must re-arm after the Safe recovers, which is a state: a machine with " +
    "its event (P7), not a row deleted by hand. It runs at 00:15 UTC as before. Its budget leaves the background " +
    "class: it reads every running agreement and each paying Safe on chain, Organization by Organization (P5).",
  source: by(`${OLD}/platform/jobs.ts:152; ${OLD}/payroll/agreements/rules/sweeps.ts:44; ${OLD}/payroll/tables.ts:317; P3 (crons that stay)`),
  affects: [workflow_notices_payroll_daily, table_balance_alerts, machine_balance_alert, event_balance_alert_transitioned],
});

export const decision_notices_invoices = defineDecision({
  id: "notices.invoices",
  title: "Invoice emails as before, with a decline added",
  question: "Old receivables emailed only for Invoices, and told a payer only when no inbox showed it. Keep that?",
  options: [
    {
      label: "invoices",
      text:
        "Invoices only: issued to a payer Organization or an outside payer; paid (settle or match) to the issuer, with " +
        "a receipt to an outside payer; declined to the issuer.",
    },
    { label: "every-request", text: "Every request kind, and every payer, a person on Capxul included." },
  ],
  chosen: "invoices",
  why:
    "A person on Capxul finds a request in `inbox`, and a basic or link request's issuer shares its checkout link " +
    "(old: 'only a customer paying through an escrow hears from Capxul about it'). Widening that is a product choice " +
    "no ruling makes. A bank deposit match pays it as surely as a settlement, as before. The decline is added because " +
    "dependencies.of-notices names it. Part-received went with the state it followed (requests.escrow-process).",
  source: by(`${OLD}/requests/receivables/reads/notices.ts:129; ${OLD}/requests/writes/deposits.ts:118; dependencies.of-notices; requests.escrow-process`),
  affects: [workflow_notices_requests_issued, workflow_notices_requests_paid, workflow_notices_requests_matched, workflow_notices_requests_declined],
});

export const decision_notices_banking = defineDecision({
  id: "notices.banking",
  title: "Banking's notices: the named person, verified once, a payout's three moves",
  question: "Which of banking's transitions send mail, and to whom?",
  options: [
    {
      label: "five",
      text:
        "The named person's invitation; verified at the first approval, once per verification; a payout funded, " +
        "delivered and returned, to the person who made it.",
    },
    { label: "per-currency", text: "Verified at every currency's approval." },
  ],
  chosen: "five",
  why:
    "banking.verification-people gives the invitation email to notices. Each further currency's approval is its own " +
    "transition (banking's machine), and old Capxul sent one verified email, so the id is the verification's. The " +
    "payout emails are old banking's, to the payer; a return can come after delivery (K13) and leaves the payer's " +
    "money on its way back, so dependencies.of-notices names it.",
  source: by(`${OLD}/parties/verifications/rules/notices.ts:14; ${OLD}/banking/payouts/rules/notices.ts:36; banking.verification-people; K13`),
  affects: [
    workflow_notices_banking_person_invited,
    workflow_notices_banking_verified,
    workflow_notices_banking_payout_sent,
    workflow_notices_banking_payout_delivered,
    workflow_notices_banking_payout_returned,
  ],
});

export const decision_notices_round_invitation = defineDecision({
  id: "notices.round-invitation",
  title: "An investor invited to a round or SAFE is emailed, at low priority",
  question: "Equity's design says notices reacts to an investor's `invite`. Old Capxul sent no such email. Send one?",
  options: [
    { label: "send", text: "Send `round-invitation` on `fundraise-investment.invite`, low priority like equity." },
    { label: "none", text: "Send nothing, as before: the investor finds it with `capxul invest`." },
  ],
  chosen: "send",
  why:
    "concepts.notices and dependencies.of-notices both name 'a round or SAFE invitation', and the equity designer " +
    "built the transition for it. An invited investor is often outside the company and has no other way to learn of " +
    "it. Equity is low priority (CONVENTIONS rule 4), so this workflow is too.",
  source: by("books/target/equity/data.ts (fundraise_investment_transitioned); concepts.notices; dependencies.of-notices"),
  affects: [workflow_notices_equity_round_invitation],
});

export const decision_notices_board = defineDecision({
  id: "notices.board",
  title: "Board's notices follow its changes, its proposals and its officer grants",
  question:
    "Board, designed beside notices, sends no mail and says notices follows its events. Which of its transitions " +
    "send, and to whom?",
  options: [
    {
      label: "board-transitions",
      text:
        "A seat (`seat`) to the member, a removal (`remove`) to the Director, a threshold (`set_threshold`) and a " +
        "proposal born (`propose`) to the Directors, an officer grant applied (`apply`, grant) to the member.",
    },
    { label: "chain-events", text: "Follow the Safe's AddedOwner, RemovedOwner and ChangedThreshold through Ponder instead." },
  ],
  chosen: "board-transitions",
  why:
    "The frozen note says Capxul 'emails the member once they are seated', and board decides when a change counts: on " +
    "its approval's landing with the effect in its facts. Chain events would bypass that and need indexing, which " +
    "notices does not depend on. The waiting email moved off approvals (approvals' decision on notify) to the opener " +
    "that knows who waits, which for a Board proposal is board. The removal, threshold and officer emails are old " +
    "owner-removed, approvals-changed and the permission emails, whose subjects live on as board's changes. A claim " +
    "and a lapsed refresh are the claimer's own act or a hat already gone, and a revoke sent nothing before; they " +
    "send nothing. The change rows carry the member's email as planned, so a seat reaches them even before they have " +
    "a principal at that Safe.",
  source: by(`org.board.director.add.yaml (note 1); books/target/board/data.ts (event abouts); ${OLD}/organizations/proposals/rules/notices.ts:1`),
  affects: [
    workflow_notices_board_director_seated,
    workflow_notices_board_director_removed,
    workflow_notices_board_threshold_changed,
    workflow_notices_board_proposal_waiting,
    workflow_notices_board_officer_granted,
  ],
});

// ── what notices is not ─────────────────────────────────────────────────────────────────────

export const decision_notices_no_door = defineDecision({
  id: "notices.no-door",
  title: "No procedures, rpcs, flows or operations: notices only reacts",
  question: "What does notices offer other concepts and clients, and what of old operator's notice functions?",
  options: [
    {
      label: "nothing",
      text:
        "Nothing: devnet reads the delivery records for `dev mail notices`; old `operator.notices.record` is each " +
        "workflow's record step, `operator.notices.list` devnet's rpc over this table.",
    },
    { label: "list-rpc", text: "A notices rpc listing delivery records, for devnet to call." },
  ],
  chosen: "nothing",
  why:
    "Nothing depends on notices but devnet (dependencies.notices-top), and a notice is never one money fact, so a " +
    "procedure would be the `notice-in-transaction` case (rules.procedures). A list rpc here would be a devnet-only rpc " +
    "in a concept staging runs, which operations.dev-mail-notices-in-devnet refuses; devnet reads the table through " +
    "its dependency. Old record had no environment gate and list read real addresses on production. Every old " +
    "concept's notify action, notice-facts read and scheduler, and payroll's notice-claim table, become these workflows.",
  source: by("docs/as-is/archive/operator/notices.ts; operations.dev-mail-notices-in-devnet; dependencies.notices-top; P2 (notice-facts, notify-*)"),
  affects: [concept_notices, concept_devnet, table_notices],
});

export const decision_notices_priority_and_budgets = defineDecision({
  id: "notices.priority-and-budgets",
  title: "Notices run at normal priority on the background budget",
  question: "What priority and budget does each notices workflow take?",
  options: [
    { label: "background", text: "Normal priority (low for equity's); `background` for every workflow; one override for the daily cron." },
    { label: "per-source", text: "Each notice at its source operation's priority and class." },
  ],
  chosen: "background",
  why:
    "No caller waits on a notice (P3), so its time is background time; a timer between retries is a wait, never system " +
    "time. One read, a render and a 2 s p95 mail call per recipient fit the class's 15 s. A notice that lags never " +
    "rolls back its change, so none is critical, even after a critical operation; equity's follows equity's low " +
    "priority. The daily cron's override says why where it is set.",
  source: by("packages/book/src/budgets.ts (background); P3; P5; CONVENTIONS rule 4 (priority)"),
  affects: [...OUTBOX, workflow_notices_delivery_retry, workflow_notices_payroll_daily, workflow_notices_payments_money_reminders],
});

export const decision_notices_worlds = defineDecision({
  id: "notices.worlds",
  title: "Notices introduces no world",
  question: "Which devnet worlds does notices introduce for its refusals?",
  options: [
    { label: "none", text: "None: notices has no operation, so no refusal; its workflows are proven from other concepts' worlds." },
    { label: "own", text: "Name worlds holding held and failed notices." },
  ],
  chosen: "none",
  why:
    "A world is where a refusal is reached from, and notices has no operation. Its workflows are observed from the " +
    "worlds the operations that cause them already name (organizations' `org-with-pending-invitation` for a resend, " +
    "budgets' and payroll's worlds), with `dev mail fail` arming a refusal and `dev mail notices` reading the record.",
  source: by("CONVENTIONS rule 4 (refusals and worlds); books/target/organizations/operations.ts (org.invite.resend)"),
  affects: [concept_notices, workflow_notices_delivery_retry],
});

// ── assembly (8 November 2026) ──────────────────────────────────────────────────────────────

const ASSEMBLY = (evidence: string) => `Claude, target assembly (rails-and-reads), 8 November 2026; evidence: ${evidence}`;

export const decision_notices_failed_proposals = defineDecision({
  id: "notices.failed-proposals",
  title: "A payee Organization's collection whose proposal failed is refused",
  question:
    "Board added a `failed` proposal (board.failed-proposal) and asked every follower to read it as 'ran without " +
    "effect'; payroll now fails a write whose proposal failed (`execution_failed`, payroll.carrier-endings). Does the " +
    "payee hear of it?",
  options: [
    { label: "as-refused", text: "`collection-refused` follows a payee's `collected` write that reverted or ended `execution_failed`." },
    { label: "silent", text: "Only a reverted collection sends; a failed proposal sends nothing." },
  ],
  chosen: "as-refused",
  why:
    "Either way the chain ran the collection and nothing was paid, so the payee's Directors should learn it the same way " +
    "and can collect again. A failed Payment follows payments' `lapse` (payments.board-outcomes), which " +
    "`notices.payments.failed` already tells for a dated Payment, so no other notice changes.",
  source: ASSEMBLY("books/target/board/decisions.ts (board.failed-proposal); books/target/payroll/decisions.ts (payroll.carrier-endings)"),
  affects: [workflow_notices_payroll_collection_refused, machine_agreement_write.t.fail, machine_proposal.t.fail],
});

export const decision_notices_claim_escrow = defineDecision({
  id: "notices.claim-escrow",
  title: "Money waiting in a claim escrow sends a money-waiting email",
  question:
    "When a payment to an email with no account goes into a claim escrow (`escrowed`), the payee may never learn the " +
    "money is waiting. The old system sent nothing. Does notices tell them?",
  options: [
    { label: "none", text: "Send nothing, as the old system did; the payer tells the payee themselves." },
    {
      label: "money-waiting",
      text:
        "A new `money-waiting` email on payments' `escrow`, once, to the mailbox the payee Safe is derived from, naming " +
        "the amount, the payer and how to collect (sign up with that email, set up, sign the collection), and that the " +
        "payer may take it back until then.",
    },
  ],
  chosen: "money-waiting",
  why:
    "Aaron's ruling (aaron.money-waiting, 8 November 2026): 'they should get a money is waiting email', so this record, " +
    "which had chosen none for want of a product call, now follows it. It is one more outbox follower of `escrow`, " +
    "keyed by the transition's outbox id, so a redelivered transition sends nothing twice. The mailbox comes from the " +
    "Payment (payments.claim-escrow-mailbox): parties keeps only digests and events carry no mailbox. It is observed " +
    "from payments' `person-with-funded-safe`, whose nobody@outside.test has no account; notices adds no world " +
    "(notices.worlds). The two questions this record once left for Aaron are ruled (aaron.money-waiting-reminders, " +
    "8 November 2026): the reminders to a payee who has not collected, the payer's word that it is uncollected and the " +
    "email when the payer takes the money back are notices.money-waiting-reminders; the beta's setup no longer refuses " +
    "the email's reader, because money waiting admits its payee as an invitation does (accounts.money-waiting-admits), " +
    "and this email is that admission's welcome.",
  source: by("books/target/shared/rulings.ts (aaron.money-waiting, Aaron's ruling of 8 November 2026); books/target/payments/decisions.ts (payments.claim-escrow-fit)"),
  affects: [concept_notices, concept_payments, machine_payment.t.escrow, workflow_notices_payments_money_waiting],
});

// ── after the Frappe redesign and the follow-up rulings (8 November 2026) ──────────────────

const RULINGS = (evidence: string) => `Claude, assembly (world group), 8 November 2026; evidence: ${evidence}`;

export const decision_notices_money_waiting_reminders = defineDecision({
  id: "notices.money-waiting-reminders",
  title: "Waiting money reminds at 3, 10 and 30 days; a refund tells the recipient",
  question:
    "Aaron ruled that the recipient is reminded after some days that money is waiting, the payer is told it is still " +
    "uncollected, and the recipient is told if the payer takes it back; the days and the wording are designed here, " +
    "book first, on the one clock (aaron.money-waiting-reminders). Which days, which words, and what runs them?",
  options: [
    {
      label: "three-stops",
      text:
        "One notices process per escrowed Payment, on `escrow`, waiting with `Timers.until` for 3, 10 and 30 days after " +
        "the escrow's instant. Still escrowed at a stop: `money-waiting-reminder` to the recipient at each; " +
        "`money-uncollected` to the payer at 10 and 30. Then it ends; money left after 30 days is the payer's to take " +
        "back. A refund (`cancel` from `escrowed`) sends `money-taken-back` to the recipient.",
    },
    { label: "weekly-forever", text: "Remind the recipient every 7 days, and the payer every 30, for as long as the money waits." },
    { label: "daily-cron", text: "A daily cron over every escrowed Payment, sending on the days it falls on." },
  ],
  chosen: "three-stops",
  why:
    "Money waits in a claim escrow with no expiry (payments.claim-escrow-fit, gap 2), so the reminders must end on " +
    "their own. Three days catches an email missed in a busy inbox; ten is when a payer should hear that nothing has " +
    "happened and may want to send by another way; thirty is the last word to both, after which more email is noise " +
    "and the payer can take the money back. Forever is spam to someone who never wanted the money, and a cron is a " +
    "sweep P3 forbids; timers are what the one clock stops at, so a warp of a month sends the same three reminders, at " +
    "the same instants, as a real month (devnet.warp-barrier); a timer never reads the wall. The process is notices': " +
    "payments' own Payment process owns the machine and sends nothing (rules.outbox). The wording, in the templates' " +
    "facts: reminder, '<payer> sent you <amount> <asset> <n> days ago. It is still waiting for you: sign up at <link> " +
    "with this email address, set up your account, and sign the collection. Until you do, <payer> can take it back.' " +
    "(the 30-day one adds 'This is our last reminder.'); uncollected, 'The <amount> <asset> you sent to <mailbox> <n> " +
    "days ago has not been collected: they have not set up their account yet. It stays theirs to collect until you " +
    "take it back with `capxul payment cancel <payment>`' (an Organization's names its `--org`, and `--as-directors` " +
    "where the Board must take it back); taken back, '<payer> took back the <amount> <asset> that " +
    "was waiting for you. Nothing waits for you now; you can still sign up with this email address.' The admission the " +
    "money gave stands (accounts.money-waiting-admits). Observed from devnet's person-with-money-waiting: `dev time " +
    "warp 3d`, then `dev mail notices --to nobody@outside.test --template money-waiting-reminder`.",
  source: RULINGS("books/target/shared/rulings.ts (aaron.money-waiting-reminders); payments.claim-escrow-fit (gap 2); P3; devnet.warp-barrier"),
  affects: [
    workflow_notices_payments_money_reminders,
    workflow_notices_payments_money_taken_back,
    workflow_notices_payments_money_waiting,
    machine_payment.t.escrow,
    machine_payment.t.cancel,
    table_notices,
  ],
});

export const decision_notices_payslip = defineDecision({
  id: "notices.payslip",
  title: "A paid salary slip emails its employee a payslip, in Frappe HR's place",
  question:
    "Payroll asked, optionally, for a payslip email when a salary slip is paid, replacing Frappe HR's " +
    "`email_salary_slip_to_employee`, which a head keeps off. Send it, and on which transition?",
  options: [
    {
      label: "on-settle",
      text:
        "`payslip` on `settle` (the net settled, from paying or from escrowed after a new hire claimed), once, to the " +
        "Employee's personal email, with the period, the lines, the net, the transaction and the payslip's hash.",
    },
    { label: "on-submit", text: "On `submit`, as Frappe HR does when its setting is on: the slip before it is paid." },
    { label: "none", text: "Send nothing: employees read their slips themselves." },
  ],
  chosen: "on-settle",
  why:
    "A payslip tells a person what they were paid, so it follows the money: settled is when the net reached their Safe, " +
    "and a new hire's escrowed net is not paid until they collect (payroll.new-hire-escrow), when this email follows " +
    "the money-waiting one. Frappe HR emails at submit, before any payment exists, which on Capxul would tell a person " +
    "of pay that may still be withheld or cancelled. The personal email is where pay is routed (payroll.mailbox-for-pay), " +
    "never a work address. One notice regardless of a head, because the head keeps its own email off (payroll's Payroll " +
    "Settings). An agreement collection's slip is told by `pay-received` already.",
  source: RULINGS("docs/design/frappe/payroll.md (notices); hrms salary_slip.py (email_salary_slip); payroll.new-hire-escrow; payroll.mailbox-for-pay"),
  affects: [workflow_notices_payroll_payslip, machine_salary_slip.t.settle, table_notices],
});

export const decision_notices_head_and_fde = defineDecision({
  id: "notices.head-and-fde",
  title: "A stalled head tells the Directors; a founder hears their FDE is ready",
  question:
    "Projects and start-up asked, optionally, for a notice when a head connection stalls and when an Organization's " +
    "Forward Deployed Engineer becomes active. Which, to whom, from which transition?",
  options: [
    {
      label: "both",
      text:
        "`head-stalled` on the head's `stall`, to the Directors and the Director who connected it, with the reason and " +
        "the fix; `fde-ready` on the setup's `complete` when it made an FDE, to the founder.",
    },
    { label: "head-only", text: "Only the stalled head: the founder followed the setup and sees the FDE in `org show`." },
    { label: "none", text: "Neither: `org show` reports both." },
  ],
  chosen: "both",
  why:
    "A stalled head stops every app's sync silently: nothing is lost, but the head goes stale until someone restores " +
    "the site or its key, and only a Director may act on the connection, so the Directors are told, as for every " +
    "Organization notice (notices.recipients). A recovery fixes itself and needs no email. The FDE is the founder's " +
    "first helper, hosted by Capxul with its key the host's (organizations.fde-at-start-up) and no hat " +
    "(agents.fde-authority), so one email says how to talk to it and what it may not do yet; its hosting's due and " +
    "pause notices follow the hosting's own transitions (notices.fde-hosting). The setup's `complete` is where the FDE is seated and active " +
    "(organizations.fde-seat); notices reads organizations, not agents, so it follows that transition, and a setup " +
    "begun `--no-fde` sends nothing.",
  source: RULINGS("docs/design/frappe/assembly-items.md (projects-startup: notices); organizations.head-connection; organizations.fde-seat"),
  affects: [
    workflow_notices_organizations_head_stalled,
    workflow_notices_organizations_fde_ready,
    machine_org_head.t.stall,
    machine_org_setup.t.complete,
  ],
});

export const decision_notices_fde_hosting = defineDecision({
  id: "notices.fde-hosting",
  title: "The Directors hear a week before the FDE's hosting lapses, and when it pauses",
  question:
    "organizations.fde-hosting has the hosted FDE fall due seven days before its paid-through instant and pause when " +
    "it passes unpaid, and asks notices to remind with the command to run. Which notices, to whom, from which transition?",
  options: [
    {
      label: "due-and-paused",
      text:
        "`fde-hosting-due` on org-fde `fall_due` and `fde-paused` on `pause`, each once per episode, to the Directors, " +
        "with the paid-through instant in the Organization's time zone, the price of a month and `capxul org fde pay " +
        "[<months>] --from <budget>`. A resume needs no email: whoever paid followed the payment.",
    },
    { label: "due-only", text: "Only the reminder: a pause shows in `org fde show` and in `org fde ask`'s refusal." },
  ],
  chosen: "due-and-paused",
  why:
    "A paused FDE stops working for the Organization with nothing on chain to show it, so the people who can pay must " +
    "hear before and when it happens. The Directors are every Organization notice's recipients (notices.recipients); " +
    "the hosting is no budget's yet, so no wearer is told until someone pays from one. The FDE is never told to pay: " +
    "no agent pays for its own hosting (agents.fde-authority). Following the hosting's own transitions, as head-stalled " +
    "follows the head's, keeps the reminder on the one clock, so a warp past the instant sends both once.",
  source: RULINGS("organizations.fde-hosting; notices.recipients; notices.head-and-fde; books/target/organizations/data.ts (machine org-fde); aaron.fde-hosted"),
  affects: [workflow_notices_organizations_fde_due, workflow_notices_organizations_fde_paused, table_notices],
});

// ── the mail channel, shared with the CRM's conversations (8 November 2026) ─────────────────

export const decision_notices_mail_channel = defineDecision({
  id: "notices.mail-channel",
  title: "Notices and the CRM share one mail integration; a CRM email is never a notice",
  question:
    "The CRM now sends and receives email through each Organization's CRM mailbox (contacts.crm-mailbox), on the mail " +
    "integration notices already uses, with an inbound half added. Notices was the one concept that sends mail after " +
    "a change. How do the two share the channel, and what stays notices' alone?",
  options: [
    {
      label: "one-channel-two-owners",
      text:
        "One `Mail` service for both. A notice goes from SENDER_EMAIL with no Reply-To a person reads, keeps its " +
        "delivery record, retries in its workflow and counts as sent once the provider takes it, as before; a reply to " +
        "a notice reaches no CRM mailbox, and a notice's delivery events are ignored by the CRM's route. A CRM email is " +
        "the CRM's own record, a Communication sent from the Organization's CRM mailbox by a person's command or " +
        "received on it, with no notices row and no template. Both stay in their world (time.world-channels): on a " +
        "devnet and in a shared world every message, either way, is in the sink, dated at the world's now; on staging " +
        "only MAIL_ALLOWED_RECIPIENTS are written to.",
    },
    { label: "crm-as-notice", text: "Send the CRM's emails as notices, with their own templates and delivery records." },
    { label: "two-integrations", text: "A second mail integration for the CRM, apart from notices'." },
  ],
  chosen: "one-channel-two-owners",
  why:
    "A notice tells a person about a change in their own words of Capxul's; a CRM email is a person writing to a " +
    "customer, threaded by its Message-ID onto a record. Making it a notice would give it a template it does not have " +
    "and a recipient tenancy (the mailbox) that would put an Organization's conversation in the customer's records. " +
    "Two integrations would mean two providers or two configurations of one, and two ways for a world's mail to " +
    "leave it. One service keeps one fake, one sink and one staging allow-list for every mail the system sends. " +
    "Notices' retry, delivery record and refused-address rules are unchanged; only the send call now also takes a " +
    "From, a Reply-To and threading headers, which notices leaves at its defaults. For the shared owner: concept " +
    "notices' about still says no other concept sends mail but access; contacts now sends the CRM's conversations.",
  source: "Claude, CRM conversations pass (crm-conversations), 8 November 2026; evidence: aaron.world-clock; contacts.crm-mailbox; time.world-channels; notices.first-attempt",
  affects: [integration_mail, table_notices, concept_notices],
});
