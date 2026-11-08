// Requests' own judgments in the target design, one decision record each, linked to the records
// they shape. Made by Claude on 8 November 2026 under A1-A4 and P1-P10, with the old code
// (/home/user/factory, integration/factory), the as-is book (docs/as-is/archive/requests/) and the frozen
// operations as evidence.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { concept_books, concept_projects, concept_requests } from "../shared/foundation.ts";
import { contract_escrow, contract_escrow_factory, integration_indexer, integration_service_signer } from "../shared/external.ts";
import * as d from "./data.ts";
import * as iss from "./issuing.ts";
import * as inb from "./inbox.ts";
import * as svc from "./services.ts";
import * as co from "./checkout.ts";
import * as dep from "./deposits.ts";
import * as p from "./processes.ts";
import * as fl from "./flows.ts";
import * as op from "./operations.ts";

const CLAUDE = "Claude, requests target design, 8 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;

const READS = [
  iss.rpc_requests_issuing_list,
  iss.rpc_requests_issuing_get,
  inb.rpc_requests_inbox_list,
  inb.rpc_requests_inbox_get,
];
const ORG_WRITES = [
  iss.rpc_requests_issuing_issue,
  iss.rpc_requests_issuing_cancel,
  inb.rpc_requests_inbox_decline,
  svc.rpc_requests_services_create,
  svc.rpc_requests_services_revise,
  svc.rpc_requests_services_deactivate,
  dep.rpc_requests_deposits_candidates,
  dep.rpc_requests_deposits_match,
];
const FOLLOWERS = [
  p.workflow_requests_lifecycle_follow_settled,
  p.workflow_requests_lifecycle_follow_unsettled,
  p.workflow_requests_lifecycle_follow_cancelled,
];
const PREVIEW_FLOWS = [
  fl.flow_client_account_requests_cancel,
  fl.flow_client_account_inbox_decline,
  fl.flow_client_account_services_revise,
  fl.flow_client_account_services_deactivate,
  fl.flow_client_banking_deposits_match,
  fl.flow_client_checkouts_pay,
];
const ALL_OPERATIONS = [
  op.operation_request_issue,
  op.operation_request_get,
  op.operation_request_list,
  op.operation_request_cancel,
  op.operation_inbox_list,
  op.operation_inbox_get,
  op.operation_inbox_pay,
  op.operation_inbox_decline,
  op.operation_service_create,
  op.operation_service_revise,
  op.operation_service_deactivate,
  op.operation_service_get,
  op.operation_service_list,
  op.operation_bank_match,
];

// ── data ────────────────────────────────────────────────────────────────────────────────────

export const decision_requests_one_table = defineDecision({
  id: "requests.one-table",
  title: "One requests table for requests, Invoices and service purchases",
  question:
    "The old concept kept five tables: paymentRequests, invoiceCheckoutPayments, offerCheckouts, fixedOffers and " +
    "fixedOfferRevisions. Which does the target keep?",
  options: [
    {
      label: "consolidate",
      text:
        "`requests` (requests, Invoices and service purchases), `services` and `service-revisions`. A purchase at a " +
        "service's link is a request of kind `purchase`; the Payments that tried to pay a request are payments' rows.",
    },
    { label: "as-is", text: "Keep all five, with offer purchases and the request-to-Payment link as their own tables." },
  ],
  chosen: "consolidate",
  why:
    "A purchase and a request are the same thing to be paid: an amount owed to a Safe, a document, a payer and one way to " +
    "pay it. Two shapes meant two checkout paths, two receipt verifiers and two sets of rate limits. invoiceCheckoutPayments " +
    "was written by payments into requests' table (a write-boundary finding) and only listed attempts; payments now " +
    "holds every Payment with its v4 payment id, and the request keeps the one that pays it. The receipt, consumption, " +
    "verification, envelope-v3/v4 and settlement-id columns served the V3 router's checkout and the read-time chain " +
    "check, both gone (P9, requests.reads-write-nothing). Money Invoices are dropped by requests.no-money-invoice.",
  source: by("docs/as-is/archive/requests/data.ts; docs/as-is/payments.md (Payments inserts invoiceCheckoutPayments); P2, P9"),
  affects: [d.table_requests, d.table_services, d.table_service_revisions, concept_requests],
});

