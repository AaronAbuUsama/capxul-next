// The plugs' durable processes: the hat projection, the nightly drift check, the delivery of the outbox to a site, and the two that
// follow a held payment (landed by the chain, failed by a revert). Each writes only plugs' own tables; the site is reached through the
// `frappe-site` integration, never inside a transaction.

import { budget, defineWorkflow } from "../../packages/blueprint-engine/src/index.ts";
import { concept_plugs } from "../shared/foundation.ts";
import { contract_erc20, contract_hats, contract_payments } from "../shared/external.ts";
import { table_chain_payments, table_hat_wearers, table_transfers } from "../indexing/data.ts";
import { machine_approval } from "../approvals/data.ts";
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { integration_frappe_site } from "./integrations.ts";
import { procedure_plugs_payments_hold } from "./signer.ts";
import {
  machine_payment_request, machine_role_grant, machine_site_event, table_hat_role_map, table_payment_requests, table_role_grants, table_site_cursors,
  table_site_events, table_site_request_cursors, table_site_users,
} from "./data.ts";

const SPIKE = "spikes/skeleton/FINDINGS.md";

export const workflow_plugs_roles_project = defineWorkflow({
  id: "plugs.roles.project",
  title: "Turn a hat granted or revoked on chain into a person's Frappe roles",
  about:
    "Triggered by each indexed Hats transfer (a mint is a grant, a transfer or burn away from a wearer a revoke). It reads the facts at the finality depth, resolves the " +
    "wearer's Safe to a member and the hat to a name and department from the Organization's deployment, makes the person's site user if none exists (a hat is the only thing that " +
    "makes one: sign-up is denied), records the grant (`record`, or `revoke` and `retire`) with the roles the map gives that hat under its version, and enqueues the `hat_granted` or " +
    "`hat_revoked` event, so the roles reach the site in order with every other event. A role two hats give is removed only when no live grant gives it. A replayed log changes nothing: " +
    "the grant is unique by its log. Measured on the spike: a grant mined to roles present in 54 to 307 ms, a revoke to roles gone in 467 to 478 ms (FINDINGS, Measured).",
  concept: concept_plugs,
  priority: "critical",
  trigger: { chainEvent: contract_hats.e.TransferSingle },
  steps: [
    { name: "facts", about: "Reads the transfer's facts at the finality depth; a transfer that touches no Capxul Safe ends the run." },
    { name: "person", about: "Resolves the wearer's Safe to the member and makes the site user if the hat is the first." },
    { name: "grant", about: "Records or revokes the grant with the roles the map gives, under the map's version." },
    { name: "enqueue", about: "Adds the hat event to the Organization's outbox with the next number." },
  ],
  reads: [table_hat_wearers, table_org_members, table_org_deployments, table_hat_role_map, table_role_grants, table_site_users, table_site_events, table_site_cursors],
  writes: [table_role_grants, table_site_users, table_site_events, table_site_cursors],
  drives: [machine_role_grant.t.record, machine_role_grant.t.revoke, machine_role_grant.t.retire, machine_site_event.t.enqueue],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "The unique (org, chain tx hash, log index) index on role-grants: a replayed log records nothing.",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
  was: [`${SPIKE} (Frappe half: Roles follow hats)`],
});

export const workflow_plugs_roles_drift_check = defineWorkflow({
  id: "plugs.roles.drift-check",
  title: "Each night compare every site's roles with the chain's hats",
  about:
    "The only backstop against the bypasses the spike could not lock: raw SQL, the bench console, `ignore_validate`, a patch, a Server Script (FINDINGS, Frappe half: Cannot be locked). For each " +
    "site it reads the site and the chain and, where the chain says a role should be there or not, enqueues the repair as a hat event; a difference the chain does not explain (a user with no hat) " +
    "is reported to the Organization's Director with the Administrator's use log (plugs.administrator). It runs at 03:00 on the world's clock.",
  concept: concept_plugs,
  priority: "normal",
  trigger: { cron: "0 3 * * *" },
  instance: "singleton",
  steps: [
    { name: "read", about: "Reads each site's users and roles, and the chain's wearers." },
    { name: "compare", about: "Lists extra roles, missing roles, users without a hat and hats without a user." },
    { name: "repair", about: "Enqueues a hat event for every difference the chain explains." },
  ],
  reads: [table_role_grants, table_site_users, table_hat_role_map, table_hat_wearers, table_org_deployments, table_site_events, table_site_cursors],
  writes: [table_site_events, table_site_cursors],
  drives: [machine_site_event.t.enqueue],
  invokes: [],
  emits: [],
  calls: [integration_frappe_site.c.readSite],
  chain: [],
  idempotency: "One run per world day: the repair events are keyed by the grant and the day.",
  timeoutMs: 600_000,
  retries: { max: 2, backoff: "fixed" },
  budget: budget("background"),
  was: [`${SPIKE} (What the design must now decide, 5 and 6)`],
});

