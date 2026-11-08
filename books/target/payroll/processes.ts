// Payroll's durable work: one process per agreement (A3, rules.durable-processes), which owns the
// agreement's status and its writes' outcomes from the moment the offer is prepared until nothing
// more can happen to it. It follows the agreement's chain events from Ponder (indexing), the outcome
// of each write's approval or Board proposal, and its own timers. No cron: the old daily sweep's
// payroll part (lapsed offers, ended agreements) is this process's timers; its emails are notices'.

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_payroll } from "../shared/foundation.ts";
import { contract_agreements, integration_chain_rpc, integration_frappe_head, integration_indexer } from "../shared/external.ts";
import { procedure_approvals_withdraw } from "../approvals/procedures.ts";
import { table_approvals } from "../approvals/data.ts";
import { table_board_proposals } from "../board/data.ts";
import {
  machine_agreement,
  machine_agreement_write,
  machine_employee,
  machine_salary_slip,
  machine_salary_structure,
  machine_salary_structure_assignment,
  machine_payroll_entry,
  table_agreement_writes,
  table_agreements,
  table_employees,
  table_payroll_changes,
  table_payroll_entries,
  table_payroll_head_syncs,
  table_payroll_settings,
  table_salary_components,
  table_salary_slips,
  table_salary_structure_assignments,
  table_salary_structures,
} from "./data.ts";
import { table_parties } from "../parties/data.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import { procedure_documents_store } from "../documents/procedures.ts";
import { procedure_books_record_payroll_accrual } from "../books/procedures.ts";
import { table_budgets } from "../budgets/data.ts";
import {
  event_org_head_transitioned,
  machine_org_head,
  machine_org_setup,
  table_org_deployments,
  table_org_heads,
  table_org_members,
  table_organizations,
} from "../organizations/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import { LOGGED } from "./employees.ts";
import {
  rpc_payroll_holders_change,
  rpc_payroll_holders_end,
  rpc_payroll_holders_pause,
  rpc_payroll_holders_resume,
  rpc_payroll_holders_withdraw,
} from "./holders.ts";
import { rpc_payroll_payees_accept, rpc_payroll_payees_collect } from "./payees.ts";
import { event_approval_transitioned } from "../approvals/data.ts";
import { event_proposal_transitioned } from "../board/data.ts";

const AG = "packages/backend/src/payroll/agreements";

const a = machine_agreement.t;
const w = machine_agreement_write.t;