export const decision_requests_owner_tenancy = defineDecision({
  id: "requests.owner-tenancy",
  title: "A request is its issuer's row; its payer reads it across tenants by Safe",
  question:
    "A request is shared by two tenants, its issuer and its payer. Whose row is it, and how does the payer's inbox read it " +
    "under row-level security?",
  options: [
    {
      label: "issuer-row",
      text:
        "Tenancy owner (`owner_kind`, `owner_id`: the issuer). The inbox reads by `payer_safe` through a crossTenant index, " +
        "and the generated policy admits the tenant that owns the payer Safe (parties' directory) for reads.",
    },
    { label: "two-rows", text: "An issuer row and an inbox row per request, each in its own tenant, kept in step." },
    { label: "global", text: "A global table with no tenant, scoped by hand-written checks." },
  ],
  chosen: "issuer-row",
  why:
    "Two rows would copy the status, the payment and the escrow, and could disagree: the old system's derived states were " +
    "that kind of drift. A global table fails open. The issuer owns the receivable and is the only one who changes its " +
    "terms; the payer's rights are to read, pay and decline, all through rpcs that check the payer Safe is theirs. The " +
    "child tables carry their own tenant columns (no tenancy by join), and service revisions carry the owner's too.",
  source: by("P8 (owner tenancy, no tenancy by join); docs/as-is/archive/requests/data.ts (mixed tenancy, payerPartyId reads)"),
  affects: [d.table_requests, d.table_service_revisions, inb.rpc_requests_inbox_list, inb.rpc_requests_inbox_get, inb.rpc_requests_inbox_pay],
});

export const decision_requests_payer_by_safe = defineDecision({
  id: "requests.payer-by-safe",
  title: "The payer is a Safe: on Capxul by an active Party, outside by its email Safe",
  question: "How does a request name its payer, and when is a payer 'on Capxul'?",
  options: [
    {
      label: "safe",
      text:
        "Resolve the payer through parties' directory: an `@handle`, or a mailbox whose person Party is active, is on Capxul; " +
        "any other mailbox is outside and named by its email Safe (`safeAddressFor`), which owns the escrow. The inbox is " +
        "keyed by the payer Safe. Requests creates no Party, and a bare address is refused as a payer.",
    },
    { label: "party", text: "Name a provisional Party for every mailbox and key the inbox by Party id." },
  ],
  chosen: "safe",
  why:
    "A person's Safe is a pure function of their email, so the escrow's owner is the very Safe the payer gets when they " +
    "join: their inbox then shows the request with nothing to migrate, and the escrow's refund goes to them. Naming a " +
    "Party would need a parties procedure for a fact that is not a money fact for parties (the request already holds the " +
    "Safe). A bare address can own no email Safe and has no inbox; the frozen text refuses it for an Invoice, and the V3 " +
    "wallet checkout that paid an address-addressed basic request is pre-v4 (P9). The escrow address and its payment id " +
    "are computed in the backend as `predictAddress` and `predictPaymentId` answer, so issuing calls nothing.",
  source: by("request.issue.yaml (designed: escrow at predictAddress, nothing on chain at issue); books/target/parties/data.ts"),
  affects: [d.table_requests, iss.rpc_requests_issuing_issue, co.rpc_requests_checkout_open, contract_escrow_factory],
});

export const decision_requests_machine = defineDecision({
  id: "requests.machine",
  title: "A request has six stored states; births and payer binding are transitions",
  question:
    "The old status admitted eight values, three never written (draft, viewed, expired) and two more derived at read time " +
    "(scheduled, paid for crypto). Which states does the target store?",
  options: [
    {
      label: "six",
      text:
        "open, paying, paid, declined, cancelled, expired, every one written by a named transition. Birth is `issue` from no " +
        "state; naming the payer at a link is `bind_payer` (open to open). Cancelled and expired are not terminal: an " +
        "escrow that already held the amount still pays out and the request reads paid.",
    },
    { label: "as-is", text: "Keep the eight values and derive paid, scheduled and expired when read." },
  ],
  chosen: "six",
  why:
    "P7 makes every status write a transition and the event the funnel's proof; a derived state cannot be followed by " +
    "notices and was the old drift between the request and its Payment. `paying` covers every 'being paid' the frozen " +
    "text names (an approval waiting, a dated payment, a funded escrow paying out). Expiry is the process's own timer, so " +
    "it is a real transition. The frozen designed text of `request cancel` says a funded escrow still pays out, which is " +
    "why `settle` leaves cancelled and expired. The frozen note naming draft and viewed stays verbatim: those states " +
    "simply never occur.",
  source: by("docs/as-is/archive/requests/data.ts (payment-request machine); request.cancel.yaml (designed); P7"),
  affects: [d.machine_request, d.event_request_transitioned, d.table_requests],
});

