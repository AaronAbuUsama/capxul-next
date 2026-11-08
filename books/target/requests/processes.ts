// Requests' durable work (A3, P3). One process per request owns what nobody asks for: its expiry
// timer, and for a payer outside Capxul its invoice escrow (watched until it holds the amount, then
// deployed and paid out with the escrow relayer's key). Everything a person does to a request is an
// rpc that drives its transition and resumes the process (its signals). A request's paid state
// follows payments: three small workflows react to `payment_transitioned` through the outbox
// (settle, unsettle, cancel), and one reacts to banking's credited deposit to match it by reference.
// A service has no process: it changes only inside rpcs. The old minute sweep of waiting escrows,
// its read queue and its faucet relay are gone (decision requests.escrow-process).

import { budget, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_requests } from "../shared/foundation.ts";
import {
  contract_erc20,
  contract_escrow,
  contract_escrow_factory,
  integration_chain_rpc,
  integration_service_signer,
} from "../shared/external.ts";
import { machine_request, table_requests } from "./data.ts";
import { rpc_requests_checkout_open } from "./checkout.ts";
import { rpc_requests_deposits_match } from "./deposits.ts";
import { rpc_requests_inbox_decline, rpc_requests_inbox_pay } from "./inbox.ts";
import { rpc_requests_issuing_cancel } from "./issuing.ts";
import { machine_payment, table_payments } from "../payments/data.ts";
import { machine_bank_deposit, table_bank_deposits } from "../banking/data.ts";
import { procedure_banking_match_deposit } from "../banking/procedures.ts";

const R = "packages/backend/src/requests";
const CHECKOUTS = "books/as-is/requests/checkouts.ts";

const DAY = 86_400_000;