export const workflow_payroll_agreements_lifecycle = defineWorkflow({
  id: "payroll.agreements.lifecycle",
  title: "One agreement's process, from its prepared offer to its end",
  about:
    "Started by the agreement's birth (agreement.prepare, through the outbox), one instance per agreement. It is the only " +
    "writer of the agreement's status after its birth and of its writes' outcomes. The write rpcs signal it when they " +
    "open a write. It reacts to three things. (1) Agreements' events for this agreement, indexed by Ponder at the " +
    "deployment's finality depth: each moves the status as the agreement machine says, once. (2) The end of each awaiting " +
    "write's approval or Board proposal, which approvals and board announce through the outbox: it reads the indexed " +
    "facts of that transaction (`factsOf`) and lands the write when they hold its own event for this agreement, in the " +
    "same transaction as the status move that event makes; it fails it when the operation reverted or the transaction ran " +
    "without its event (another write beat it), or the proposal ended `failed`; it abandons it when the approval was refused, declined, displaced, " +
    "withdrawn or expired unsent, or the proposal was rejected or replaced. A prepared offer whose write did not land is " +
    "abandoned with it. (3) Its timers, by the chain's clock: the offer's expiry lapses an offer nobody accepted or withdrew, and the end (00:00 UTC after the " +
    "last day paid) ends an accepted agreement. (4) Frappe HR's side (payroll.agreements-in-frappe-shape): an acceptance " +
    "hires a person payee as an Employee if need be and assigns the agreement structure on the rate, a landed rate " +
    "change assigns it anew from its date, a landed collection records its paid slip, and the end lets go an Employee " +
    "nothing else pays. It ends when the agreement is lapsed, withdrawn or abandoned and no write " +
    "awaits, or, once ended, when a landed collection leaves nothing collectable. `timeoutMs` bounds each step; its waits " +
    "are durable and have no deadline. It replaces old payroll's settle-on-read (settledContext), its sent-write settling " +
    "actions and the payroll half of the daily sweep.",
  was: [
    `${AG}/writes/records.ts:240`,
    `${AG}/writes/payees.ts:207`,
    `${AG}/writes/organization-payees.ts:82`,
    `${AG}/operations/settle.ts`,
    `${AG}/operations/settle-payee.ts`,
    `${AG}/operations/sweep.ts:44`,
    `${AG}/rules.ts:64`,
  ],
  concept: concept_payroll,
  priority: "normal",
  trigger: { transition: a.prepare },
  instance: { per: table_agreements },
  signals: [
    rpc_payroll_holders_withdraw,
    rpc_payroll_holders_change,
    rpc_payroll_holders_pause,
    rpc_payroll_holders_resume,
    rpc_payroll_holders_end,
    rpc_payroll_payees_accept,
    rpc_payroll_payees_collect,
  ],
  waits: [
    {
      name: "agreement-events",
      for: "chain",
      key: [
        { on: [contract_agreements.e.AgreementOffered], props: ["chain_id", "documentHash"] },
        {
          on: [
            contract_agreements.e.AgreementAccepted,
            contract_agreements.e.OfferWithdrawn,
            contract_agreements.e.RateChanged,
            contract_agreements.e.RateChangeCancelled,
            contract_agreements.e.AgreementPaused,
            contract_agreements.e.AgreementResumed,
            contract_agreements.e.AgreementEnded,
            contract_agreements.e.Collected,
          ],
          props: ["chain_id", "safe", "id"],
        },
      ],
      about:
        "AgreementOffered with the offer's terms hash, then every AgreementAccepted, OfferWithdrawn, RateChanged, " +
        "RateChangeCancelled, AgreementPaused, AgreementResumed, AgreementEnded and Collected for its Safe and id.",
    },
    {
      name: "write-outcome",
      for: "signal",
      key: [{ on: [event_approval_transitioned, event_proposal_transitioned], props: ["opener", "subject_kind", "subject_id"] }],
      about:
        "The end of an awaiting write's approval (approval_transitioned with opener payroll and the write as its subject) or " +
        "Board proposal (proposal_transitioned: execute, fail, reject or replace), delivered by the outbox.",
    },
    { name: "offer-expiry", for: "timer", about: "offer_expires_at, while the offer waits for its payee." },
    { name: "end", for: "timer", about: "ends_at, once an accepted agreement has an end: a fixed term's own or a holder's." },
  ],
  steps: [
    { name: "follow-offer", about: "Waits for the offer write's outcome: landed with AgreementOffered, agreement.offer records the uint256 id; else agreement.abandon." },
    { name: "wait-for-payee", about: "While offered: AgreementAccepted is agreement.accept, OfferWithdrawn agreement.withdraw, and the expiry timer with neither agreement.lapse." },
    {
      name: "follow-chain",
      about:
        "AgreementPaused is pause; AgreementResumed resume, or resume_ending when a holder's end is ahead; AgreementEnded is " +
        "set_end on a running agreement, else it only moves ends_at. RateChanged, RateChangeCancelled and Collected move no status.",
    },
    {
      name: "decide-write",
      about:
        "A landed approval's transaction, or an executed proposal's (board-proposals' execution_tx_hash): awaitBlock, then " +
        "factsOf. Its own event lands it (with a collection's PaymentSent id); none, a revert or a failed proposal fails it; an unsent end abandons it.",
    },
    { name: "end-timer", about: "Sets its timer to ends_at whenever an end is set or moved earlier; at it, agreement.finish." },
    {
      name: "withdraw-carriers",
      about:
        "When the agreement reaches lapsed, withdrawn or abandoned, each awaiting write but a collection has its unsigned " +
        "approval withdrawn (approvals.withdraw) and is abandoned; a signed one is left for the chain to end.",
    },
    {
      name: "hire-and-assign",
      about:
        "After agreement.accept commits, for a person payee: their live Employee, or one hired at the block's day " +
        "(payroll.one-live-employee); the agreement component and structure at the first acceptance; an assignment from " +
        "the start on the rate.",
    },
    { name: "reassign", about: "A landed RateChanged assigns the agreement structure anew from its effective day, on the new rate." },
    {
      name: "record-collection",
      about:
        "A landed collection to a person records one paid salary slip (salary-slip.record_collection: its window, the " +
        "amount as its one earning, its payment id, tx, block time and terms document) and, in that transaction, its " +
        "accrual (books.record-payroll-accrual, action collection).",
    },
    {
      name: "let-go",
      about:
        "At agreement.finish: the Employee leaves on the last day paid when nothing else pays them and the leave guard " +
        "allows it; else they stay, for a People hat wearer to let go.",
    },
    { name: "close", about: "Ends the instance once nothing more can happen; an ended agreement's last collection is read with availableOf." },
  ],
  reads: [
    table_agreements,
    table_agreement_writes,
    table_approvals,
    table_board_proposals,
    table_parties,
    table_employees,
    table_salary_components,
    table_salary_structures,
    table_salary_structure_assignments,
    table_salary_slips,
  ],
  writes: [
    table_agreements,
    table_agreement_writes,
    table_employees,
    table_salary_components,
    table_salary_structures,
    table_salary_structure_assignments,
    table_salary_slips,
    ...LOGGED,
  ],
  drives: [
    a.offer,
    a.abandon,
    a.accept,
    a.withdraw,
    a.lapse,
    a.pause,
    a.resume,
    a.resume_ending,
    a.set_end,
    a.finish,
    w.land,
    w.fail,
    w.abandon,
    machine_employee.t.hire,
    machine_employee.t.leave,
    machine_salary_structure.t.submit,
    machine_salary_structure_assignment.t.submit,
    machine_salary_slip.t.record_collection,
  ],
  invokes: [procedure_approvals_withdraw, procedure_books_record_payroll_accrual],
  emits: [],
  calls: [
    integration_indexer.c.awaitBlock,
    integration_indexer.c.factsOf,
    integration_chain_rpc.c.getBlock,
    integration_chain_rpc.c.readContract,
  ],
  chain: [contract_agreements.f.availableOf],
  idempotency:
    "One agreement_id per instance. Each Agreements event applies once, by its log (block hash, log index); each write " +
    "is decided once, by write_id, and makes at most one slip (by_write); a timer fires once per agreement and date; a " +
    "status the machine has left is not entered again.",
  timeoutMs: 120_000,
  retries: { max: 5, backoff: "exponential" },
  compensation:
    "None: it writes only payroll's own rows, from chain facts read at the finality depth, which Capxul never undoes. A step " +
    "that fails after its retries leaves the agreement where the last committed step put it, and the step runs again on resume.",
  budget: budget("chain-settle"),
});

