// Banking's own judgments as decision records: each table's and machine's shape, what the old
// banking and old parties' verification and accounts lose, the processes, the flows, the rewritten
// acceptance lines, the worlds and the budget overrides. The architecture's judgments are in
// ../shared/decisions.ts (concepts.banking, dependencies.payments-banking, rules.procedures,
// operations.invite-accept-in-banking).

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { concept_banking, concept_approvals, concept_budgets } from "../shared/foundation.ts";
import { error_CANCELLED, error_INVALID_INPUT, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { rpc_contacts_book_get, rpc_contacts_book_list } from "../contacts/book.ts";
import { procedure_approvals_withdraw } from "../approvals/procedures.ts";
import { rpc_approvals_signing_get, rpc_approvals_signing_sign } from "../approvals/signing.ts";
import { table_budgets } from "../budgets/data.ts";
import { procedure_payments_prepare_command } from "../payments/procedures.ts";
import { table_files } from "../media/data.ts";
import { integration_bridge } from "../shared/external.ts";
import * as d from "./data.ts";
import { procedure_banking_match_deposit } from "./procedures.ts";
import { rpc_banking_verification_start, rpc_banking_verification_status } from "./verification.ts";
import { rpc_banking_details_settle, rpc_banking_details_show } from "./details.ts";
import {
  rpc_banking_accounts_add,
  rpc_banking_accounts_list,
  rpc_banking_accounts_list_for_contact,
  rpc_banking_accounts_remove,
  rpc_banking_accounts_requirements,
} from "./accounts.ts";
import { rpc_banking_deposits_list } from "./deposits.ts";
import { rpc_banking_payouts_get, rpc_banking_payouts_quote, rpc_banking_payouts_resolve } from "./payouts.ts";
import { rpc_banking_inbox_receive } from "./inbox.ts";
import {
  workflow_banking_deposits_credit,
  workflow_banking_inbox_catch_up,
  workflow_banking_payouts_follow,
  workflow_banking_verification_follow,
} from "./processes.ts";
import {
  flow_client_account_address_book_get,
  flow_client_account_bank_accounts_add,
  flow_client_banking_payouts_pay,
  flow_client_org_invitations_accept,
  flow_client_verification_start,
  flow_client_verification_status,
} from "./flows.ts";
import * as o from "./operations.ts";

const OPERATIONS = [
  o.operation_verify_start,
  o.operation_verify_status,
  o.operation_invite_accept,
  o.operation_bank_accounts,
  o.operation_bank_accounts_add,
  o.operation_contact_bank_add,
  o.operation_contact_get,
  o.operation_bank_accounts_remove,
  o.operation_bank_deposits,
  o.operation_bank_details,
  o.operation_bank_settle,
  o.operation_bank_pay,
];

// ── data ────────────────────────────────────────────────────────────────────────────────────

export const decision_banking_tables = defineDecision({
  id: "banking.tables",
  title: "Eight tables: old banking's and old parties' rows, consolidated",
  question:
    "Old banking had eight tables (two retired but holding rows) and old parties four more for verification and bank " +
    "accounts. Which does the target keep, and in what shape?",
  options: [
    {
      label: "eight",
      text:
        "verifications, verification-people, bank-details, bank-accounts, bank-deposits, bank-payouts, bridge-events, " +
        "bridge-sync; the retired quotes and rail operations, the payout log and verification documents go.",
    },
    { label: "as-is", text: "Port every old table with its columns." },
  ],
  chosen: "eight",
  why:
    "Each kept table is a business object a frozen operation shows or a process follows. The retired `quotes` and " +
    "`railOperations` rows exist only for the old conversion (P9: nothing is migrated). The append-only " +
    "`payoutTransitions` log is the workflow engine's history and the `bank_payout_transitioned` events now. " +
    "Verification documents were transfer buffers: media stores them (concepts.media). Every table drops the plumbing " +
    "columns (observation context, journey, correlation and surface ids, back-off, park, lease and run columns, P2, P3), " +
    "and every private value is encrypted bound to its row with the one RECORD_ENCRYPTION_KEY, so a value copied to " +
    "another row does not decrypt.",
  source: "docs/as-is/archive/banking/data.ts; packages/backend/src/parties/tables.ts:9-130; P2, P3, P9",
  affects: [
    d.table_verifications,
    d.table_verification_people,
    d.table_bank_details,
    d.table_bank_accounts,
    d.table_bank_deposits,
    d.table_bank_payouts,
    d.table_bridge_events,
    d.table_bridge_sync,
  ],
});

export const decision_banking_owner_tenancy = defineDecision({
  id: "banking.owner-tenancy",
  title: "Every banking row is an owner's: a person's or an Organization's",
  question: "Old rows were keyed by a Party, an account or an actor id, each table its own way. What tenant column do they carry?",
  options: [
    { label: "owner", text: "Tenancy `owner`: `owner_kind` and `owner_id` (a person_id or an org_id) on every row, leading the key and every index." },
    { label: "party", text: "Key every row by the owner's Party id." },
  ],
  chosen: "owner",
  why:
    "The row-level policy sets the session's person or Organization tenant (P8), which is an owner, not a Party; contacts " +
    "and payments' rows use the same pair. The Party stays a column where the row names one (whose Safe a deposit lands " +
    "in, whose account a payout pays). A business verification's people are the Organization's rows; the invited person " +
    "reaches and submits their own through its invitation id and their email, the one cross-tenant read and write in " +
    "banking, which the generated row-level policy must allow by that clause. Bridge's inbox and cursor are " +
    "the deployment's (`global`). The old tables mixed `ownerPartyId`, `actorId` and `declaredBy`, so a tenancy by join.",
  source: "P8; docs/as-is/archive/banking/data.ts (owner tenancy by ownerPartyId and actorId); blueprint/contacts/data.ts",
  affects: [
    d.table_verifications,
    d.table_verification_people,
    d.table_bank_details,
    d.table_bank_accounts,
    d.table_bank_deposits,
    d.table_bank_payouts,
  ],
});

export const decision_banking_one_bank_account_store = defineDecision({
  id: "banking.one-bank-account-store",
  title: "One store of saved bank accounts, for yourself, a contact or a named payee",
  question:
    "Old parties kept bank accounts in `partyAccounts` and again as the bank kind of `counterpartyDestinations`. Which " +
    "does the target keep?",
  options: [
    { label: "one-table", text: "One `bank-accounts` table in banking with a scope: self, contact (a contact's Party) or payee (a holder name only)." },
    { label: "two-tables", text: "Keep both, one for payouts and one for the address book's destinations." },
  ],
  chosen: "one-table",
  why:
    "Both described the same thing, an external bank account a payout goes to, and only payouts use one; parties keeps " +
    "wallet destinations (responsibilities.destinations). A payee known only by name has no Party, since contacts " +
    "always name one, so its account carries the holder name and no Party. The frozen `partyAccountId` is the row's id.",
  source: "packages/backend/src/parties/tables.ts:9 (partyAccounts), :215 (counterpartyDestinations); bank.accounts.add.yaml",
  affects: [d.table_bank_accounts, d.machine_bank_account, rpc_banking_accounts_add],
});

export const decision_banking_keys_from_records = defineDecision({
  id: "banking.keys-from-records",
  title: "Bridge's Idempotency-Key comes from the record, so a write calls Bridge first",
  question:
    "Old banking wrote a row with its creation key, called Bridge in an action, then finalized the row (prepare, " +
    "finalize). An rpc is one transaction now. How is a Bridge create made exactly once?",
  options: [
    { label: "derived-key", text: "Derive each key from the record (owner, currency, request key), call Bridge, then write once." },
    { label: "two-steps", text: "Keep prepare and finalize as two rpcs, or a workflow." },
  ],
  chosen: "derived-key",
  why:
    "Bridge replays the first answer for a repeated key, so a retry after a lost answer or a failed transaction reaches " +
    "the same customer, virtual account, external account or transfer; with the key derivable, nothing must be stored " +
    "before the call. It removes eight old rpcs (the prepare, finalize and load pairs) and keeps every write one " +
    "transaction (A3). A verification's key is the owner's; bank details' the owner, currency and attempt; an account's " +
    "and a payout's the owner and request key.",
  source: "packages/backend/src/banking/bank-details/README.md; parties/accounts/README.md:46; integrations.set (Bridge idempotency)",
  affects: [
    rpc_banking_verification_start,
    rpc_banking_details_show,
    rpc_banking_accounts_add,
    rpc_banking_payouts_quote,
    integration_bridge,
  ],
});

// ── verification ────────────────────────────────────────────────────────────────────────────

export const decision_banking_verification_process = defineDecision({
  id: "banking.verification-process",
  title: "A verification's process follows Bridge to its decision, then ends",
  question:
    "rules.durable-processes gives a verification one durable process. What does it own, and what applies Bridge's " +
    "changes once the decision is made?",
  options: [
    { label: "until-decision", text: "The process applies Bridge's snapshots until every currency is decided, then ends; the inbox applies later changes." },
    { label: "forever", text: "One process for the verification's whole life, idle between Bridge's events." },
    { label: "none", text: "No process: the inbox applies every snapshot." },
  ],
  chosen: "until-decision",
  why:
    "Until the decision there is something to wait for (the person on Bridge's page, every named person of a business, " +
    "Bridge's review) and one place must hold a business out of review until its people submit, which the old " +
    "`businessApprovalReported` flag did. After it, Bridge's rare later changes need no waiting and the inbox applies " +
    "them in the same order. `verify start` drives `begin` and Bridge's immediate answer, as a signal rpc may; " +
    "`verify status` reads Bridge back and writes nothing, as its frozen `changes` says.",
  source: "rules.durable-processes; packages/backend/src/parties/verifications/README.md:56; verify.status.yaml (changes)",
  affects: [
    workflow_banking_verification_follow,
    d.machine_verification,
    rpc_banking_verification_start,
    rpc_banking_verification_status,
    rpc_banking_inbox_receive,
  ],
});

export const decision_banking_verification_people = defineDecision({
  id: "banking.verification-people",
  title: "A business's people each submit their own details, by invitation",
  question: "A Director can add the business's people. Who submits each person's identity details?",
  options: [
    { label: "invited", text: "Each named person gets an `inv_kyb_` invitation and submits their own details with `verify start` or `invite accept`." },
    { label: "director", text: "The Director submits every person's details." },
  ],
  chosen: "invited",
  why:
    "Old parties did this, and it keeps another person's identity documents out of the Director's hands: the Director " +
    "gives only names, email and legal roles. The invitation grants no Organization permission. Notices sends its email " +
    "from `verification_person_transitioned` (invite), so banking sends no mail. The delivery state leaves the row.",
  source: "packages/backend/src/parties/verifications/README.md:28; verify.start.yaml (who, acceptance 3 and 9)",
  affects: [d.table_verification_people, d.machine_verification_person, rpc_banking_verification_start, flow_client_org_invitations_accept],
});

export const decision_banking_manage_authority = defineDecision({
  id: "banking.manage-authority",
  title: "Managing an Organization's banking needs a Director or the Books officer",
  question:
    "The frozen text says opening details, settling, saving and removing accounts for an Organization needs 'current " +
    "authority to manage it'. Which hats are that on v4?",
  options: [
    { label: "director-or-books", text: "A Director (the Director hat) or the Books officer (the Books hat); verifying the business needs a Director." },
    { label: "director-only", text: "Only a Director." },
    { label: "any-member", text: "Any member." },
  ],
  chosen: "director-or-books",
  why:
    "Old banking checked the Organization's manager role, which v4 replaces with the Director hat and the three officer " +
    "hats. Bank details and saved accounts are part of the company's books of money in and out, the Books officer's " +
    "office; Bridge's KYB needs a controlling person, so the business's verification stays with Directors. A payout " +
    "itself is authorized by the budget's hat on chain, not by this. Reads (lists, deposits) need only a Seat.",
  source: "bank.details.yaml, bank.settle.yaml, bank.accounts.add.yaml (who); verify.start.yaml (who); blueprint/organizations/data.ts (org-deployments)",
  affects: [
    rpc_banking_details_show,
    rpc_banking_details_settle,
    rpc_banking_accounts_add,
    rpc_banking_accounts_remove,
    rpc_banking_verification_start,
  ],
});

// ── bank details ────────────────────────────────────────────────────────────────────────────

export const decision_banking_bank_details_machine = defineDecision({
  id: "banking.bank-details-machine",
  title: "Bank details: `failed` is reached and left, and a token change is a transition",
  question: "Old bank details had a `failed` state nothing reached, and changed the settlement token outside the machine. Keep that?",
  options: [
    { label: "reachable", text: "Bridge refusing to open is `fail`, asking again is `reopen`; `change_token` is a transition on an active account." },
    { label: "as-is", text: "Keep `failed` unreached and the token change as a plain write." },
  ],
  chosen: "reachable",
  why:
    "The frozen `bank details` returns `failed`, so it must mean something: a refusal to open. A token change is what " +
    "`bank settle` records once (its old acceptance queued one `bank_details_changed`); as a transition it sends the " +
    "machine's one event (P7), and the same token sends none. Deactivate and reactivate stay Bridge's: no frozen " +
    "operation does them, so the old rpcs go (P2).",
  source: "docs/as-is/archive/banking/data.ts:693 (to_failed undriven); bank.settle.yaml (acceptance 2, 3); bank.details.yaml (returns)",
  affects: [d.machine_bank_details, d.event_bank_details_transitioned, rpc_banking_details_settle, rpc_banking_details_show],
});

// ── deposits ────────────────────────────────────────────────────────────────────────────────

export const decision_banking_deposit_machine = defineDecision({
  id: "banking.deposit-machine",
  title: "A deposit's state is its public status; its match is a machine of its own",
  question:
    "Old deposits kept Bridge's seven bank states and a refund state and derived the public status from them. What " +
    "does the target store?",
  options: [
    { label: "public", text: "The five public statuses as the machine, and the match (unmatched, request, not request) as a second machine." },
    { label: "as-is", text: "Bridge's bank states, the refund state, and the status derived on read." },
  ],
  chosen: "public",
  why:
    "No frozen operation shows Bridge's finer states or an in-flight refund; `bank deposits` shows the status reached, " +
    "and storing it makes every write to it a named transition (P7). An in-flight or failed refund is Bridge's affair " +
    "and reads as processing. The match changes independently of the status and only once, through requests' procedure, " +
    "so it is its own machine on the same row.",
  source: "packages/backend/src/banking/deposits/rules.ts:187 (depositStatus); bank.deposits.yaml; bank.match.yaml",
  affects: [d.machine_bank_deposit, d.machine_bank_deposit_match, d.table_bank_deposits, procedure_banking_match_deposit],
});

export const decision_banking_deposit_credit = defineDecision({
  id: "banking.deposit-credit",
  title: "A deposit is credited from the indexer at finality, with its book fact",
  question: "How does a deposit become credited, and what makes its book fact once?",
  options: [
    {
      label: "process-at-finality",
      text:
        "A process per arriving deposit reads Bridge's transaction from the indexer at finality and credits the exact " +
        "Transfer; an Organization's book fact is keyed by that Transfer.",
    },
    { label: "minute-job", text: "Keep the old credit reconcile every minute with back-off and park." },
  ],
  chosen: "process-at-finality",
  why:
    "A credit waits on the chain, so it is a process with its own wait, not a sweep (P3). Reading at the finality " +
    "depth means a reorg cannot undo a credit, so banking never reverses a deposit's fact. The book fact's key is " +
    "`transfer:<chain>:<tx>:<receipt ordinal>`, the key payments' Movement of the same Transfer uses, so books keeps one live fact " +
    "whoever writes first (books.money-key). A person's deposit has no book fact: books are an Organization's.",
  source: "packages/backend/src/banking/deposits/README.md; blueprint/books/procedures.ts:37; blueprint/payments/data.ts (movements)",
  affects: [workflow_banking_deposits_credit, d.machine_bank_deposit],
});

export const decision_banking_sandbox_deposits = defineDecision({
  id: "banking.sandbox-deposits",
  title: "Test networks' deposits get their tokens from the Bridge fake, not from banking",
  question: "Old banking minted test tokens once for each sandbox deposit on staging. Keep the mint?",
  options: [
    { label: "fake", text: "Drop it: the devnet's Bridge stand-in (and staging's sandbox harness) sends the test tokens itself." },
    { label: "mint", text: "Keep a mint step in the credit process on test networks, with the faucet key." },
  ],
  chosen: "fake",
  why:
    "A mint step is code that runs only off production and makes the credit path differ by environment; the fake is " +
    "where an environment's difference belongs (the devnet's integrations are fakes). The credit process then has one " +
    "path everywhere: Bridge names a transaction, the indexer shows it.",
  source: "packages/backend/src/banking/deposits/operations/claim-mint.ts; blueprint/shared/external.ts (bridge fake)",
  affects: [workflow_banking_deposits_credit, integration_bridge],
});

export const decision_banking_match_in_requests = defineDecision({
  id: "banking.match-in-requests",
  title: "Matching moves to requests; banking keeps only the deposit's side",
  question: "Old banking listed match candidates, matched, and auto-matched by reference. What stays in banking?",
  options: [
    { label: "procedure", text: "Only `banking.match-deposit`; candidates and the match by reference are requests'." },
    { label: "as-is", text: "Keep candidates and auto-match in banking." },
  ],
  chosen: "procedure",
  why:
    "concepts.requests puts `bank match` in requests, which reads banking's deposits (it depends on banking). A match " +
    "by reference is a request's judgment, so requests reacts to `bank_deposit_transitioned` (credit) for it. The deposit " +
    "and the request it paid are one money fact, so the deposit side is the procedure, with `none` for not a request.",
  source: "concepts.requests; packages/backend/src/banking/deposits/operations/auto-match.ts; bank.match.yaml",
  affects: [procedure_banking_match_deposit, d.machine_bank_deposit_match],
});

// ── payouts ─────────────────────────────────────────────────────────────────────────────────

export const decision_banking_payout_machine = defineDecision({
  id: "banking.payout-machine",
  title: "Seven payout states; `funding` is read from the Payment",
  question: "Old payouts had twelve states for a dispatcher, timers and a funding claim. Which does the target keep?",
  options: [
    { label: "seven", text: "quoted, in_transit, delivered, returning, refunded, expired, needs_attention; `funding` derived from the Payment on read." },
    { label: "as-is", text: "Keep the twelve PascalCase states." },
  ],
  chosen: "seven",
  why:
    "The quote now creates Bridge's transfer before the payout exists, so `Creating` and `Refused` cannot be stored; " +
    "Bridge lets an unfunded transfer lapse, so `Cancelling` and `Cancelled` are `expired`; `ClosedUnfunded` is a " +
    "reason of needs_attention. `Funding` was the payout's copy of its Payment being sent: payments owns that " +
    "(`submitted`), so `banking.payouts.get` reports stage `funding` from it rather than copying it. `delivered` is not " +
    "final, because a bank can return a delivered payout (K13).",
  source: "packages/backend/src/banking/payouts/rules/vocabulary.ts:8; dependencies.payments-banking; docs/as-is/payments.md (K13)",
  affects: [d.machine_bank_payout, d.table_bank_payouts, rpc_banking_payouts_get],
});

export const decision_banking_processes = defineDecision({
  id: "banking.processes",
  title: "One process per payout replaces the dispatcher, timers and watchdog",
  question:
    "Old payouts were driven by a dispatcher, one live timer each with its job, a ten-minute watchdog for lost timers, a " +
    "notify workflow and one door with a log. What drives a payout now?",
  options: [
    { label: "one-process", text: "One durable process per payout, with its own waits (the Payment, the deadline, Bridge's events, the refund)." },
    { label: "as-is", text: "Port the dispatcher, the tick, the watchdog and the door." },
  ],
  chosen: "one-process",
  why:
    "A3 makes a bank payout one process, and the workflow engine (A2) keeps its timers and survives crashes, which is " +
    "what the dispatcher's leases, the timer jobs and the watchdog existed for. Each wait has the old limit: the " +
    "deadline, 7 days to deliver, 14 days for a refund, and a 60-day window after delivery for a bank's return. No cancel " +
    "call is booked: Bridge lets an unfunded transfer lapse, and the Payment cannot land after the deadline unless " +
    "payments lets it (a problem left to payments' design).",
  source: "packages/backend/src/banking/payouts/README.md:58-100; A2; A3; rules.durable-processes",
  affects: [workflow_banking_payouts_follow, workflow_banking_deposits_credit, workflow_banking_verification_follow, d.table_bank_payouts],
});

export const decision_banking_payout_payment = defineDecision({
  id: "banking.payout-payment",
  title: "The quote births the payout and its Payment in one transaction",
  question: "Old payments called back into banking at the send claim to accept the quote. How are the payout and its Payment bound?",
  options: [
    {
      label: "quote-births",
      text:
        "The quote rpc reads the funding, then in one transaction writes the payout, names Bridge's deposit address as an " +
        "outside Party and births the Payment command through `payments.prepare-command`.",
    },
    { label: "two-steps", text: "Quote first, and birth the Payment when the payer accepts, as the old door did." },
  ],
  chosen: "quote-births",
  why:
    "The payout and the Payment that funds it are one money fact (rules.procedures): a Payment to a deposit address with " +
    "no payout following it would send money Capxul cannot account for. Births in one transaction remove the old callback " +
    "loop (payments never reads banking, dependencies.payments-banking). The deposit address is a counterparty the " +
    "Payment routes money to, so it is bound by `parties.resolve-recipient`. The funding read precedes the transaction, " +
    "as prepare-command requires.",
  source: "blueprint/payments/procedures.ts (prepare-command); packages/backend/src/banking/payouts/writes/payments.ts:73",
  affects: [rpc_banking_payouts_quote, d.machine_bank_payout],
});

export const decision_banking_resolve_signal = defineDecision({
  id: "banking.resolve-signal",
  title: "An operator's resolution stays, as the payout process's signal",
  question: "Old payouts needing attention were resolved by hand from the Convex dashboard. Keep a resolution?",
  options: [
    { label: "signal", text: "Keep `banking.payouts.resolve`, an operator-only signal of the payout's process." },
    { label: "drop", text: "Drop it: no frozen operation calls it." },
  ],
  chosen: "signal",
  why:
    "Money that left a Safe and stopped (Bridge moved it unfunded, a wrong amount, a refund past its limit) needs a " +
    "person, and without a resolution the process would wait to its timeout. As a signal it is reached (P2), and the " +
    "process, not the rpc, writes the outcome, so the machine keeps one owner.",
  source: "packages/backend/src/banking/payouts/README.md:107 (ruling E2 of 14 Oct on CAP-725)",
  affects: [rpc_banking_payouts_resolve, workflow_banking_payouts_follow],
});

// ── the inbox ───────────────────────────────────────────────────────────────────────────────

export const decision_banking_inbox = defineDecision({
  id: "banking.inbox",
  title: "Bridge's events are applied in the transaction that stores them",
  question:
    "Old banking stored each event, scheduled a processing run, backed failures off and parked them, and leased the " +
    "catch-up. How does the target take Bridge's events?",
  options: [
    { label: "apply-on-store", text: "Store and apply in one transaction; what cannot apply yet stays pending for the five-minute catch-up." },
    { label: "workflow", text: "Store, then a workflow per event applies it." },
  ],
  chosen: "apply-on-store",
  why:
    "Applying an event is a few writes and signals, with no outside call, so it fits the webhook's own transaction, and " +
    "Bridge's retry plus the catch-up cover any failure: a process per event would be plumbing (P3). The catch-up is the " +
    "one Bridge sweep P3 keeps; as a singleton it needs no lease, and every five minutes is enough behind a webhook " +
    "that normally arrives in seconds. The devnet's `readsFrom` goes with the old shared Bridge sandbox it guarded. The " +
    "inbox's own status is a machine because the catch-up reads it.",
  source: "packages/backend/src/banking/webhooks/README.md; banking/rules.ts; reconcile/README.md; P3 (Bridge catch-up)",
  affects: [rpc_banking_inbox_receive, workflow_banking_inbox_catch_up, d.machine_bridge_event, d.table_bridge_events, d.table_bridge_sync],
});

// ── behaviour not ported ────────────────────────────────────────────────────────────────────

export const decision_banking_not_ported = defineDecision({
  id: "banking.not-ported",
  title: "Old banking rpcs and workflows with no target caller are not ported",
  question: "Old banking booked 41 rpcs and 8 workflows. Which have no place in the target?",
  options: [
    {
      label: "drop",
      text:
        "Drop the prepare, finalize and load pairs, bank details' deactivate and reactivate, the payout conversion, notice " +
        "facts, overdue and watchdog, the staging mint, the inbox's load, record and back-off, the catch-up's cursor, " +
        "lease, release, recover and advance, deposit candidates and auto-match, and verification document upload and delete.",
    },
    { label: "port", text: "Port each as an rpc." },
  ],
  chosen: "drop",
  why:
    "P2: each is either an internal hop the one-transaction rpcs and processes absorb, an operation no frozen command " +
    "reaches (deactivate, reactivate, the conversion of pre-v4 rows, P9), a read another concept now does on banking's " +
    "tables (notices' facts, requests' candidates), or media's (document upload). `payments.quotes.quote`, which old " +
    "banking implemented for payments, is `banking.payouts.quote`. Removing a saved account calls Bridge no more than " +
    "the old one did, so Bridge has no remove call (integrations.bridge-bank-details-read dropped it).",
  source: "docs/as-is/archive/banking/*.ts (41 rpcs, 8 workflows); P2; P9",
  affects: [concept_banking, integration_bridge],
});

// ── flows and operations ────────────────────────────────────────────────────────────────────

export const decision_banking_flows = defineDecision({
  id: "banking.flows",
  title: "Six flows; the one-call operations are their rpc",
  question: "Which banking operations need a Core SDK flow (A4), and what are the flows called?",
  options: [
  {
    "label": "current-scope",
    "text": "Retain banking flows for verification, invite acceptance, bank pay and adding bank accounts; single-rpc operations stay single calls. Archive the contact.get flow over contacts RPCs: site Contact/Address reads use the door and banking supplies masked accounts only for resolved Parties."
  },
  {
    "label": "historical",
    "text": "The former answer to banking.flows is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Retain banking flows for verification, invite acceptance, bank pay and adding bank accounts; single-rpc operations stay single calls. Archive the contact.get flow over contacts RPCs: site Contact/Address reads use the door and banking supplies masked accounts only for resolved Parties. Authority: cut.requests; plugs.held-payment; plugs.repoint-money-fact.",
  source: "The coordinator, round 2, m1-old-decisions; cut.requests; plugs.held-payment; plugs.repoint-money-fact",
  affects: [
    flow_client_verification_start,
    flow_client_verification_status,
    flow_client_org_invitations_accept,
    flow_client_banking_payouts_pay,
    flow_client_account_bank_accounts_add,
    flow_client_account_address_book_get,
    rpc_banking_accounts_requirements,
    rpc_banking_accounts_list,
    rpc_banking_deposits_list,
  ],
});

export const decision_banking_new_payee = defineDecision({
  id: "banking.new-payee",
  title: "A new payee in `bank pay --input` is a saved account, not a new contact",
  question: "Old `bank pay --input` could create a contact with their bank details. Does banking create a contact?",
  options: [
    { label: "account-only", text: "Save the payee's bank account with their name (scope payee); the person adds a contact with `contact add` if they want one." },
    { label: "contact", text: "Call contacts' add in the flow first, then save the account on it." },
  ],
  chosen: "account-only",
  why:
    "An address book entry is not part of the money fact, and every contact names a Party, which a name with bank " +
    "numbers is not. Saving the account alone pays the bank exactly as before and keeps contacts' book something its " +
    "owner curates. No frozen acceptance line of `bank pay` names the contact.",
  source: "bank.pay.yaml (notes: 'including a new contact and their bank details'); blueprint/contacts/data.ts (party_id key)",
  affects: [flow_client_banking_payouts_pay, rpc_banking_accounts_add, d.table_bank_accounts],
});

export const decision_banking_acceptance_rewrites = defineDecision({
  id: "banking.acceptance-rewrites",
  title: "Seven acceptance lines that named a mechanism, rewritten as outcomes",
  question: "Which frozen acceptance lines of banking's operations name a mechanism a black box cannot see (P1)?",
  options: [
    {
      label: "seven",
      text:
        "`invite accept` #1 (one transaction, a durable drive call), `bank accounts` #5 and `bank deposits` #5 " +
        "('schedules nothing'), `bank accounts add` #2 and `contact bank add` #3 (a scheduled job), and `bank settle` " +
        "#2 and #3 (a queued event). `bank settle` #1 and #4 are kept: the trace observer sees Bridge's calls in order.",
    },
    { label: "verbatim", text: "Keep every line as written." },
  ],
  chosen: "seven",
  why:
    "A scheduler, a queue, a transaction and the order of internal calls are mechanisms. Each rewrite keeps the outcome " +
    "the old test proved and still passes against the old system: a read leaves the world unchanged; a save sends one " +
    "event and a replay none; settling a just-opened account succeeds; a token change is recorded once and the same " +
    "token changes nothing. `bank settle` reads Bridge before it writes again, now that the shared Bridge integration " +
    "has a read of one virtual account (banking.settle-reads-first).",
  source: "P1; blueprint/baseline/operations.ts (invite.accept, bank.accounts, bank.deposits, bank.accounts.add, contact.bank.add, bank.settle)",
  affects: [
    o.operation_invite_accept,
    o.operation_bank_accounts,
    o.operation_bank_deposits,
    o.operation_bank_accounts_add,
    o.operation_contact_bank_add,
    o.operation_bank_settle,
  ],
});

export const decision_banking_worlds = defineDecision({
  id: "banking.worlds",
  title: "The devnet worlds banking's refusals start from",
  question: "Which named devnet snapshots reach each refusal of banking's twelve operations?",
  options: [
  {
    "label": "current-scope",
    "text": "Retain verified people/companies, USD/EUR details, GBP payout, deposit-state and Bridge-failure fixtures, plus signed-out and invitation states. Contact fixtures now live on real company sites, not a Core contacts book; snapshots save those sites with the chain/service world."
  },
  {
    "label": "historical",
    "text": "The former answer to banking.worlds is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Retain verified people/companies, USD/EUR details, GBP payout, deposit-state and Bridge-failure fixtures, plus signed-out and invitation states. Contact fixtures now live on real company sites, not a Core contacts book; snapshots save those sites with the chain/service world. Authority: cut.requests; plugs.held-payment; plugs.repoint-money-fact.",
  source: "The coordinator, round 2, m1-old-decisions; cut.requests; plugs.held-payment; plugs.repoint-money-fact",
  affects: OPERATIONS,
});

export const decision_banking_budgets = defineDecision({
  id: "banking.budgets",
  title: "Class budgets, with three overrides and the person's wait excluded",
  question: "Which banking records leave their class default (P5)?",
  options: [
    {
      label: "three-overrides",
      text:
        "`verify start` and its flow (p95 10 s: document uploads), and `bank pay` with its quote rpc and `bank settle` " +
        "with its rpc (p95 5 s: two Bridge calls in sequence); every prompt and approval excluded as `wait.person`, and " +
        "`bank pay`'s chain confirmation.",
    },
    { label: "defaults", text: "Every record at its class default." },
  ],
  chosen: "three-overrides",
  why:
    "A vendor call is 2 s p95 (integrations.timeouts), so two in sequence cannot meet the vendor class's 4 s, and " +
    "uploading up to 24 MB documents is network time no class anticipates. Everything else is one Bridge call (vendor), " +
    "a read, a write, or background work.",
  source: "P5; integrations.timeouts; verify.start.yaml (notes: 15 MB and 24 MB documents)",
  affects: [
    o.operation_verify_start,
    o.operation_bank_pay,
    o.operation_bank_settle,
    flow_client_verification_start,
    rpc_banking_payouts_quote,
    rpc_banking_details_settle,
  ],
});

// ── assembly (8 November 2026) ──────────────────────────────────────────────────────────────

const ASSEMBLY = (evidence: string) => `Claude, target assembly (rails-and-reads), 8 November 2026; evidence: ${evidence}`;

export const decision_banking_contact_get = defineDecision({
  id: "banking.contact-get",
  title: "Archived: `contact get` is contacts' entry, then the accounts saved on it here",
  question:
    "The architecture review moved `contact get` to banking (shared operations.contact-get-in-banking) and contacts dropped its record (contacts.get-moved). How does banking book it, and where do a contact's accounts come from?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive contact.get's Core contacts picker/get composition. Contact/Address is read through the site door. Banking only supplies masked bank accounts for an explicitly resolved Party; absent/private contacts cannot acquire another Party's accounts by a label or email match."
  },
  {
    "label": "historical",
    "text": "The former answer to banking.contact-get is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive contact.get's Core contacts picker/get composition. Contact/Address is read through the site door. Banking only supplies masked bank accounts for an explicitly resolved Party; absent/private contacts cannot acquire another Party's accounts by a label or email match. Authority: cut.contacts; sites.crm; plugs.roles-follow-hats.",
  source: "The coordinator, round 2, m1-old-decisions; cut.contacts; sites.crm; plugs.roles-follow-hats",
  affects: [
    o.operation_contact_get,
    flow_client_account_address_book_get,
    rpc_banking_accounts_list_for_contact,
    rpc_contacts_book_get,
    rpc_contacts_book_list,
    d.table_bank_accounts,
  ],
});

export const decision_banking_payers_sign = defineDecision({
  id: "banking.payers-sign",
  title: "`bank pay --from` takes a budget's key, and an agent payer signs at once",
  question:
    "Banking now depends on approvals and budgets (shared dependencies.payers-sign-and-name-budgets). The designed " +
    "`bank pay --org acme --from office-costs` names the budget by key and prints its name; an Organization's payer may " +
    "be an agent Seat wearing the budget's hat. What does banking use them for?",
  options: [
    {
      label: "key-and-sign",
      text:
        "The quote resolves `from` through budgets' table (key to chain id and name; a chain id as it is) and answers the " +
        "budget in the view; the flow follows the sponsored approval (`approvals.signing.get`), and an agent signs its " +
        "digest with its own key and gives it to `approvals.signing.sign`; a person still approves on the page.",
    },
    { label: "page-only", text: "Keep chain ids and the approval page for every payer, as before the edge existed." },
  ],
  chosen: "key-and-sign",
  why:
    "The designed example takes the key and prints 'from Office costs' (P10 rung 1), and requests' `inbox pay` already " +
    "resolves `--from` the same way, so one key means one budget everywhere. A person's bank pay needs their own Bridge " +
    "verification, but an Organization's needs only the Organization's (KYB), so an agent wearing the budget's hat can " +
    "pay and, under A4, signs in the flow with its own key, as payroll's and requests' flows do. A declined approval ends " +
    "CANCELLED and an expired one WRONG_STATE (approvals.machine).",
  source: ASSEMBLY("bank.pay.yaml (designed: synopsis, example, who); shared dependencies.payers-sign-and-name-budgets; blueprint/requests/inbox.ts"),
  affects: [
    rpc_banking_payouts_quote,
    rpc_banking_payouts_get,
    flow_client_banking_payouts_pay,
    o.operation_bank_pay,
    table_budgets,
    rpc_approvals_signing_get,
    rpc_approvals_signing_sign,
    concept_approvals,
    concept_budgets,
    error_CANCELLED,
    error_WRONG_STATE,
  ],
});

export const decision_banking_payout_deadline = defineDecision({
  id: "banking.payout-deadline",
  title: "A payout's Payment cannot move after its quote; a changed account withdraws it",
  question:
    "Banking reported two holes: nothing stopped a payout's Payment landing, or being retried, after the quote's " +
    "deadline, and a changed bank account could not withdraw an unsigned approval. Payments now takes `not_after` and " +
    "an item with no document (payments.door-inputs) and leaves the withdrawal to the opener (payments.withdraw-by-opener). " +
    "What does banking do?",
  options: [
    {
      label: "cap-and-withdraw",
      text:
        "The quote passes `not_after` = the quote's `expires_at` and an item with a null document (its hash the " +
        "payout's digest, banking.payout-document-hash), and " +
        "keeps the approval's id on the payout; the payout's process, ending a quoted payout on its account's removal or " +
        "deactivation, invokes `approvals.withdraw` in that transaction. Answered `signed`, it stays quoted and follows its Payment.",
    },
    { label: "lapse", text: "Leave the payout `expired` and let Bridge refund a send that lands anyway." },
  ],
  chosen: "cap-and-withdraw",
  why:
    "bank.pay's WRONG_STATE says 'Nothing is sent' for both an expired quote and a changed account. With the deadline on " +
    "the command, the approval's window and any retry end at the quote's expiry; with the withdrawal, nobody can sign " +
    "after the account changed. Only an approval already signed can still land, which only the chain can end (K6): the " +
    "payout then follows its Payment, and Bridge delivers to the account it still holds. The withdrawal and the payout's " +
    "end are one fact (the payout ended and its unsigned carrier with it), which is `approvals.withdraw`'s own money fact (P4).",
  source: ASSEMBLY("bank.pay.yaml (refusal WRONG_STATE); blueprint/payments/decisions.ts (payments.door-inputs, payments.withdraw-by-opener); approvals.withdraw"),
  affects: [
    rpc_banking_payouts_quote,
    workflow_banking_payouts_follow,
    d.table_bank_payouts,
    d.machine_bank_payout.t.expire,
    procedure_payments_prepare_command,
    procedure_approvals_withdraw,
    o.operation_bank_pay,
  ],
});

export const decision_banking_verification_files = defineDecision({
  id: "banking.verification-files",
  title: "A verification admits only held identity documents of the right purpose",
  question:
    "Media admits each file for one purpose and leaves the check to its consumer (media.files: INVALID_INPUT, raised by " +
    "the consumer). Which files may `banking.verification.start` send to Bridge?",
  options: [
    {
      label: "purpose-and-held",
      text:
        "Each read at the caller's own key: `id_front` and `id_back` must be `id-image`; every other document field " +
        "`id-image` or `document`; each still `held`. Anything else is INVALID_INPUT naming the field.",
    },
    { label: "any-file", text: "Send whatever file id the SDK gives; Bridge refuses what it cannot use." },
  ],
  chosen: "purpose-and-held",
  why:
    "Bridge's ID fields need a photo (JPG or PNG) and its other fields take a PDF too, which are exactly media's two " +
    "document purposes. A `held` file is one whose bytes still exist (30 minutes after upload), so an expired one fails " +
    "here with the field named rather than at Bridge with a reason the person may not see. The caller's own key means a " +
    "file someone else uploaded names nothing.",
  source: ASSEMBLY("blueprint/media/data.ts (files: purposes, states); docs/decisions/assembly-items.md (media)"),
  affects: [rpc_banking_verification_start, table_files, error_INVALID_INPUT],
});

export const decision_banking_settle_reads_first = defineDecision({
  id: "banking.settle-reads-first",
  title: "`bank settle` reads the virtual account at Bridge before it writes",
  question:
    "Banking had rewritten `bank settle` #1 to #4 because Bridge had no read of one virtual account. The shared Bridge " +
    "record now has `readBankDetails`. Does settle use it, and which lines go back to their frozen words?",
  options: [
    {
      label: "read-first",
      text:
        "Read, then change only a different token: #1 ('reads Bridge before it writes') and #4 ('writes nothing to Bridge " +
        "when Bridge's answer is unusable') are kept word for word, observed by the trace; #2 and #3 stay rewritten.",
    },
    { label: "write-only", text: "Keep the single write and the four rewritten lines." },
  ],
  chosen: "read-first",
  why:
    "A frozen claim is rewritten only when a black box cannot see what it names (P1); the order of two outside calls is " +
    "visible to the trace observer, so the rewrite had stood only for want of the call. Reading first is also the " +
    "safer write: a token Bridge already has is no change, and an unusable read sends nothing. #2 and #3 still name a " +
    "queued event, which P7 replaces. The second call needs a 5 s p95, as `bank pay`'s two calls do.",
  source: ASSEMBLY("bank.settle.yaml acceptance #1-#4; blueprint/shared/external.ts (bridge.readBankDetails); P1; banking.budgets"),
  affects: [rpc_banking_details_settle, o.operation_bank_settle, integration_bridge],
});

// ── target assembly (builder) ───────────────────────────────────────────────────────────────

const BUILDER = (evidence: string) => `Claude, target assembly (builder), 8 November 2026; evidence: ${evidence}`;

export const decision_banking_payout_return_reference = defineDecision({
  id: "banking.payout-return-reference",
  title: "A payout's return fact references the payout's Payment",
  question:
    "Books' reclassify #3 needs a v4 row with money facts in two periods (books.straddling-row): a payout settled in one " +
    "month and returned in the next. Which reference does banking pass on the return's `payout_returned` fact?",
  options: [
    { label: "payment", text: "`{kind: payment, id: <the payout's Payment id>}`, keyed (`money_key`) by the return's Transfer as before." },
    { label: "movement", text: "`{kind: movement, id}`: the return's own Movement, as an outside Transfer into the Safe." },
  ],
  chosen: "payment",
  why:
    "Books groups a row's facts by their reference. With the payout's Payment as the reference, the settlement and the " +
    "return are one row's two money facts, the shape the old commitment had, so a return after the month's end straddles " +
    "it. The money key stays the Transfer, so payments' Movement of the same Transfer is still the same fact and is not " +
    "booked twice (books.money-key). The quote's other new inputs to `payments.prepare-command` are stated too: `pay_at` " +
    "null (a payout pays at once) and `resume` false (a payout never reopens a lapsed command; a new quote is a new payout).",
  source: BUILDER("blueprint/books/decisions.ts (books.straddling-row); blueprint/payments/decisions.ts (payments.door-inputs); org.books.accounts.reclassify.yaml #3"),
  affects: [workflow_banking_payouts_follow, rpc_banking_payouts_quote, procedure_payments_prepare_command],
});

export const decision_banking_invite_accept_declined = defineDecision({
  id: "banking.invite-accept-declined",
  title: "Declining an invitation's offer at the terminal ends CANCELLED",
  question: "`invite accept` at a terminal shows the offer and uses its digest. What does a 'no' to it end with?",
  options: [
    { label: "cancelled", text: "CANCELLED, from the flow's `digest` prompt, which lists it in its `errors`; nothing is accepted." },
    { label: "usage", text: "CLI_USAGE, as a missing `--offer-digest` in a script is." },
  ],
  chosen: "cancelled",
  why:
    "vocabulary.declined-preview-cancelled: a 'no' is the person's choice, not a usage mistake. A script still passes " +
    "`--offer-digest` and `--confirm` and never sees the question; the invitation stays pending for a later accept or decline.",
  source: BUILDER("blueprint/shared/decisions.ts (vocabulary.declined-preview-cancelled); frozen invite.accept notes"),
  affects: [flow_client_org_invitations_accept, o.operation_invite_accept, error_CANCELLED],
});

// ── assembly after the Frappe redesign (8 November 2026): what accounting and the CRM asked ─────

const FRAPPE = (evidence: string) => `Claude, assembly after the Frappe redesign (money), 8 November 2026; evidence: ${evidence}`;

export const decision_banking_payout_books = defineDecision({
  id: "banking.payout-books",
  title: "Banking's money sides carry their fee, log, Safe and Party; a payout its payee",
  question:
    "Books' vouchers need a rail's fee, the log index, the Safe and the counterparty's Party on every side, and a bank " +
    "payout's voucher needs the real payee, not Bridge's deposit address that the chain shows. Which does banking pass, " +
    "and how does a payout's reach books, since payments writes its fact?",
  options: [
    {
      label: "through-the-door",
      text:
        "The payout's item to `payments.prepare-command` carries `fee_raw` (the quote's `fee_amount`, in the token's " +
        "units) and, for a contact's account, `against` with the contact's Party as Supplier; payments keeps both on the " +
        "Payment from its birth and passes them at settlement. Banking's own facts (a deposit's credit, a payout's return) " +
        "carry the Safe, the Transfer's log index and the sender's Party when the directory has one; a deposit's " +
        "`fee_raw` is the gross less the net in the token's units when the token is the currency's own.",
    },
    { label: "annotate-later", text: "Leave the payout's fact unclassified and let a person or a head annotate it." },
  ],
  chosen: "through-the-door",
  why:
    "The payout and its Payment are one money fact (dependencies.payments-banking), so what the books post it against is known at the quote and belongs on the Payment from its birth (payments.money-sides); a later annotation would leave every payout in review. The fee is Bridge's number on the quote: neither payments nor books computes one. A contact's account names its Party (`bank-accounts.party_id`), which Frappe makes a Supplier; a payout to your own account (`self`) or to a payee known only by name has no party, and `bank pay --account` names a saved bank account, not a ledger account, so no account is chosen: books posts the payout to its not-decided account with the fee on bank charges until someone annotates it. A deposit's fee is only meaningful where the bank currency and the token are one (USD and USDC, EUR and EURC); across a conversion the rate is Bridge's and the fee is left out. The return references the payout's Payment (banking.payout-return-reference), so it nets against the same party and account. Review, 11 November 2026: Confirmed banking.payout-books; original choice retained.",
  source: FRAPPE("docs/design/frappe/accounting.md (For other lanes: banking); blueprint/books/procedures.ts (MoneySide)"),
  affects: [
    rpc_banking_payouts_quote,
    workflow_banking_payouts_follow,
    workflow_banking_deposits_credit,
    procedure_payments_prepare_command,
    d.table_bank_payouts,
    d.table_bank_deposits,
  ],
});

export const decision_banking_private_entries = defineDecision({
  id: "banking.private-entries",
  title: "A private contact has no bank accounts: contact get shows none, bank pay refuses",
  question:
    "The CRM's book now holds private entries (a company not on Capxul, a person with no mailbox) whose `ref` is null, and `contacts.book.get` takes `{ book, contactId }`. Bank accounts are saved on a contact's Party. What do `contact get`, `contact bank add` and `bank pay` do with such an entry?",
  options: [
  {
    "label": "current-scope",
    "text": "A site-only contact with no resolved Party has no Core saved bank accounts and cannot be paid through a fabricated Party. Refuse before any quote or write and require explicit recipient resolution. Archive contact_<id>/ref shapes and removed contact link instructions."
  },
  {
    "label": "historical",
    "text": "The former answer to banking.private-entries is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: A site-only contact with no resolved Party has no Core saved bank accounts and cannot be paid through a fabricated Party. Refuse before any quote or write and require explicit recipient resolution. Archive contact_<id>/ref shapes and removed contact link instructions. Authority: cut.contacts; sites.crm; plugs.roles-follow-hats.",
  source: "The coordinator, round 2, m1-old-decisions; cut.contacts; sites.crm; plugs.roles-follow-hats",
  affects: [
    flow_client_account_address_book_get,
    flow_client_account_bank_accounts_add,
    flow_client_banking_payouts_pay,
    o.operation_contact_get,
    o.operation_bank_pay,
    o.operation_contact_bank_add,
    rpc_contacts_book_get,
  ],
});

export const decision_banking_payout_document_hash = defineDecision({
  id: "banking.payout-document-hash",
  title: "A payout's Payment carries its payout's digest as the document hash",
  question:
    "A payout's item to `payments.prepare-command` had no document and the zero hash (payments.door-inputs). v4 " +
    "refuses the zero hash in every call that pays: `Payments.send` (`ZeroDocumentHash`), `Budgets.spend` and " +
    "`Budgets.schedule`, and `Escrow`'s constructor. So every bank payout would revert at sponsorship. What hash does " +
    "a payout's Payment carry?",
  options: [
    {
      label: "payout-digest",
      text:
        "The keccak-256 of the payout's id (`payout_id`, derived from the owner and request key), with `document_id` " +
        "null: fixed at the quote, the same on a repeat, unique to the payout, never zero, and naming no stored " +
        "document. The door refuses the zero hash with INVALID_INPUT, so no other invoker can build a call v4 reverts.",
    },
    { label: "store-document", text: "Make banking depend on documents and store a payout instruction document, as the old payments' instruction did." },
    { label: "bridge-transfer", text: "The keccak-256 of Bridge's transfer id." },
  ],
  chosen: "payout-digest",
  why:
    "The old system never sent a zero hash: every old payment command carried an instruction document's hash. The " +
    "payout's id exists before Bridge answers and before the Payment is born, so the payment id is still fixed before " +
    "anyone signs (K1) and a repeat under the same request key derives the same hash and the same id. Bridge's " +
    "transfer id would also do, but it arrives from an outside call and a failed create leaves none. A stored document " +
    "would be one nobody reads (payments.door-inputs rejected that edge). No reader resolves the hash: the Payment's " +
    "`document_id` is null, so activity and documents show no document for it.",
  source: FRAPPE(
    "packages/contracts/v4/src/money/Payments.sol:56, Budgets.sol:223 and :254, Escrow.sol:65 (ZeroDocumentHash); packages/backend/src/payments/commands/writes/items.ts:159",
  ),
  affects: [rpc_banking_payouts_quote, procedure_payments_prepare_command, d.table_bank_payouts],
});

const BUILD = (evidence: string) => `Claude, Frappe assembly (build), 8 November 2026; evidence: ${evidence}`;

export const decision_banking_matched_deposit_meaning = defineDecision({
  id: "banking.matched-deposit-meaning",
  title: "A matched deposit's row waits in review; the match names the request",
  question:
    "A paid request now carries its income account (requests.income-meaning), and a payment from the inbox passes it to " +
    "books at settlement. A bank deposit is booked when Bridge credits it, before anyone matches it to a request. Should " +
    "`bank match` carry the request's meaning to the deposit's row?",
  options: [
    {
      label: "review",
      text:
        "No meaning moves at the match: the deposit's row keeps the annotation it had, or waits in 4999, and the match " +
        "(`banking.match-deposit`) names the request on the deposit, so the review queue shows which request it paid " +
        "and the Books hat or a head classifies it with `activity annotate`.",
    },
    {
      label: "annotate-door",
      text: "A books door that sets a standing row's annotation, invoked by the match from the request's `income`.",
    },
  ],
  chosen: "review",
  why:
    "The deposit's book fact is written when the money arrives (its money fact, banking.payout-books); by the match it stands, and books' door writes nothing for a key it already holds, so carrying the meaning would need a new procedure that edits an annotation. That is a classification, not a money fact (rules.procedures): nothing about the money changes if it lags, and books' own `activity annotate` already does it with the right hat's check. The match keeps the money fact it is for, the deposit and the request it paid. Revisit if Organizations match many deposits and classifying them by hand proves heavy. Review, 11 November 2026: Confirmed banking.matched-deposit-meaning; original choice retained.",
  source: BUILD("blueprint/requests/decisions.ts (requests.income-meaning: 'banking.match-deposit takes no meaning yet'); blueprint/books/procedures.ts (record-money-fact replays write nothing)"),
  affects: [procedure_banking_match_deposit],
});