export const decision_requests_service_machine = defineDecision({
  id: "requests.service-machine",
  title: "A service's status is a machine; each revision is a transition",
  question: "The old `active` boolean had one transition and revisions sent their own event. How does the target book it?",
  options: [
    { label: "machine", text: "`status` active or inactive; `create` from no state, `revise` active to active, `deactivate`; one event." },
    { label: "boolean", text: "Keep the boolean and send a separate event for revisions." },
  ],
  chosen: "machine",
  why:
    "P7: one event per machine, from every transition. A revision changes the row (its revision) though not its status, " +
    "so `revise` is a self-transition and 'each revision is reported once, in order' is the event's `revision` prop.",
  source: by("docs/as-is/archive/requests/data.ts (fixed-offer machine); service.revise.yaml (acceptance 2)"),
  affects: [d.machine_service, d.event_service_transitioned, d.table_services],
});

export const decision_requests_no_money_invoice = defineDecision({
  id: "requests.no-money-invoice",
  title: "No fiat-denominated Invoices: a request is always a token amount",
  question: "Keep Money Invoices (gross fiat bound to a bank receiving account, envelope-v5)?",
  options: [
    { label: "drop", text: "Drop them: every request is a token amount; a credited bank deposit in the request's token can pay any request (`bank match`)." },
    { label: "keep", text: "Keep fiat amounts and receiving accounts on requests." },
  ],
  chosen: "drop",
  why:
    "No frozen operation issues one: `request issue` takes an amount in an asset ('The asset defaults to USDC'). A bank " +
    "deposit arrives as tokens in the owner's Safe (banking credits its net tokens), so matching it to a token request " +
    "covers the frozen `bank match`. The fiat path needed a second amount shape, a second document format and banking's " +
    "receiving-account read in issuing.",
  source: by("request.issue.yaml; bank.match.yaml; docs/as-is/archive/requests/data.ts (amountKind money); P2"),
  affects: [d.table_requests, iss.rpc_requests_issuing_issue, dep.rpc_requests_deposits_match],
});

export const decision_requests_link_by_request_id = defineDecision({
  id: "requests.link-by-request-id",
  title: "A checkout link names the request or service id; no separate link token",
  question: "The old request carried a `plink_` bearer token for its link. Keep it?",
  options: [
    { label: "id", text: "The link is `/pay/<request id>` or `/buy/<service id>`; the ids are ULIDs and the public terms reveal no private data." },
    { label: "token", text: "Keep a separate unguessable link token per request." },
  ],
  chosen: "id",
  why:
    "The designed example of `request issue` prints `/pay/req_01K3…`. A link shows only public terms (issuer, reference, " +
    "amount, where to pay), never the note, the payer's mailbox or the document, and every write it allows (naming a " +
    "payer, buying) is rate limited. One fewer column and index.",
  source: by("request.issue.yaml (designed example); docs/as-is/archive/requests/data.ts (linkToken)"),
  affects: [d.table_requests, co.rpc_requests_checkout_get, co.rpc_requests_checkout_open],
});

// ── behaviour ───────────────────────────────────────────────────────────────────────────────

export const decision_requests_reads_write_nothing = defineDecision({
  id: "requests.reads-write-nothing",
  title: "Reads check nothing on chain and write nothing; they refuse when Ponder lags",
  question:
    "The old current reads checked each link's receipt on chain and recorded what they found. What do the target's reads " +
    "do, and when do they refuse WRONG_STATE?",
  options: [
    {
      label: "state-only",
      text:
        "A read returns the request as its machine stands; the request's process and the payment followers record what " +
        "the chain proved. A read whose requests follow the chain asks `indexer.head` and refuses WRONG_STATE " +
        "`verification_unavailable` when Ponder is reindexing or behind by more than the finality depth.",
    },
    { label: "as-is", text: "Keep read-time chain checks that write verifications, as actions." },
  ],
  chosen: "state-only",
  why:
    "A read that writes is an rpc with two jobs, and the old checks made every list a chain read and a race with the " +
    "sweep. In the target the paid state follows payments' one settlement path, so there is nothing for a read to verify. " +
    "The frozen refusal stays meaningful: a status that may be stale because Ponder is behind is refused, never shown, and " +
    "an unavailable inbox is a failure, never empty. The frozen `changes` lines ('It can record a checkout payment that " +
    "the chain already proved') stay verbatim as frozen text; in the target the request's process records it.",
  source: by("docs/as-is/archive/requests/receivables.ts (CURRENT_ABOUT); request.list.yaml (acceptance 2, 3); P1"),
  affects: [...READS, integration_indexer],
});

