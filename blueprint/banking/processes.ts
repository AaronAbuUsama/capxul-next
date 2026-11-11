// Banking's durable work (A2, A3, P3): one process per verification, one per bank payout, one per
// bank deposit waiting for its tokens, and the one sweep P3 keeps, the Bridge catch-up. Each
// process owns its machine; the rpcs that resume it are its signals. What they wait on is their own
// timer, a person, the indexer or Bridge's events: the old minute jobs, dispatcher, timers,
// watchdog, back-off and park are gone (decision banking.processes).

import { budget, defineWorkflow } from "../../packages/blueprint-engine/src/index.ts";
import { concept_banking } from "../shared/foundation.ts";
import { integration_bridge, integration_indexer } from "../shared/external.ts";
import {
  machine_bank_deposit,
  machine_bank_payout,
  machine_verification,
  table_bank_accounts,
  table_bank_deposits,
  table_bank_payouts,
  table_bridge_sync,
  table_verification_people,
  table_verifications,
} from "./data.ts";
import { rpc_banking_verification_start } from "./verification.ts";
import { rpc_banking_accounts_remove } from "./accounts.ts";
import { rpc_banking_payouts_resolve } from "./payouts.ts";
import { APPLY, rpc_banking_inbox_receive } from "./inbox.ts";
import { table_payments } from "../payments/data.ts";
import { table_parties } from "../parties/data.ts";
import { procedure_books_record_money_fact } from "../books/procedures.ts";
import { procedure_approvals_withdraw } from "../approvals/procedures.ts";
import { table_approvals } from "../approvals/data.ts";
import { contract_erc20 } from "../shared/external.ts";
import { event_bank_account_transitioned, table_bridge_events } from "./data.ts";
import { event_payment_transitioned } from "../payments/data.ts";

const B = "packages/backend/src/banking";
const DAY = 86_400_000;
const MINUTE = 60_000;

export const workflow_banking_verification_follow = defineWorkflow({
  id: "banking.verification.follow",
  title: "One verification's way to Bridge's decision",
  about:
    "The durable process of a verification, started by its `begin`: it follows Bridge until every currency the owner " +
    "asked for has Bridge's decision. Each signal (a later `verify start`, or Bridge's customer event through the inbox) " +
    "wakes it to read the customer back from Bridge and apply that snapshot in Bridge's order, so an older snapshot " +
    "never overwrites a newer one and a replayed event changes nothing. For a business it holds the verification out of " +
    "review until every person the Director named has submitted their own details, so the business is reported " +
    "approved once. While the person is on Bridge's page (terms, liveness) its wait is the person's, never system " +
    "time. It ends at the decision or its timeout; Bridge's later changes to an ended verification (a restriction, a " +
    "correction asked) are applied by the inbox itself. Replaces old parties' snapshot recording and the business " +
    "approval claim (`businessApprovalReported`).",
  concept: concept_banking,
  priority: "normal",
  trigger: { transition: machine_verification.t.begin },
  instance: { per: table_verifications },
  signals: [rpc_banking_verification_start, rpc_banking_inbox_receive],
  waits: [
    {
      name: "bridge",
      for: "signal",
      key: [
        { on: [table_bridge_events], props: ["object_id"] },
        { on: [rpc_banking_verification_start], props: ["owner_kind", "owner_id"] },
      ],
      about: "Bridge's next customer event, from the webhook or the catch-up.",
    },
    {
      name: "person",
      for: "person",
      key: [{ on: [table_bridge_events], props: ["object_id"] }],
      about: "The person accepts Bridge's terms or does the liveness check on Bridge's own page.",
    },
    {
      name: "people",
      for: "signal",
      key: [{ on: [rpc_banking_verification_start], props: ["invitation_id"] }],
      about: "A business: each named person's own `verify start --invitation` or `invite accept`.",
    },
  ],
  steps: [
    { name: "read", about: "Read the customer back from Bridge (getVerification): the next step, the people's states, each currency's decision." },
    { name: "apply", about: "Apply the snapshot as the next transition when it is newer than `bridge_updated_at`: ask, hand_to_person, submit, approve, reject, restrict." },
    { name: "ready", about: "A business stays out of `submit` and `approve` until every named person has submitted." },
    { name: "decide", about: "End once every currency asked for is approved, rejected or restricted." },
  ],
  reads: [table_verifications, table_verification_people],
  writes: [table_verifications],
  drives: [
    machine_verification.t.ask,
    machine_verification.t.hand_to_person,
    machine_verification.t.submit,
    machine_verification.t.approve,
    machine_verification.t.reject,
    machine_verification.t.restrict,
  ],
  invokes: [],
  emits: [],
  calls: [integration_bridge.c.getVerification],
  chain: [],
  idempotency:
    "One process per verification (`verification:<verification_id>`); a snapshot not newer than `bridge_updated_at` " +
    "changes nothing, so a second run of a step, or a replayed event, is a no-op.",
  timeoutMs: 90 * DAY,
  retries: { max: 5, backoff: "exponential" },
  compensation: "None: a verification is Bridge's decision; an ended process leaves the row as Bridge last said.",
  budget: budget("background"),
  was: [
    "packages/backend/src/parties/verifications/operations/record-snapshot.ts:1",
    "packages/backend/src/parties/verifications/README.md:56",
  ],
});