export const workflow_requests_lifecycle_request = defineWorkflow({
  id: "requests.lifecycle.request",
  title: "A request's life: its expiry, and its escrow until it pays out",
  about:
    "One instance per request, started by its birth (`issue`). It waits for its payer, its expiry and, for a payer " +
    "outside Capxul, its escrow; it is resumed by the rpcs that change the request (its signals) and by the payment " +
    "followers. Escrow: each Transfer of the request's token into the escrow address that Ponder indexes wakes it; it " +
    "reads the escrow's balance (`balanceOf`) and records it; once the balance is at least the amount it moves the " +
    "request through `fund`, deploys the escrow if it has no code (`EscrowFactory.deploy(terms, salt)`) and calls " +
    "`Escrow.payout()`, each sent once with the escrow relayer's key, which pays the issuer's Safe through " +
    "`Payments.send`. Payments births and settles that Payment from the indexed PaymentSent, and `follow-settled` marks " +
    "the request paid. A request cancelled or expired while open gets one last balance read once Ponder has passed the " +
    "block it ended at: an escrow that already held the amount still pays out, one that held less is left to its owner " +
    "(the email Safe can refund it on chain), and the process ends. Expiry: at `expires_at` an open request moves through " +
    "`expire`. A terminal request ends the instance.",
  was: [`${R}/checkouts/operations/pay-escrows.ts:18`, `${R}/checkouts/external/escrows.ts:60`, `${R}/writes/escrows.ts:58`, `${CHECKOUTS}:1033`],
  concept: concept_requests,
  priority: "normal",
  trigger: { transition: machine_request.t.issue },
  instance: { per: table_requests },
  signals: [
    rpc_requests_checkout_open,
    rpc_requests_inbox_pay,
    rpc_requests_inbox_decline,
    rpc_requests_issuing_cancel,
    rpc_requests_deposits_match,
  ],
  waits: [
    { name: "payer", for: "person", about: "The payer pays, declines or names their email at the link, or the issuer cancels; resumed by the rpc's signal." },
    { name: "expiry", for: "timer", about: "Until `expires_at`, when the request has one; an open request then expires." },
    { name: "escrow-funded", for: "indexer", about: "A Transfer of the token into the escrow address, indexed by Ponder; each one wakes a balance read." },
    { name: "payout", for: "chain", timeoutMs: 600_000, about: "The relayer's deploy and payout transactions mined, each followed to its receipt." },
    { name: "payment", for: "signal", about: "The request's Payment settled, reversed or cancelled, from the payment followers." },
  ],
  steps: [
    { name: "start", about: "Reads the request; a terminal one ends the instance, so a second start is a no-op." },
    { name: "arm-expiry", about: "Sets the expiry timer when the request has `expires_at`." },
    { name: "watch-escrow", about: "Outside payer: on each indexed Transfer, reads `balanceOf(escrow)` and records `escrow_received_raw` and the time." },
    { name: "fund", about: "The balance reached the amount: drives `fund` (open to paying)." },
    { name: "deploy", about: "No code at the escrow address (`getCode`): sends `EscrowFactory.deploy(terms, salt)` with the relayer key, once." },
    { name: "payout", about: "Sends `Escrow.payout()` with the relayer key, once, and records `payout_tx_hash` before the receipt is awaited." },
    { name: "expire", about: "The timer fired while open: drives `expire`." },
    { name: "last-read", about: "Cancelled or expired with an escrow: once Ponder passed the ending block, one balance read; funded goes to deploy and payout." },
    { name: "end", about: "Paid, declined, or cancelled or expired with nothing to pay out: the instance ends." },
  ],
  reads: [table_requests],
  writes: [table_requests],
  drives: [machine_request.t.fund, machine_request.t.expire],
  invokes: [],
  emits: [],
  calls: [
    integration_chain_rpc.c.readContract,
    integration_chain_rpc.c.getCode,
    integration_service_signer.c.send,
    integration_service_signer.c.waitForReceipt,
  ],
  chain: [contract_erc20.f.balanceOf, contract_escrow_factory.f.deploy, contract_escrow.f.payout],
  idempotency:
    "One instance per request id; `fund` and `expire` are guarded by the status. Each relayer send is recorded before it " +
    "is broadcast and `payout_tx_hash` before its receipt is awaited, so a resumed run never sends a second payout; the " +
    "chain consumes the escrow's payment id once.",
  timeoutMs: 400 * DAY,
  retries: { max: 5, backoff: "exponential" },
  compensation:
    "Nothing to undo: the escrow is the payer's money on chain until it pays out. A deploy or payout that reverts (a fee " +
    "or rebasing token, `InexactTransfer`) leaves the request paying and is tried again after an hour, at most 24 times; " +
    "then the process waits for a signal, and the escrow's owner can refund it on chain. At its timeout an open request " +
    "with no expiry stays open, and its next signal starts the instance again.",
  budget: budget("background"),
});

export const workflow_requests_lifecycle_follow_settled = defineWorkflow({
  id: "requests.lifecycle.follow-settled",
  title: "A Payment settled: mark the request it pays paid",
  about:
    "Triggered by payments' `settle`, through the outbox. It reads the settled Payment's v4 payment id and finds the " +
    "request whose `chain_payment_id` it is (`by_chain_payment`): an inbox payment, or an escrow's payout, which payments " +
    "births from the indexed PaymentSent. None: it ends. Else it moves the request through `settle`, records the Payment, " +
    "and resumes the request's process. The paid state may lag the Payment by a second, never the other way (P4).",
  was: [`${R}/writes/receipts.ts:231`, "packages/backend/src/payments/writes/settlements.ts:144", "docs/as-is/payments.md"],
  concept: concept_requests,
  priority: "normal",
  trigger: { transition: machine_payment.t.settle },
  steps: [
    { name: "find", about: "The Payment's chain payment id, then the request that carries it; none ends the run." },
    { name: "settle", about: "Drives `settle` with the Payment's id; a request already paid by it is left as it is." },
    { name: "resume", about: "Resumes the request's process, which ends the instance." },
  ],
  reads: [table_payments, table_requests],
  writes: [table_requests],
  drives: [machine_request.t.settle],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "The Payment's id: a second delivery of the same `settle` finds the request paid by that Payment and does nothing.",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
});

