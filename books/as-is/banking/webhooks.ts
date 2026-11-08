// The as-is book of the old banking concept: the webhooks area (the Bridge inbox).
//
// Every operation registered at `banking/webhooks:*` (packages/backend/convex/banking/webhooks.ts),
// as the old code does it. `receive` is the HTTP action Bridge posts to (convex/http.ts:32); the
// others are internal. `process` runs after the insert schedules it (and when recovery reschedules a
// row), so it is a workflow; the other four are rpcs its steps and the route run.
//
// How touches are booked: an internal rpc lists what its own transaction does; a neighbour's
// in-transaction function it calls is an invoke of that neighbour's procedure. The payout door is
// banking's own (not a procedure), so its tables and transitions are folded into the rpc that runs
// it. The workflow lists what every rpc it runs touches.

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_banking } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_PROVIDER_RESPONSE_INVALID,
  error_UNKNOWN,
  event_banking_webhook_received,
  event_payout_transitioned,
} from "../shared/vocabulary.ts";
import { integration_bridge } from "../shared/external.ts";
import {
  machine_bank_deposit,
  machine_bank_deposit_refund,
  machine_bank_details,
  machine_payout,
  machine_rail_event,
  table_payout_transitions,
  table_payouts,
  table_rail_deposits,
  table_rail_events,
  table_rail_receiving_accounts,
} from "./data.ts";
import { table_movements } from "../payments/data.ts";
import {
  procedure_payments_apply_payout_rail_delivery_in_tx,
  procedure_payments_read_payout_funding_in_tx,
} from "../payments/procedures.ts";
import {
  procedure_parties_apply_bridge_account_snapshot,
  procedure_parties_apply_bridge_verification_snapshot,
} from "../parties/procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/banking/webhooks.ts`;
const B = `${BACKEND}/src/banking`;
const W = `${B}/webhooks`;
const PO = `${B}/payouts`;

const S = Schema.String;
const N = Schema.Number;
const opt = Schema.optionalKey;

/** `inboxEnvelope` (banking/model.ts:66). */
const Envelope = {
  eventId: S,
  sequence: N,
  category: S,
  type: S,
  objectRef: S,
  payloadEnc: S,
};
const Mapped = Schema.Struct({
  machine: Schema.Literals(["verification", "bank_details", "deposit", "payout", "party_account"]),
  event: S,
});
const Refusal = Schema.Struct({ code: Schema.Literal("PROVIDER_RESPONSE_INVALID"), field: S, problem: S });
const BackOffResult = Schema.Struct({ parked: Schema.Boolean, superseded: Schema.Boolean, attempts: N });

// ── Bridge's payout news through the door (folded into `record`) ─────────────────────────────

/**
 * What a payout event does through the door (payouts/writes.ts:146): the payout is read, Bridge's
 * edge checks the transfer against it (`reportTransfer`), the door follows Payments' funding first
 * (`readPayoutFundingInTx`: funding_verified or send_not_landed), then applies the news, and calls the
 * Payment's writer back when a move told the Payment something (`applyPayoutRailDeliveryInTx`).
 */
const PAYOUT_NEWS = {
  reads: [table_payouts, table_movements],
  writes: [table_payouts, table_payout_transitions],
  drives: [
    machine_payout.t.to_InTransit,
    machine_payout.t.to_Delivered,
    machine_payout.t.to_Returning,
    machine_payout.t.to_NeedsAttention,
    machine_payout.t.to_Cancelling,
    machine_payout.t.to_Cancelled,
    machine_payout.t.to_ClosedUnfunded,
  ],
  invokes: [procedure_payments_read_payout_funding_in_tx, procedure_payments_apply_payout_rail_delivery_in_tx],
} as const;

const PAYOUT_NEWS_WAS = [
  `${PO}/writes.ts:146`,
  `${PO}/writes.ts:189`,
  `${PO}/writes.ts:215`,
  `${PO}/writes.ts:127`,
  `${PO}/writes/door.ts:193`,
  `${PO}/writes/door.ts:249`,
  `${PO}/rules/news.ts:1`,
];

// ── rpcs ────────────────────────────────────────────────────────────────────────────────────