export const workflow_banking_payouts_follow = defineWorkflow({
  id: "banking.payouts.follow",
  title: "One bank payout from its quote to the bank, or back to the Safe",
  about:
    "The durable process of a payout, started by its `quote`. Quoted: it waits for its Payment, which payments settles " +
    "from the indexed PaymentSent at Bridge's deposit address (payment_transitioned resumes it); a settled Payment of the " +
    "quote's token, amount and recipient funds it (`fund`), any other is `flag` funding_short. At the quote's deadline " +
    "with no settled Payment (the approval's deadline is capped at it, so nothing can land later), or when its account " +
    "is removed or deactivated first, it ends `expired` and withdraws the unsigned approval in the same transaction " +
    "(`approvals.withdraw`), so nothing is sent; a Payment cancelled or lapsed ends it the same way. In transit: Bridge's transfer events (signals from the " +
    "inbox) deliver it when Bridge names the quote's bank amount (`deliver`; another amount is delivered_amount_wrong), " +
    "or start its return (`mark_returning`); seven days with no delivery is delivery_stalled. Delivered: it stays for " +
    "the sixty days a bank can still return a payment (K13). Returning: Bridge names the refund's transaction; at " +
    "finality the indexer shows its Transfer into the source Safe, and `refund` writes it with the refund's book fact " +
    "for an Organization (`books.record-money-fact`, kind payout_returned, keyed by the Transfer, so payments' Movement " +
    "of it is the same fact, and referencing the payout's Payment, `{kind: payment, id}`, so books reads the payout and " +
    "its return as one row; the side carries the source Safe, the Transfer's log index and the sender's Party when the " +
    "directory has one, banking.payout-books); fourteen days with none is refund_missing. Bridge moving the transfer without the funding " +
    "is bridge_moved_unfunded. Needs attention: one reason, then Bridge's later events or an operator's resolution. " +
    "Replaces old banking's dispatcher, tick, watchdog and notify workflows, the payout door and its timers.",
  concept: concept_banking,
  priority: "normal",
  trigger: { transition: machine_bank_payout.t.quote },
  instance: { per: table_bank_payouts },
  signals: [rpc_banking_inbox_receive, rpc_banking_payouts_resolve, rpc_banking_accounts_remove],
  waits: [
    {
      name: "funded",
      for: "indexer",
      key: [
        { on: [event_payment_transitioned], props: ["payment_id"] },
        { on: [rpc_banking_accounts_remove], props: ["bank_account_id"] },
        { on: [event_bank_account_transitioned], props: ["bank_account_id"] },
      ],
      about:
        "Its Payment settled, cancelled or lapsed in payments (payment_transitioned, by the payout's Payment id), or its " +
        "account removed (`bank accounts remove`) or deactivated by Bridge (bank_account_transitioned, by the account's id).",
    },
    { name: "quote-deadline", for: "timer", about: "The quote's `expires_at`; unfunded then, it ends expired." },
    {
      name: "delivery",
      for: "signal",
      timeoutMs: 7 * DAY,
      key: [{ on: [table_bridge_events], props: ["object_id"] }],
      about: "Bridge's transfer events after funding: delivered, returned, refunded, cancelled, undeliverable.",
    },
    {
      name: "late-return",
      for: "signal",
      timeoutMs: 60 * DAY,
      key: [{ on: [table_bridge_events], props: ["object_id"] }],
      about: "After delivery, a bank's return that Bridge reports.",
    },
    {
      name: "refund",
      for: "indexer",
      timeoutMs: 14 * DAY,
      key: [{ on: [contract_erc20.e.Transfer], props: ["chain_id", "tx_hash", "to"] }],
      about: "The refund transaction Bridge names, its Transfer into the source Safe at finality.",
    },
    {
      name: "resolution",
      for: "person",
      key: [
        { on: [rpc_banking_payouts_resolve], props: ["owner_id", "payout_id"] },
        { on: [table_bridge_events], props: ["object_id"] },
      ],
      about: "Needs attention: an operator's resolution, or Bridge's later events.",
    },
  ],
  steps: [
    { name: "fund", about: "Read its Payment: settled with the quote's terms is `fund`; other terms `flag` funding_short; cancelled or lapsed `expire`." },
    {
      name: "expire",
      about:
        "At the deadline, or on its account's removal or deactivation while quoted: `expire`, with `approvals.withdraw` of " +
        "its approval in the same transaction. Answered `signed`, it stays quoted and follows its Payment: the signed operation may still land.",
    },
    { name: "deliver", about: "Bridge's delivered event with the quote's bank amount is `deliver`; any other amount `flag`s delivered_amount_wrong." },
    { name: "return", about: "Bridge's returned, refunded, cancelled or undeliverable event after funding is `mark_returning`, with its reason." },
    { name: "refund", about: "factsOf the refund transaction at finality: its Transfer into the source Safe is `refund`, with its book fact (Safe, log index, sender's Party)." },
    { name: "flag", about: "A limit passed, an amount wrong or Bridge moved it unfunded: `flag` with one reason." },
    { name: "resolve", about: "An operator's resolution moves it to delivered, refunded or expired and keeps who and why." },
  ],
  reads: [table_bank_payouts, table_bank_accounts, table_payments, table_approvals, table_parties],
  writes: [table_bank_payouts],
  drives: [
    machine_bank_payout.t.fund,
    machine_bank_payout.t.deliver,
    machine_bank_payout.t.mark_returning,
    machine_bank_payout.t.refund,
    machine_bank_payout.t.expire,
    machine_bank_payout.t.flag,
  ],
  invokes: [procedure_books_record_money_fact, procedure_approvals_withdraw],
  emits: [],
  calls: [integration_indexer.c.factsOf],
  chain: [],
  idempotency:
    "One process per payout (`bank-payout:<payout_id>`); each transition is guarded by the state it leaves, Bridge's " +
    "events apply only when newer than `bridge_updated_at`, and the refund's book fact is keyed by its Transfer, so a " +
    "replayed step or event is a no-op.",
  timeoutMs: 90 * DAY,
  retries: { max: 5, backoff: "exponential" },
  compensation:
    "None in Capxul: money that left the Safe is followed until it reaches the bank or comes back; what a person must " +
    "settle is `needs_attention`, never a silent end.",
  budget: budget("background"),
  was: [
    `${B}/payouts/README.md:58`,
    "docs/as-is/archive/banking/payouts.ts:621",
    "docs/as-is/archive/banking/payouts.ts:680",
    "docs/as-is/archive/banking/payouts.ts:730",
    "docs/as-is/archive/banking/payouts.ts:762",
  ],
});