export const decision_requests_paid_follows_payments = defineDecision({
  id: "requests.paid-follows-payments",
  title: "Paid follows payments' settle, unsettle and cancel, escrow payouts included",
  question: "Which of payments' transitions does a request follow, and how does an escrow payout make it paid?",
  options: [
    {
      label: "three",
      text:
        "Three workflows triggered through the outbox: `settle` makes the request paid (an inbox payment, or the escrow " +
        "payout payments births from the indexed PaymentSent), `unsettle` puts it back to paying, `cancel` reopens it. A " +
        "lapsed Payment keeps it paying; `inbox pay --resume` retries it.",
    },
    { label: "escrow-event", text: "Follow payments for inbox payments, and the escrow's own EscrowPaid for escrow payouts." },
  ],
  chosen: "three",
  why:
    "One settlement path (concepts.payments): the escrow's payout ends in a PaymentSent that payments settles with every " +
    "term checked and books, so following it keeps the request, the Payment and the books agreeing, reorgs included. " +
    "Following EscrowPaid too would be a second interpretation of the same money. A lapsed Payment kept its payment id and " +
    "can still be retried, so reopening on a lapse would let a second attempt race it; a cancelled Payment never moves, " +
    "so a new attempt is safe. The workflows find the request by the Payment's v4 payment id.",
  source: by("books/target/payments/data.ts (machine payment); dependencies.payments-requests; concepts.payments"),
  affects: [...FOLLOWERS, d.machine_request, d.table_requests],
});

export const decision_requests_escrow_process = defineDecision({
  id: "requests.escrow-process",
  title: "One process per request replaces the minute escrow sweep",
  question:
    "The old cron read the 25 least recently read escrows every minute and relayed payouts from the faucet Safe. What " +
    "watches an escrow now?",
  options: [
    {
      label: "process",
      text:
        "The request's own process: woken by each indexed Transfer into its escrow, it reads the balance, moves the request " +
        "through `fund` once it holds the amount, and deploys and pays out with the escrow relayer's key through the " +
        "service signer, recording the payout before awaiting it. A cancelled or expired request gets one last read.",
    },
    { label: "sweep", text: "Keep a singleton sweep over waiting escrows." },
  ],
  chosen: "process",
  why:
    "P3 keeps only six crons and makes everything the old system swept for a process's own wait. A request is on the " +
    "durable-process list (rules.durable-processes). The faucet Safe relay worked on Base Sepolia only; the service " +
    "signer's escrow relayer key does one job and sends once (K4). The old part-received notice is dropped: a partial " +
    "funding is not a state change, so nothing could follow it (P7).",
  source: by("docs/as-is/archive/requests/checkouts.ts (pay-escrows); P3 (crons); rules.durable-processes"),
  affects: [p.workflow_requests_lifecycle_request, integration_service_signer, contract_escrow, contract_escrow_factory, d.machine_request],
});

export const decision_requests_one_checkout_path = defineDecision({
  id: "requests.one-checkout-path",
  title: "Link checkout is one path: name your email, then the escrow or your inbox",
  question:
    "The old checkout had three paths: an outside wallet signing the V3 router's send, a registered payer's sponsored " +
    "Payment from the link, and the escrow. Which survive?",
  options: [
    {
      label: "escrow-or-inbox",
      text:
        "The payer names their email at the link: on Capxul, the request goes to their inbox and they pay it like any " +
        "inbox request; outside, they fund the invoice escrow from any wallet. A service purchase is the same, with a new " +
        "request born at the link.",
    },
    { label: "as-is", text: "Keep the router wallet checkout and the registered link checkout alongside the escrow." },
  ],
  chosen: "escrow-or-inbox",
  why:
    "The router checkout is pre-v4 (P9) and the registered link checkout duplicated `inbox pay` with its own rpcs into " +
    "payments' engine. On v4 every outside payment goes through an escrow whose payment id is fixed by its terms, so a " +
    "direct payment and the payout can never both settle one request. The checkout page is the React SDK's surface " +
    "(`client.checkouts.pay`), not a frozen operation; its rpcs are reached by that flow.",
  source: by("request.issue.yaml (designed: checkout into an invoice escrow); docs/as-is/archive/requests/checkouts.ts; P9"),
  affects: [co.rpc_requests_checkout_get, co.rpc_requests_checkout_open, fl.flow_client_checkouts_pay, d.table_requests],
});