// ── the start-up ────────────────────────────────────────────────────────────────────────────

export const workflow_payroll_startup_open = defineWorkflow({
  id: "payroll.startup.open",
  title: "Start the Organization's payroll: its Payroll Settings",
  about:
    "Started by an Organization setup's `begin`, through the outbox: payroll is a fundamental app, in Frappe HR's shape " +
    "from the first day whether or not a head is ever connected (aaron.frappe-shape, payroll.startup). In one " +
    "transaction it writes the Organization's Payroll Settings, as Frappe HR's install sets that single's defaults " +
    "(`set_single_defaults`), with the values Capxul computes by and a head must match (leave-based, holidays counted " +
    "as working days, no rounded total, no Frappe email) and the change counter at zero, so every payroll write finds " +
    "its lock row. It makes no salary component: Frappe HR installs none, and a business's pay is its own to define; " +
    "the agreement component is made at the first acceptance. It cannot be a step of `begin`, which is organizations' " +
    "and may not write another concept's tables.",
  concept: concept_payroll,
  priority: "normal",
  trigger: { transition: machine_org_setup.t.begin },
  steps: [{ name: "settings", about: "Write the Payroll Settings with last_seq zero, unless the Organization already has them." }],
  reads: [table_payroll_settings],
  writes: [table_payroll_settings],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "One run per Organization (`payroll-startup:<orgId>`): a second finds the settings row and writes nothing.",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
  was: ["/tmp/hrms/hrms/setup.py:606", "/tmp/hrms/hrms/payroll/doctype/payroll_settings/payroll_settings.json"],
});

// ── the head sync ───────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const e = machine_payroll_entry.t;
const s = machine_salary_slip.t;
const SYNCED = [
  table_employees,
  table_salary_components,
  table_salary_structures,
  table_salary_structure_assignments,
  table_payroll_entries,
  table_salary_slips,
];