export const workflow_banking_deposits_credit = defineWorkflow({
  id: "banking.deposits.credit",
  title: "Credit one bank deposit when its tokens are in the Safe",
  about:
    "Started by a deposit's `mark_arriving`, when Bridge names the transaction that sends its tokens: it cannot be a step " +
    "of the inbox's transaction, because it waits for Ponder to index that transaction at the deployment's finality " +
    "depth, which can take minutes, and must survive a crash. It reads the transaction's facts and credits the deposit " +
    "only for the exact Transfer of `net_amount` of the settlement token into the deposit's Safe; for an Organization " +
    "the credit writes the deposit's book fact in the same transaction (`books.record-money-fact`, kind " +
    "deposit_received, keyed by the Transfer, so payments' Movement of it is the same fact and books keeps one), with " +
    "the Safe, the Transfer's log index, the sender's Party when the directory has one, and `fee_raw`, the gross less " +
    "the net in the token's units when the token is the currency's own (banking.payout-books). A " +
    "transaction with no such Transfer leaves the deposit arriving and ends the process with one alert. Replaces old " +
    "banking's credit job, its reconcile pass, its back-off and park, and the staging mint (decision " +
    "banking.sandbox-deposits).",
  concept: concept_banking,
  priority: "normal",
  trigger: { transition: machine_bank_deposit.t.mark_arriving },
  instance: { per: table_bank_deposits },
  waits: [
    {
      name: "transfer",
      for: "indexer",
      timeoutMs: 2 * DAY,
      key: [{ on: [contract_erc20.e.Transfer], props: ["chain_id", "tx_hash", "to"] }],
      about: "Ponder indexes Bridge's transaction at finality.",
    },
  ],
  steps: [
    { name: "await", about: "awaitBlock of the transaction's block, retried while Ponder lags." },
    { name: "confirm", about: "factsOf the transaction: one Transfer of `net_amount` of the token into the Safe." },
    { name: "credit", about: "`credit`, and for an Organization its book fact (Safe, log index, sender's Party, fee), in one transaction." },
  ],
  reads: [table_bank_deposits, table_parties],
  writes: [table_bank_deposits],
  drives: [machine_bank_deposit.t.credit],
  invokes: [procedure_books_record_money_fact],
  emits: [],
  calls: [integration_indexer.c.awaitBlock, integration_indexer.c.factsOf],
  chain: [],
  idempotency:
    "One process per deposit (`bank-deposit:<bank_deposit_id>`); `credit` leaves only `arriving` and the book fact is " +
    "keyed by the Transfer, so a second run is a no-op.",
  timeoutMs: 2 * DAY,
  retries: { max: 10, backoff: "exponential" },
  compensation: "None: a deposit that is never credited stays arriving, visible in `bank deposits`, with its alert.",
  budget: budget("background"),
  was: [`${B}/deposits/operations/credit.ts:1`, `${B}/deposits/operations/confirm.ts:1`, "docs/as-is/archive/banking/deposits.ts:468"],
});

