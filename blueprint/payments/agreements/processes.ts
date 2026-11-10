// Payroll's durable work: one process per agreement (A3, rules.durable-processes), which owns the
// agreement's status and its writes' outcomes from the moment the offer is prepared until nothing
// more can happen to it. It follows the agreement's chain events from Ponder (indexing), the outcome
// of each write's approval or Board proposal, and its own timers. No cron: the old daily sweep's
// payroll part (lapsed offers, ended agreements) is this process's timers; its emails are notices'.

import { budget, defineWorkflow } from "../../../packages/blueprint-engine/src/index.ts";
import { concept_payments } from "../../shared/foundation.ts";
import { contract_agreements, integration_chain_rpc, integration_indexer } from "../../shared/external.ts";
import { procedure_approvals_withdraw } from "../../approvals/procedures.ts";
import { table_approvals } from "../../approvals/data.ts";
import { table_board_proposals } from "../../board/data.ts";
import {
  machine_agreement,
  machine_agreement_write,
  table_agreement_writes,
  table_agreements,
} from "./data.ts";
import { table_parties } from "../../parties/data.ts";
import { procedure_parties_resolve_recipient } from "../../parties/procedures.ts";
import { procedure_documents_store } from "../../documents/procedures.ts";
import { table_budgets } from "../../budgets/data.ts";
import {
  machine_org_setup,
  table_org_deployments,
  table_org_members,
  table_organizations,
} from "../../organizations/data.ts";
import { table_hat_wearers } from "../../indexing/data.ts";
import {
  rpc_payroll_holders_change,
  rpc_payroll_holders_end,
  rpc_payroll_holders_pause,
  rpc_payroll_holders_resume,
  rpc_payroll_holders_withdraw,
} from "./holders.ts";
import { rpc_payroll_payees_accept, rpc_payroll_payees_collect } from "./payees.ts";
import { event_approval_transitioned } from "../../approvals/data.ts";
import { event_proposal_transitioned } from "../../board/data.ts";

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
    "last day paid) ends an accepted agreement. (4) Frappe HR's side is no longer written here (cut.payroll): hiring a payee as an Employee, assigning the agreement" +
    " structure and recording a paid slip are Frappe HR's, and a plug that posts agreement events to Frappe HR carries them (stage 3). " +
    "It ends when the agreement is lapsed, withdrawn or abandoned and no write " +
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
  concept: concept_payments,
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
        "A landed collection to a person records one paid salary slip (salary-slip.record_collection: window, amount as " +
        "its one earning, payment id, tx, block time, terms document) and in that transaction its accrual " +
        "(books.record-payroll-accrual, action collection: block time, the component's accounts).",
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
  ],
  writes: [
    table_agreements,
    table_agreement_writes,
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
  ],
  invokes: [procedure_approvals_withdraw],
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
    "None: it writes only payroll's own rows and, through books' door, a collection slip's accrual, from chain facts read " +
    "at the finality depth, which Capxul never undoes. A step " +
    "that fails after its retries leaves the agreement where the last committed step put it, and the step runs again on resume.",
  budget: budget("chain-settle"),
});

// ── the start-up ────────────────────────────────────────────────────────────────────────────

// ── the head sync ───────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