export const rpc_banking_webhooks_receive = defineRpc({
  id: "banking.webhooks.receive",
  title: "Receive one signed Bridge webhook delivery",
  about:
    "The HTTP action at POST /rails/bridge/webhook (convex/http.ts:32), attributed to the system job `bridge_webhook`. " +
    "It reads the raw body, verifies `X-Webhook-Signature` against `BRIDGE_WEBHOOK_PUBLIC_KEY` before decoding " +
    "(`verifyBridgeSignature`, local crypto, no Bridge call): a missing, malformed, stale or wrong signature stores " +
    "nothing and answers 400 `Invalid webhook signature` (INVALID_INPUT, handled as expected). It decodes the envelope " +
    "(`BridgeEventSchema`, INVALID_INPUT on `event`), encrypts the body with `bridge:<eventId>` as associated data, and runs " +
    "the internal mutation `banking.webhooks.insert`, which inserts the row and schedules its processing, or finds a " +
    "duplicate. Answers 200 `{ received: true, outcome }` for both. Any other failure answers 400 `Invalid webhook event` " +
    "for INVALID_INPUT or 503 `Webhook unavailable` (a missing key is ENV_MISSING; a crypto failure UNKNOWN). Processing " +
    "runs after the response. In `finally` it schedules `banking_webhook_received` with the signature result, the inbox " +
    "outcome and the wall-clock duration, and its wide event.",
  was: [
    `${CONVEX}:4`,
    `${BACKEND}/convex/http.ts:32`,
    `${W}/operations/receive.ts:26`,
    `${W}/operations/receive.ts:44`,
    `${W}/operations/receive.ts:50`,
    `${W}/operations/receive.ts:53`,
    `${W}/operations/receive.ts:54`,
    `${W}/operations/receive.ts:86`,
    `${W}/operations/receive.ts:93`,
    `${W}/external.ts:15`,
    `${W}/external.ts:25`,
    `${W}/external.ts:40`,
    `${W}/errors.ts:14`,
    `${W}/events.ts:7`,
    `${W}/README.md:3`,
  ],
  concept: concept_banking,
  kind: "action",
  who: "Bridge, over HTTP with a valid RSA signature; no Capxul session. Runs as the system job `bridge_webhook`.",
  input: Schema.Struct({ body: S, signature: Schema.NullOr(S) }),
  output: Schema.Struct({ received: Schema.Literal(true), outcome: Schema.Literals(["inserted", "duplicate"]) }),
  errors: [error_INVALID_INPUT, error_ENV_MISSING, error_UNKNOWN],
  reads: [table_rail_events],
  writes: [table_rail_events],
  drives: [],
  invokes: [],
  emits: [event_banking_webhook_received],
  calls: [],
  chain: [],
  spans: ["convex.mutation"],
});