export const decision_requests_invoicing_hat = defineDecision({
  id: "requests.invoicing-hat",
  title: "An Organization's request writes need its Invoicing hat, bank match included",
  question:
    "The old guard needed a Seat holding issue invoices for an Organization's issue, cancel, decline and services, and " +
    "banking's 'management authority' for a deposit match. What does the target check?",
  options: [
    {
      label: "invoicing",
      text:
        "A current Seat (organizations) for reads; for writes, the Seat's Safe wears the Organization's Invoicing hat now " +
        "(its deployment names it; indexing's wearers show it). `bank match` takes the same hat.",
    },
    { label: "books-for-match", text: "The Invoicing hat for requests, the Books hat for a deposit match." },
  ],
  chosen: "invoicing",
  why:
    "v4 replaces issue invoices with the Invoicing officer hat (the designed refusals of `request issue` and `request " +
    "cancel`). Matching a deposit marks a receivable paid, which is the Invoicing officer's work; the deposit's own book " +
    "fact is banking's and already written at credit. Paying from the Organization's inbox is the budget's hat, which " +
    "`payments.prepare-command` and the chain check, not this guard.",
  source: by("request.issue.yaml and request.cancel.yaml (designed refusals); packages/backend/src/requests/guards.ts:44"),
  affects: ORG_WRITES,
});

export const decision_requests_inbox_pay_funding = defineDecision({
  id: "requests.inbox-pay-funding",
  title: "Inbox pay reads funding before its transaction; `--from` names the budget by key",
  question:
    "`payments.prepare-command` needs the funding the invoker read from the chain. How does `inbox pay` read it, and how " +
    "does it find the budget `--from` names?",
  options: [
    {
      label: "by-key",
      text:
        "An action: `--from operations` is found by its Capxul key in budgets' table, which gives its chain id (a chain id " +
        "is taken as it is); indexing's chain budgets give its office hat, which the member's Safe must wear; then the " +
        "person's Safe balance or the budget's `Budgets.leftOf`, and the birth in one transaction.",
    },
    { label: "chain-id", text: "`--from` takes the budget's chain id only, the one fact requests could read before it depended on budgets." },
  ],
  chosen: "by-key",
  why:
    "Revised at assembly. The designed examples name the budget by its key (`--from operations`) and print its name and " +
    "what it has left. This record first chose the chain id because requests did not depend on budgets; the review added " +
    "that edge (dependencies.payers-sign-and-name-budgets: no cycle, budgets sits below requests), so the key is read where " +
    "budgets keeps it. A chain id still works, for a budget made outside Capxul that has no key. The read is chain-read " +
    "class because it calls the chain; nothing is signed or sent here.",
  source: by("inbox.pay.yaml (designed --from); dependencies.payers-sign-and-name-budgets; books/target/budgets/data.ts (budgets: key, budget_id)"),
  affects: [inb.rpc_requests_inbox_pay],
});

export const decision_requests_inbox_pay_approval = defineDecision({
  id: "requests.inbox-pay-approval",
  title: "An agent payer signs inbox pay at once; a person on the approval page",
  question:
    "A4 gives every signature to the flow, and 'An AI with its own key signs at once'. Requests births the approval " +
    "through payments. How does `inbox pay` get signed?",
  options: [
    {
      label: "sign-in-flow",
      text:
        "The flow follows the approval until it is sponsored (`approvals.signing.get`), an agent signs its digest with its " +
        "own key and gives it to approvals (`approvals.signing.sign`); a person signs on the approval page.",
    },
    { label: "approval-page", text: "The flow only waits for the payer on the approval page, for an agent too." },
  ],
  chosen: "sign-in-flow",
  why:
    "Revised at assembly. This record first waited for the approval page, because requests did not depend on approvals; " +
    "the review added that edge (dependencies.payers-sign-and-name-budgets), so the flow takes the same signing steps as " +
    "`payment send`. Approvals still sends the operation once and refuses an unknown or another signer's approval " +
    "INVALID_INPUT. The flow also passes `--on`/`--at` as the door's `pay_at`, `--resume` as its `resume` (one new " +
    "approval for a lapsed Payment under the same payment id, decision payments.door-inputs), and prints the deadline the " +
    "door answers as `expiresAt`.",
  source: by("inbox.pay.yaml (changes); dependencies.payers-sign-and-name-budgets; books/target/payments/flows.ts (signing steps); payments.door-inputs"),
  affects: [fl.flow_client_account_inbox_pay, inb.rpc_requests_inbox_pay],
});