export const workflow_plugs_events_deliver = defineWorkflow({
  id: "plugs.events.deliver",
  title: "Deliver an Organization's outbox to its site, in order, until it is applied",
  about:
    "One process per Organization, woken by each enqueued event. It offers the oldest pending event to the site (`applyEvent`). Applied or already applied: the event moves to applied and the " +
    "cursor on (a hat event also applies, fails or revokes its role grant). A 409 names the number the site expects: the cursor moves to it, even backwards, and delivery resumes in order. " +
    "A failure is retried with backoff, three times. Then a non-money event is set aside and the cursor moves on; a money event is posted to the site's books as an unmatched bank line " +
    "with an alert, so one event that can never be applied never blocks the stream and never loses a payment (plugs.poison-event). With the site down it just retries: nothing is lost, " +
    "because Core keeps every event. Measured: with Frappe stopped, a held payment posted 2.0 to 3.8 s after the stack answered (FINDINGS, Measured).",
  concept: concept_plugs,
  priority: "critical",
  trigger: { transition: machine_site_event.t.enqueue },
  instance: { per: table_site_cursors },
  steps: [
    { name: "next", about: "Reads the oldest pending event at or after the cursor." },
    { name: "apply", about: "Calls the site's applyEvent and reads its answer." },
    { name: "settle", about: "Moves the event and the cursor, or retries, sets aside or posts it unmatched." },
    { name: "grant", about: "For a hat event, applies, fails or revokes the role grant by the answer." },
  ],
  reads: [table_site_events, table_site_cursors, table_role_grants],
  writes: [table_site_events, table_site_cursors, table_role_grants],
  drives: [
    machine_site_event.t.apply, machine_site_event.t.retry, machine_site_event.t.set_aside, machine_site_event.t.post_unmatched,
    machine_role_grant.t.apply, machine_role_grant.t.fail,
  ],
  invokes: [],
  emits: [],
  calls: [integration_frappe_site.c.applyEvent],
  chain: [],
  idempotency: "The site answers a repeated event key as already applied, and a transition already made is not made twice.",
  timeoutMs: 120_000,
  retries: { max: 3, backoff: "exponential" },
  compensation: "A non-money event the site cannot apply is set aside; a money event posts as an unmatched bank line and alerts. Neither stops the stream.",
  budget: budget("background"),
  was: [`${SPIKE} (Core half: the outbox; Frappe half: Parked)`],
});

export const workflow_plugs_payments_settle = defineWorkflow({
  id: "plugs.payments.settle",
  title: "Land a held payment when the chain's PaymentSent carries its hash",
  about:
    "Triggered by each indexed PaymentSent. A request waiting with the same document hash lands (`land`) and the `payment_sent` event, carrying the transaction hash, the signer and the hash, is enqueued so " +
    "the site submits the Payment Entry, posts the ledger and shows nothing outstanding. A PaymentSent for a request's payee and amount with a different hash means the draft changed after the " +
    "prepare: the request is a mismatch. A PaymentSent no request names (made on the chain with no Frappe document) is enqueued all the same, and the site books it as an unmatched bank line. " +
    "The event names the signer (the transaction's sender), which the stand-in contracts' PaymentSent did not (FINDINGS, Core half: PaymentSent carries no signer; plugs.contract-changes).",
  concept: concept_plugs,
  priority: "critical",
  trigger: { chainEvent: contract_payments.e.PaymentSent },
  steps: [
    { name: "facts", about: "Reads the transaction's facts at the finality depth: the sender, the transaction hash, the hash." },
    { name: "match", about: "Finds the waiting request by document hash, or notes a mismatch or no request." },
    { name: "land", about: "Lands the request, or marks the mismatch, and enqueues payment_sent." },
  ],
  reads: [table_chain_payments, table_payment_requests, table_site_events, table_site_cursors],
  writes: [table_payment_requests, table_site_events, table_site_cursors],
  drives: [machine_payment_request.t.land, machine_payment_request.t.mismatch, machine_site_event.t.enqueue],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "The unique event key (chain id, tx hash, log index): a replayed PaymentSent lands nothing twice.",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("chain-settle"),
  was: [`${SPIKE} (INTERFACE.md: payment_sent; Frappe half: Canonical JSON)`],
});