export const workflow_requests_lifecycle_follow_unsettled = defineWorkflow({
  id: "requests.lifecycle.follow-unsettled",
  title: "A reorg reversed a Payment: the request it paid is being paid again",
  about:
    "Triggered by payments' `unsettle`, through the outbox: a reorg removed the PaymentSent a settled Payment consumed. " +
    "The paid request that Payment paid moves back through `unsettle` to paying, and waits for the same Payment to settle " +
    "again; its process is resumed. A request paid by a bank deposit is never touched.",
  was: ["packages/backend/src/payments/writes/settlements.ts:157", "docs/as-is/payments.md"],
  concept: concept_requests,
  priority: "normal",
  trigger: { transition: machine_payment.t.unsettle },
  steps: [
    { name: "find", about: "The request paid by this Payment; none ends the run." },
    { name: "unsettle", about: "Drives `unsettle` (paid to paying)." },
    { name: "resume", about: "Resumes the request's process to wait for the Payment again." },
  ],
  reads: [table_payments, table_requests],
  writes: [table_requests],
  drives: [machine_request.t.unsettle],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "The Payment's id and its unsettle: a request already paying under that Payment is left as it is.",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
});

export const workflow_requests_lifecycle_follow_cancelled = defineWorkflow({
  id: "requests.lifecycle.follow-cancelled",
  title: "A Payment was cancelled: the request it was paying is open again",
  about:
    "Triggered by payments' `cancel`, through the outbox: the request's Payment will never move (its approval declined or " +
    "rejected, its dated payment voided or cancelled in Budgets). The request it was paying moves back through `reopen`, " +
    "so its payer can pay it again with a new attempt; its process is resumed. A Payment that only lapsed keeps the " +
    "request paying: `inbox pay --resume` retries it under the same payment id.",
  was: [`${R}/writes/approvals.ts:97`, "packages/backend/src/requests/reads/attempts.ts:62"],
  concept: concept_requests,
  priority: "normal",
  trigger: { transition: machine_payment.t.cancel },
  steps: [
    { name: "find", about: "The request paying under this Payment; none, or another current Payment, ends the run." },
    { name: "reopen", about: "Drives `reopen` (paying to open) and clears the attempt's key." },
    { name: "resume", about: "Resumes the request's process to wait for its payer again." },
  ],
  reads: [table_payments, table_requests],
  writes: [table_requests],
  drives: [machine_request.t.reopen],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "The Payment's id: a request no longer paying under that Payment is left as it is.",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
});

export const workflow_requests_deposits_auto_match = defineWorkflow({
  id: "requests.deposits.auto-match",
  title: "A deposit was credited: match it by its reference",
  about:
    "Triggered by banking's `credit`, through the outbox. When the credited deposit's payer reference (decrypted in the " +
    "backend) names exactly one open request of the deposit's owner (`by_owner_reference`) in the deposit's token for at " +
    "most its net amount, with no Payment in flight, it moves that request through `match` and marks the deposit matched " +
    "(`banking.match-deposit`, how `reference`) in one transaction, and resumes the request's process. No reference, no " +
    "request or several: it ends, and the owner matches by hand with `bank match`.",
  was: ["packages/backend/src/banking/deposits/operations/auto-match.ts:14", "packages/backend/src/requests/reads/deposits.ts:104"],
  concept: concept_requests,
  priority: "normal",
  trigger: { transition: machine_bank_deposit.t.credit },
  steps: [
    { name: "read", about: "The credited deposit: owner, token, net amount, reference, current match; already matched ends the run." },
    { name: "find", about: "The one open request its reference names, in its token, for at most its net amount; none or several ends the run." },
    { name: "match", about: "Drives `match` and invokes `banking.match-deposit` in one transaction; a refusal leaves both unmatched." },
    { name: "resume", about: "Resumes the request's process, which ends the instance." },
  ],
  reads: [table_bank_deposits, table_requests],
  writes: [table_requests],
  drives: [machine_request.t.match],
  invokes: [procedure_banking_match_deposit],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "The deposit's id: a deposit already matched, or a request already paid by it, is left as it is.",
  timeoutMs: 60_000,
  retries: { max: 5, backoff: "exponential" },
  budget: budget("background"),
});