export const decision_requests_auto_match = defineDecision({
  id: "requests.auto-match",
  title: "Keep matching a credited deposit by its reference, as a workflow",
  question: "The old deposit credit auto-matched a request whose reference the deposit carried. Keep it?",
  options: [
    { label: "keep", text: "A workflow triggered by banking's `credit` matches the one open request its reference names, through `banking.match-deposit`." },
    { label: "drop", text: "Only `bank match` by hand." },
  ],
  chosen: "keep",
  why:
    "It has a caller (the credit), it is the common case of a bank-paid Invoice, and banking's door already names 'its " +
    "own match by reference'. As an outbox consumer it never holds up the credit, and an ambiguous reference is left to " +
    "`bank match`.",
  source: by("packages/backend/src/banking/deposits/operations/auto-match.ts:14; books/target/banking/procedures.ts"),
  affects: [p.workflow_requests_deposits_auto_match],
});

export const decision_requests_no_door = defineDecision({
  id: "requests.no-door",
  title: "Requests has no procedures; the old door is not ported",
  question: "The old requests door had 21 functions other concepts called. Which become procedures?",
  options: [
    { label: "none", text: "None: payments, banking and documents no longer call into requests; notices reads its tables." },
    { label: "some", text: "Keep the birth identities and read-access functions as procedures." },
  ],
  chosen: "none",
  why:
    "Every old callback went the wrong way (payments and banking calling up into requests). The dependencies now point " +
    "from requests down (dependencies.payments-requests, concepts.requests), a document's participants are given when it " +
    "is stored, and P4 allows a procedure only for a money fact a lower concept must write with its invoker.",
  source: by("docs/as-is/archive/requests/procedures.ts; P4; rules.procedures"),
  affects: [concept_requests],
});

export const decision_requests_telemetry = defineDecision({
  id: "requests.telemetry",
  title: "The emit actions and the notify workflow are not ported",
  question: "The old concept had three telemetry actions (emit-issued, emit-transitioned, emit-changed) and an Invoice notify workflow. Keep them?",
  options: [
    { label: "drop", text: "Drop them: each machine's event leaves through the outbox (P7), and notices sends every email from `request_transitioned`." },
    { label: "keep", text: "Port them as rpcs or workflows." },
  ],
  chosen: "drop",
  why: "Telemetry is never an operation (P7, review emit-only), and no concept but notices sends mail (dependencies.notices-top).",
  source: by("docs/as-is/archive/requests/receivables.ts (emit-*, notify); docs/as-is/archive/requests/offers.ts (emit-changed); P7"),
  affects: [d.event_request_transitioned, d.event_service_transitioned],
});

// ── operations ──────────────────────────────────────────────────────────────────────────────

export const decision_requests_acceptance_rewrites = defineDecision({
  id: "requests.acceptance-rewrites",
  title: "Eleven acceptance lines rewritten as outcomes",
  question: "Which of requests' frozen acceptance lines name a mechanism a black box cannot see, and what do they claim instead?",
  options: [
    {
      label: "eleven",
      text:
        "request.get 1, request.list 1 to 3, inbox.list 1 and inbox.get 1 (the read-time chain check: 'after its Invoice is " +
        "checked', 'before any chain check', 'a verification is written'); request.cancel 1 ('from the committed row'); " +
        "inbox.pay 2 ('lineage'); service.create 4 ('before restoration'); service.revise 4 ('is forwarded'); bank.match 1 " +
        "('schedules one event': the target sends the request's and the deposit match's events, one each).",
    },
    { label: "none", text: "Keep every line verbatim." },
  ],
  chosen: "eleven",
  why:
    "P1: a claim names an outcome one of the five observers can check. Each rewrite keeps the old outcome and passes " +
    "against the old system: the issuer still gets its request with the status the chain shows; a refused list still " +
    "shows nothing; one cancel still reports one cancel. The `--after` cursor of inbox.list 2 is the printed `nextCursor`, " +
    "a surface the CLI shows, so that line is kept. The old line and its test are in each rewritten line's `was`.",
  source: by("books/frozen/operations.ts (acceptance); P1"),
  affects: [
    op.operation_request_get,
    op.operation_request_list,
    op.operation_request_cancel,
    op.operation_inbox_list,
    op.operation_inbox_get,
    op.operation_inbox_pay,
    op.operation_service_create,
    op.operation_service_revise,
    op.operation_bank_match,
  ],
});