export const workflow_plugs_books_founder_capital = defineWorkflow({
  id: "plugs.books.founder-capital",
  title: "Book incoming Safe transfers as founding capital or unmatched deposits",
  about:
    "Triggered by each indexed Transfer of an admitted asset into a company Safe Capxul made. The first such Transfer into a Safe is " +
    "the funding at birth (books.founder-funding): the `founder_capital` event, carrying the amount, the transaction hash, the block time " +
    "and the founder (the Organization's founding Director), is enqueued so the site posts one Journal Entry that debits the Safe's bank " +
    "account and credits the company's capital account, with the founder as the party (a Shareholder). Every later Transfer in is not " +
    "capital: deposit_received carries amount, asset, tx_hash, block_time, from and to, so it stays unmatched and visible as a Bank Transaction " +
    "(books.party-lines). Its reference is the stable event key, not just the transaction hash: distinct logs in one transaction remain distinct " +
    "deposits and retries add no second line. The Safe's ledger equals its chain balance after founding capital lands (acc:report.run/1).",
  concept: concept_plugs,
  priority: "critical",
  trigger: { chainEvent: contract_erc20.e.Transfer },
  steps: [
    { name: "facts", about: "Reads the Transfer at the finality depth; a receiver that is not a company Safe Capxul made ends the run." },
    { name: "first", about: "Checks earlier admitted-asset incoming Transfers in chain order: only the first is founding capital." },
    { name: "enqueue", about: "Enqueues founder_capital with its founding Director for the first Transfer; otherwise deposit_received. Both retain the unique chain event key." },
  ],
  reads: [table_transfers, table_org_deployments, table_org_members, table_site_events, table_site_cursors],
  writes: [table_site_events, table_site_cursors],
  drives: [machine_site_event.t.enqueue],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "The unique event key (chain id, tx hash, receipt ordinal): a replayed Transfer enqueues nothing twice, and the site books the key once.",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("chain-settle"),
  was: ["docs/mission/decisions-2026-11-11.md (2. How does the money that funds a Safe enter its books?)"],
});

export const workflow_plugs_payments_fail = defineWorkflow({
  id: "plugs.payments.fail",
  title: "Fail a held payment when its approval reverted",
  about:
    "Triggered when the approval that carries a held payment reverts. The request fails with the reason and `payment_failed` is enqueued under the key `approval:<id>:failed`: Core's own word that a " +
    "signed attempt reverted or was refused, because a revert leaves no log (FINDINGS, Core half: A revert leaves no log). The draft stays in Frappe with the reason on it. A decline or a withdraw " +
    "is not a failure: the person decided, and the request is abandoned by `plugs.payments.abandon` when the draft is cancelled.",
  concept: concept_plugs,
  priority: "normal",
  trigger: { transition: machine_approval.t.revert },
  steps: [
    { name: "find", about: "Finds the waiting request the approval carries; none ends the run." },
    { name: "fail", about: "Fails it with the revert's reason and enqueues payment_failed." },
  ],
  reads: [table_payment_requests, table_site_events, table_site_cursors],
  writes: [table_payment_requests, table_site_events, table_site_cursors],
  drives: [machine_payment_request.t.fail, machine_site_event.t.enqueue],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "The event key `approval:<id>:failed` is unique: a second run enqueues nothing.",
  timeoutMs: 30_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
  was: [`${SPIKE} (Core half: A revert leaves no log; payment_failed is Core's attestation)`],
});

export const workflow_plugs_payments_collect = defineWorkflow({
  id: "plugs.payments.collect",
  title: "Collect the payment requests a site wrote, and answer each",
  about:
    "The site never calls the service (plugs.service-calls-site). A person's Submit in Frappe writes a request in the site's outbox in the same transaction as the document's waiting state. This process, one per Organization, asks the site for " +
    "requests after its durable integer cursor on startup, reconnect and an after-commit Socket.IO wake-up hint. Core initiates the scoped listener connection; the hint is never the source of truth. It holds each (`plugs.payments.hold`, which carries the trace id and idempotency key the request travelled with) and answers the site with the approval and whose signature is awaited, or the refusal " +
    "and its reason, then moves the cursor only after the answer is acknowledged. A site that is down has more after the cursor when it returns; the cursor is marked unreachable meanwhile. A repeat replays the complete committed answer, including its approval URL, even after the running gateway origin changes. Explicit paused restore rewrites origins on both sides before resume (plugs.answer-origin). Reconnect retries use the host transport clock, not periodic request polling.",
  concept: concept_plugs,
  priority: "critical",
  trigger: { indexer: "site request outbox: startup, listener reconnect and after-commit notification" },
  instance: { per: table_site_request_cursors },
  steps: [
    { name: "catch-up", about: "Asks the site for requests after the cursor when the outbound listener starts, reconnects or receives a wake-up hint." },
    { name: "hold", about: "Holds each request: checks the hat and the budget, opens the approval." },
    { name: "answer", about: "Tells the site the approval and whose signature is awaited, or the refusal." },
    { name: "advance", about: "Moves the cursor past the answered requests." },
  ],
  reads: [table_site_request_cursors, table_site_users],
  writes: [table_site_request_cursors],
  drives: [],
  invokes: [procedure_plugs_payments_hold],
  emits: [],
  calls: [integration_frappe_site.c.collectPaymentRequests, integration_frappe_site.c.answerPaymentRequest],
  chain: [],
  idempotency: "The request's idempotency key: a request already held replays its complete saved answer; only explicit paused restore rewrites its approval URL origin on both Core and the site, preserving path, query and fragment.",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
  was: ["spikes/skeleton/INTERFACE.md (Frappe to Core /prepare, which this replaces)"],
});