export const workflow_payroll_head_sync = defineWorkflow({
  id: "payroll.head.sync",
  title: "Sync the Organization's payroll with its connected head",
  about:
    "Started when a head connection is confirmed, one instance per connection, for as long as the head is connected " +
    "(payroll.head-sync). The head never writes into Capxul: it rings, and this process calls it with Capxul's key " +
    "(organizations.head-doorbell). Push: it pages `payroll-changes` after `pushed_seq` and writes each changed record " +
    "as it stands (`upsertDocs`, in seq order, by `capxul_id`, with its version): Employees, components, submitted " +
    "structures and assignments, a submitted Payroll Entry Capxul computed (never a draft), each slip's payment facts " +
    "(`capxul_status`, payment id, transaction, block time), and an agreement's Employee, assignment and collection " +
    "slips, read-only there. For a Capxul run the head's Capxul app lets Frappe HR make its own draft slips, compares " +
    "them to the cent and submits each alone only when they agree, never through Submit Salary Slip, which would post " +
    "a second accrual (payroll.one-computer-per-run). Pull: it reads the head's changes after `pulled_change` " +
    "(`listChanges`) and applies each as the head's user, a member matched by mailbox whose Safe wears the People hat, " +
    "through payroll's own checks: an Employee born there is hired from its `personal_email` through " +
    "`parties.resolve-recipient`; edits to shared fields apply; a component, structure or assignment born there is " +
    "born here; a Salary Withholding withholds or releases; a Payroll Entry the head submitted is taken in by " +
    "payroll.import-run; a head run's cancel cancels it here while nothing of it is paid. Money and identity are " +
    "Capxul's (organizations.head-ownership): a head change to a Party, Safe, pay mailbox, budget, a Capxul run's " +
    "figures, a payment fact or an agreement's records is refused and Capxul's version pushed back, as is a change on " +
    "an older version, by a user without the People hat, or one the checks refuse. It wakes on a change here, a ring, " +
    "and daily; while the head is failing it waits; it ends when the head is disconnected.",
  concept: concept_payroll,
  priority: "normal",
  trigger: { transition: machine_org_head.t.confirm },
  instance: { per: table_payroll_head_syncs },
  waits: [
    {
      name: "capxul-change",
      for: "signal",
      key: [{ on: [table_payroll_changes], props: ["org_id"] }],
      about: "A payroll record changed here: push it.",
    },
    {
      name: "ring",
      for: "signal",
      key: [{ on: [table_org_heads], props: ["org_id", "head_id"] }],
      about: "The head rang its doorbell (organizations.heads.ring stamped the connection): pull its changes.",
    },
    { name: "catch-up", for: "timer", timeoutMs: DAY, about: "A day after the last pull: pull, in case a ring was lost." },
    {
      name: "disconnected",
      for: "signal",
      key: [{ on: [event_org_head_transitioned], props: ["org_id", "head_id"] }],
      about: "The head stopped failing, started failing, or was disconnected: carry on, wait, or end.",
    },
  ],
  steps: [
    { name: "push", about: "Page payroll-changes after pushed_seq; upsertDocs in seq order, drafts left out; record the head's names; advance pushed_seq." },
    {
      name: "pull",
      about:
        "listChanges after pulled_change; apply each through payroll's checks (a head-born Employee's Party from its " +
        "`personal_email`, never `company_email`), or push back a conflict or a refusal; advance pulled_change.",
    },
    { name: "import", about: "A Payroll Entry the head submitted: take it in with its slips and payslips by payroll.import-run, once by its head name." },
    { name: "await", about: "Wait for a change here, a ring, the daily catch-up or the connection's next transition." },
  ],
  reads: [
    table_org_heads,
    table_organizations,
    table_org_members,
    table_org_deployments,
    table_hat_wearers,
    table_parties,
    table_budgets,
    table_payroll_head_syncs,
    ...LOGGED,
    ...SYNCED,
  ],
  writes: [table_payroll_head_syncs, ...LOGGED, ...SYNCED],
  drives: [
    machine_employee.t.hire,
    machine_employee.t.suspend,
    machine_employee.t.deactivate,
    machine_employee.t.reinstate,
    machine_employee.t.leave,
    machine_salary_structure.t.submit,
    machine_salary_structure.t.cancel,
    machine_salary_structure_assignment.t.submit,
    machine_salary_structure_assignment.t.cancel,
    e.import,
    e.cancel,
    s.import,
    s.import_withheld,
    s.withhold,
    s.release,
    s.cancel,
  ],
  invokes: [procedure_parties_resolve_recipient, procedure_documents_store],
  emits: [],
  calls: [integration_frappe_head.c.upsertDocs, integration_frappe_head.c.listChanges],
  chain: [],
  idempotency:
    "One process per head connection (`payroll-head:<orgId>:<headId>`). A push is idempotent by version (the head " +
    "answers unchanged); a pulled change already applied is skipped by its head name and time; a head's Payroll Entry " +
    "is taken in once, by its unique head name.",
  timeoutMs: 3650 * DAY,
  retries: { max: 8, backoff: "exponential" },
  budget: budget("background"),
});