export const decision_requests_worlds = defineDecision({
  id: "requests.worlds",
  title: "The devnet worlds requests' refusals are reached from",
  question: "Which named devnet snapshots do requests' refusals need?",
  options: [
    {
      label: "nine",
      text:
        "signed-out (no session); person-with-requests (an issuer with an open request to a person on Capxul, an open " +
        "escrow Invoice to an outside email, a link request, and a paid, a declined and a cancelled one; the payer signed " +
        "in too); org-with-requests (an Organization that issued and received requests, a member wearing the Invoicing hat " +
        "and one wearing none, a budget whose office hat a member wears, spent to less than a received request); " +
        "requests-indexer-behind (person-with-requests with Ponder held more than the finality depth behind the chain); " +
        "person-with-underfunded-safe (a payer whose Safe holds less than the request to them); person-with-services (an " +
        "active service at revision 2 and a deactivated one); org-with-services (an Organization's service and a member " +
        "without the Invoicing hat); person-with-credited-deposit (a credited unmatched deposit, an arriving one, one " +
        "matched, and an open USDC request it can pay); org-with-credited-deposit (the same for an Organization, with a " +
        "member without the Invoicing hat).",
    },
    { label: "one", text: "One large world for every refusal." },
  ],
  chosen: "nine",
  why:
    "Each world holds what its refusals need and is named after it, so an eval restores the smallest snapshot; the money " +
    "worlds (a credited deposit, an underfunded Safe, a lagging indexer) stay separate because building them costs chain " +
    "and Bridge-sandbox time.",
  source: by("CONVENTIONS.md (worlds); the refusals of the 14 operations"),
  affects: ALL_OPERATIONS,
});

export const decision_requests_budget_overrides = defineDecision({
  id: "requests.budget-overrides",
  title: "A preview then a write gets 2.5 s at p95",
  question: "The flows that show a terminal preview before writing take two round trips. Do they keep the write class's 1.5 s?",
  options: [
    { label: "override", text: "p95 2,500 ms for those flows and their operations, with the person's answer to the prompt excluded." },
    { label: "default", text: "Keep 1,500 ms and skip the preview read." },
  ],
  chosen: "override",
  why:
    "The frozen claims require the preview ('At a terminal it previews the exact issued request'). A read (p95 1.2 s) " +
    "and a write (1.5 s) in sequence cannot fit 1.5 s; 2.5 s is their sum less the shared session cost. Everything else " +
    "takes its class default: reads read, writes write, `inbox pay` chain-read on the server (it reads funding from the " +
    "chain) and chain-settle end to end, the processes background.",
  source: by("packages/book/src/budgets.ts; P5"),
  affects: [
    ...PREVIEW_FLOWS,
    op.operation_request_cancel,
    op.operation_inbox_decline,
    op.operation_service_revise,
    op.operation_service_deactivate,
    op.operation_bank_match,
  ],
});

// ── after the Frappe redesign (assembly, 8 November 2026) ───────────────────────────────────

const ASSEMBLY = (evidence: string) => `Claude, assembly (world group), 8 November 2026; evidence: ${evidence}`;