export const rpc_banking_webhooks_insert = defineRpc({
  id: "banking.webhooks.insert",
  title: "Insert a Bridge event into the inbox once and schedule it",
  about:
    "Registered as the internal mutation `banking/webhooks:insert`, attributed to `bridge_inbox`. The inbox guard " +
    "(`insertEvent`): reads the row by event id; a duplicate changes nothing; a new event is inserted with its wall-clock " +
    "`receivedAt` and source, unprocessed, and its process run is scheduled at once with no `runId`. Catch-up's " +
    "`advance` runs the same guard inside its own mutation. Returns `{ outcome }`.",
  was: [`${CONVEX}:5`, `${W}/operations/insert.ts:7`, `${W}/writes.ts:23`, `${W}/writes.ts:44`],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: the webhook route (`banking.webhooks.receive`).",
  input: Schema.Struct({ ...Envelope, source: Schema.Literals(["webhook", "catch_up"]) }),
  output: Schema.Struct({ outcome: Schema.Literals(["inserted", "duplicate"]) }),
  errors: [],
  reads: [table_rail_events],
  writes: [table_rail_events],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_webhooks_load = defineRpc({
  id: "banking.webhooks.load",
  title: "Load one inbox row by Bridge event id",
  about: "Registered as the internal query `banking/webhooks:load`: the `railEvents` row for the event id, or null. The process run reads it first.",
  was: [`${CONVEX}:6`, `${W}/operations/load.ts:6`, `${W}/reads.ts:5`],
  concept: concept_banking,
  kind: "query",
  who: "internal: the process run (`banking.webhooks.process`).",
  input: Schema.Struct({ eventId: S }),
  output: Schema.NullOr(Schema.Unknown),
  errors: [],
  reads: [table_rail_events],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_webhooks_record = defineRpc({
  id: "banking.webhooks.record",
  title: "Record an inbox event as processed, applying its snapshot",
  about:
    "Registered as the internal mutation `banking/webhooks:record`, attributed to `bridge_inbox` (`recordMapping`). A " +
    "missing or already processed row is `skipped`. Without a refusal it applies a verification snapshot through " +
    "Parties (`applyBridgeVerificationSnapshot`, returning the owner it bound), decrypts the stored body for a party " +
    "account event and applies it through Parties (`applyBridgeAccountSnapshot`), and for a payout event decrypts the " +
    "body and runs Bridge's transfer through the payout door (`applyPayoutSnapshot`, source `webhook`): a transfer " +
    "naming no payout is one `unknown_payout` line; a transfer the edge refuses fails as PROVIDER_RESPONSE_INVALID; held " +
    "delivery news for a payout Capxul never sent is logged as a handled `transferStateConflict`. With a refusal it " +
    "skips the snapshots, and a payout's door logs `bridge_news_unusable` once (`refusePayoutSnapshot`). It then marks " +
    "the row processed with its outcome (refused, mapped, ignored for `kyc_link`, else unknown), mapping and refusal. A " +
    "stored body that does not decrypt or decode is UNKNOWN naming `railEvents.payloadEnc`.",
  was: [
    `${CONVEX}:8`,
    `${W}/operations/record.ts:7`,
    `${W}/writes.ts:132`,
    `${W}/writes.ts:150`,
    `${W}/writes.ts:158`,
    `${W}/writes.ts:160`,
    `${W}/writes.ts:164`,
    `${W}/writes.ts:173`,
    `${W}/external.ts:47`,
    `${W}/errors.ts:19`,
    ...PAYOUT_NEWS_WAS,
  ],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: the process run (`banking.webhooks.process`).",
  input: Schema.Struct({ eventId: S, mapped: Schema.NullOr(Mapped), verification: opt(S), refusal: opt(Refusal) }),
  output: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("skipped") }),
    Schema.Struct({ kind: Schema.Literal("refused") }),
    Schema.Struct({ kind: Schema.Literal("recorded"), owner: Schema.Unknown }),
  ]),
  errors: [error_UNKNOWN, error_ENV_MISSING, error_PROVIDER_RESPONSE_INVALID],
  reads: [table_rail_events, ...PAYOUT_NEWS.reads],
  writes: [table_rail_events, ...PAYOUT_NEWS.writes],
  drives: [
    machine_rail_event.t.to_mapped,
    machine_rail_event.t.to_ignored,
    machine_rail_event.t.to_unknown,
    machine_rail_event.t.to_refused,
    ...PAYOUT_NEWS.drives,
  ],
  invokes: [
    procedure_parties_apply_bridge_verification_snapshot,
    procedure_parties_apply_bridge_account_snapshot,
    ...PAYOUT_NEWS.invokes,
  ],
  emits: [event_payout_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_webhooks_back_off = defineRpc({
  id: "banking.webhooks.back-off",
  title: "Back off an inbox row whose process run failed",
  about:
    "Registered as the internal mutation `banking/webhooks:backOff`, attributed to `bridge_inbox` (`backOffEvent`). A " +
    "missing, processed or parked row is left as it is. A run the row is not held for (`runId` differs) is `superseded` " +
    "and uses up no retry. Otherwise `afterFailure`: the row waits 1, 2, 4 ... minutes (at most an hour) with " +
    "`nextAttemptAt`, or at its tenth failure is parked with the failure's code as `parkReason`; either way the hold " +
    "(`runId`) is cleared. Its wide event carries `retry_attempts`, `retry_reason` and `next_attempt_at` or `parked`.",
  was: [`${CONVEX}:9`, `${W}/operations/back-off.ts:6`, `${W}/writes.ts:72`, `${B}/rules.ts:21`, `${B}/rules.ts:10`],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: the process run (`banking.webhooks.process`) after a failure that is not a refusal.",
  input: Schema.Struct({ eventId: S, reason: S, runId: opt(S) }),
  output: BackOffResult,
  errors: [],
  reads: [table_rail_events],
  writes: [table_rail_events],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── the intake workflow ─────────────────────────────────────────────────────────────────────

export const workflow_banking_webhooks_process = defineWorkflow({
  id: "banking.webhooks.process",
  title: "Process one Bridge inbox row",
  about:
    "Registered as the internal action `banking/webhooks:process`, attributed to `bridge_inbox`. The insert schedules it " +
    "at once with no `runId`; catch-up's recovery scan reschedules a lost or due row with the `runId` it holds the row " +
    "for. It loads the row and returns when it is gone, processed or parked, and does nothing (`retry_run: superseded`) " +
    "unless the row is held for this run. It decrypts the body, maps it at the Bridge door (`adaptBridgeEvent`) and reads " +
    "its objects there: a verification snapshot, a deposit (`depositEvent`, normalized by `depositOf`), or a virtual " +
    "account activity (`accountActivityEvent`). An object the door refuses (PROVIDER_RESPONSE_INVALID) is recorded once " +
    "as `refused` and the run fails once with it, one alert; recovery never schedules it again. An account `updated` " +
    "point first loads the bank details by Bridge account (none: UNKNOWN `bankDetailsMissing`) and reads Bridge back " +
    "(`refreshVirtualAccount`); a lifecycle point runs `banking.bank-details.apply-lifecycle` in the background; a " +
    "deposit runs `banking.deposits.record`; then `banking.webhooks.record` marks the row. A payout body the edge refuses " +
    "at record is recorded as a refusal the same way. Any other failure runs `banking.webhooks.back-off`: a handled " +
    "failure until the tenth, which fails the run with its cause (one alert). A back-off that cannot be written fails " +
    "the run with both causes. Timeout is Convex's action limit; the code sets none.",
  was: [
    `${CONVEX}:7`,
    `${W}/operations/process.ts:201`,
    `${W}/operations/process.ts:213`,
    `${W}/operations/process.ts:216`,
    `${W}/operations/process.ts:217`,
    `${W}/operations/process.ts:91`,
    `${W}/operations/process.ts:71`,
    `${W}/operations/process.ts:53`,
    `${W}/operations/process.ts:99`,
    `${W}/operations/process.ts:112`,
    `${W}/operations/process.ts:130`,
    `${W}/operations/process.ts:140`,
    `${W}/operations/process.ts:148`,
    `${W}/operations/process.ts:168`,
    `${W}/errors.ts:26`,
    `${W}/writes.ts:38`,
    `${B}/reconcile/writes.ts:212`,
    `${B}/bank-details/rules.ts:149`,
    `${B}/bank-details/external.ts:154`,
    `${B}/deposits/rules.ts:127`,
    `${W}/README.md:5`,
  ],
  concept: concept_banking,
  priority: "critical",
  trigger: { after: rpc_banking_webhooks_insert },
  instance: { per: table_rail_events },
  steps: [
    { name: "attribute", about: "Records the run as the system job `bridge_inbox` with the event id." },
    { name: "load", about: "Runs `banking.webhooks.load`; a missing, processed or parked row ends the run." },
    { name: "hold", about: "A run whose `runId` is not the row's ends with `retry_run: superseded`." },
    { name: "decrypt", about: "Decrypts and decodes the stored body; a failure is UNKNOWN on `railEvents.payloadEnc`, or the key reader's ENV_MISSING." },
    { name: "map", about: "Maps the event at the Bridge door to a machine and event, or none." },
    { name: "read-objects", about: "Decodes a verification snapshot, a deposit or an account activity at the Bridge door; a refusal records the row `refused` and fails the run." },
    { name: "readback", about: "For an `updated` account point: loads the bank details by Bridge account and reads Bridge's account and newest history back." },
    { name: "lifecycle", about: "Runs `banking.bank-details.apply-lifecycle` with `background: true` and the readback's payloads when present." },
    { name: "deposit", about: "Runs `banking.deposits.record` with the normalized deposit event." },
    { name: "record", about: "Runs `banking.webhooks.record`; for a payout a refusal of the body is recorded as `refused` instead." },
    { name: "observe", about: "Names the deposit's or the verification owner's person, journey and correlation on the wide event." },
    { name: "back-off", about: "Any other failure runs `banking.webhooks.back-off` and is handled, or at the tenth fails the run." },
  ],
  reads: [table_rail_events, table_rail_receiving_accounts, table_rail_deposits, ...PAYOUT_NEWS.reads],
  writes: [table_rail_events, table_rail_receiving_accounts, table_rail_deposits, ...PAYOUT_NEWS.writes],
  drives: [
    machine_rail_event.t.to_mapped,
    machine_rail_event.t.to_ignored,
    machine_rail_event.t.to_unknown,
    machine_rail_event.t.to_refused,
    machine_bank_details.t.to_active,
    machine_bank_details.t.to_deactivated,
    machine_bank_details.t.to_closed,
    machine_bank_deposit.t.to_scheduled,
    machine_bank_deposit.t.to_received,
    machine_bank_deposit.t.to_in_review,
    machine_bank_deposit.t.to_sent,
    machine_bank_deposit.t.to_delivered,
    machine_bank_deposit.t.to_micro,
    machine_bank_deposit_refund.t.to_in_flight,
    machine_bank_deposit_refund.t.to_done,
    machine_bank_deposit_refund.t.to_failed,
    ...PAYOUT_NEWS.drives,
  ],
  invokes: [
    procedure_parties_apply_bridge_verification_snapshot,
    procedure_parties_apply_bridge_account_snapshot,
    ...PAYOUT_NEWS.invokes,
  ],
  emits: [event_payout_transitioned],
  calls: [integration_bridge.c.readVirtualAccount, integration_bridge.c.readVirtualAccountHistory],
  chain: [],
  idempotency:
    "The inbox row is processed once: a run finds it processed or parked and stops; only the run it is held for (`runId`) acts or backs it off; `record` skips a processed row; the payout door refuses stale or duplicate news.",
  timeoutMs: 600000,
  retries: { max: 9, backoff: "exponential" },
});