export const workflow_banking_inbox_catch_up = defineWorkflow({
  id: "banking.inbox.catch-up",
  title: "Bridge catch-up: read the events the webhook missed",
  about:
    "The one Bridge sweep P3 keeps. Every five minutes, one run at a time, it asks Bridge for every event after the " +
    "cursor, page by page, stores each one it does not hold and applies it as the webhook route would (the same " +
    "transitions, and the same signals to a payout's or a verification's process), then applies again the events still " +
    "pending, oldest first, moves the cursor past the last page it read, and deletes finished events older than 90 days. " +
    "A webhook delivery never moves the cursor, so a gap in deliveries is always read. Replaces old banking's catch-up with its lease and lease release, its " +
    "recovery of unprocessed rows and the inbox's back-off job.",
  concept: concept_banking,
  priority: "normal",
  trigger: { cron: "*/5 * * * *" },
  instance: "singleton",
  steps: [
    { name: "read", about: "listEvents after the cursor, a page at a time, until Bridge has no more." },
    { name: "store", about: "Store each new event encrypted by its id and apply it, one transaction per event." },
    { name: "retry", about: "Apply again the pending events, oldest first; one that still cannot apply stays pending." },
    { name: "advance", about: "Move the cursor past the last page read." },
    { name: "prune", about: "Delete applied, ignored and refused events older than 90 days: their payloads hold people's data." },
  ],
  reads: [...APPLY.reads, table_bridge_sync],
  writes: [...APPLY.writes, table_bridge_sync],
  drives: [...APPLY.drives],
  invokes: [],
  emits: [],
  calls: [integration_bridge.c.listEvents],
  chain: [],
  idempotency: "One run at a time (singleton); an event is stored once by its id, so a page read twice changes nothing.",
  timeoutMs: 4 * MINUTE,
  retries: { max: 0, backoff: "none" },
  budget: budget("background"),
  was: [`${B}/reconcile/operations/catch-up.ts:1`, `${B}/reconcile/README.md:3`, "docs/as-is/archive/banking/reconcile.ts:141"],
});