export const decision_requests_income_meaning = defineDecision({
  id: "requests.income-meaning",
  title: "An Organization's request carries its income account to the books",
  question:
    "The accounting design asks that a paid request's side carry its meaning to books: its income account, and, when " +
    "a head made a Sales Invoice for it, party Customer and that invoice as the reference. Payments' door now takes a " +
    "`payee_against`. Where does a request keep its meaning, and how does it reach the books?",
  options: [
    {
      label: "on-the-request",
      text:
        "`request issue --org` takes `account` and, from a head, `sales_invoice`; the request keeps them as `income`, and " +
        "`inbox pay` passes them to `payments.prepare-command` as the item's `payee_against` with party Customer at the " +
        "payer's Party. Books checks the account when it posts, and a side whose account no longer fits waits in review.",
    },
    { label: "annotate-later", text: "Keep nothing on the request; the Organization classifies the payment afterwards with `activity annotate`." },
    { label: "head-only", text: "Only a head's Sales Invoice carries meaning, through its own Payment Entry." },
  ],
  chosen: "on-the-request",
  why:
    "The issuer knows what a request is for when it asks, as a Sales Invoice names its income account, so the meaning " +
    "belongs with the request from its birth; payments keeps what the command carried and passes it with the " +
    "settlement (payments.money-sides), so the voucher is a Payment Entry Receive against the head's Sales Invoice or a " +
    "Bank Entry on the income account rather than an unclassified 4999 line. Requests does not depend on books, so it " +
    "cannot check the account; books never refuses a money fact and holds a side whose account does not fit in review " +
    "(books' door), which is the right place for that check. The Customer is the payer's Party in the directory, which " +
    "the head finds by capxul_party. Mapping the request to the head's Sales Invoice is the head's: the Capxul app " +
    "asks for the payment by naming its invoice, and its Payment Entry follows the fact. Two paths still carry no " +
    "meaning: an outside payer's invoice escrow pays out as a Payment born from the chain, which payments cannot tie " +
    "to a request, and a matched bank deposit, whose fact is banking's (`banking.match-deposit` takes no meaning yet); " +
    "both wait in review for `activity annotate` or the head (asked of payments and banking).",
  source: ASSEMBLY("docs/design/frappe/accounting.md (For other lanes: requests); books/target/payments/procedures.ts (payee_against)"),
  affects: [d.table_requests, iss.rpc_requests_issuing_issue, inb.rpc_requests_inbox_pay, concept_books],
});

export const decision_requests_bill_time = defineDecision({
  id: "requests.bill-time",
  title: "Decision pack: bill logged hours as an Invoice, marking them in one write",
  question:
    "Projects' timesheets hold billable hours (aaron.projects), and the invoice-from-timesheets command is requests'. " +
    "Which command bills them, and how do the request and the hours it bills stay one fact?",
  options: [
    {
      label: "timesheet-bill",
      text:
        "Recommended. A new operation, `timesheet bill <timesheet…> --org <org> [--to <payer>]`, as requests' flow over " +
        "`requests.issuing.issue`: it reads the timesheets' billable logs not yet billed, previews an Invoice to the " +
        "project's customer with one line per activity (hours times the billing rate), and in the issue's transaction " +
        "invokes `projects.bill-time` (`bill`) so the logs name the request. `request cancel` and `inbox decline` of " +
        "such a request invoke it with `unbill` in their own transactions; paid keeps the marks.",
    },
    {
      label: "issue-flag",
      text: "No new command: `request issue --timesheets <ts…>` on the kept command, with the same door and the same marks.",
    },
    { label: "head-only", text: "None: hours are invoiced only by a connected head's Sales Invoice, which marks them through the sync." },
  ],
  chosen: "timesheet-bill",
  why:
    "For Aaron: which command bills hours is the capability's decision pack (rules.new-operations), and the " +
    "recommendation stands until he answers. A time Invoice is one money fact with the hours it bills " +
    "(projects.bill-time): the issue writes the request and, through projects' door, the marks, or neither, so a " +
    "second Invoice, Capxul's or a head's, can never ask for the same hours. Ending it clears them, as cancelling a " +
    "Sales Invoice unlinks its timesheets; an expired request keeps them until cancelled, as an unpaid invoice does. " +
    "A command of its own reads as ERPNext's 'Make Sales Invoice' from a timesheet and keeps `request issue` the kept " +
    "command it was; the flag would widen a frozen command's flags for one source of lines. Head-only leaves an " +
    "Organization with no head unable to bill its time. Booking waits on two things: Aaron's answer, and an edge, " +
    "requests depending on projects (shared foundation and dependencies.of-requests, asked of its owner), without " +
    "which the issue may not invoke the door; projects sits below requests, so the edge makes no cycle.",
  source: ASSEMBLY("docs/design/frappe/projects-and-startup.md (section 2); projects.billing-and-payslips; projects.commands; aaron.projects"),
  affects: [concept_requests, concept_projects, d.table_requests, iss.rpc_requests_issuing_issue, iss.rpc_requests_issuing_cancel, inb.rpc_requests_inbox_decline],
});
