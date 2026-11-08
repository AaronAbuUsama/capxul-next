// The as-is book of the old banking concept: the payouts area (Bridge bank payouts and quotes).
//
// Every operation registered at `banking/payouts:*` (packages/backend/convex/banking/payouts.ts),
// and the public row `payments.quotes.quote`, which Payments' protocol declares
// (packages/protocol/src/payments/payout-operations.ts:5) but banking implements
// (packages/backend/convex/payments/quotes.ts:1 registers banking/payouts/operations/quote.ts).
// `dispatch`, `tick` and `notify` run only because a payout's saved move scheduled them, and
// `watchdog` is a cron job, so those four are workflows. `convert` is a migration a person runs by
// hand (each run schedules the next page), booked as an internal rpc. The rest are internal queries
// and mutations the quote, the dispatcher and the timers run.
//
// How touches are booked: every input reaches a payout through the door (`applyPayoutEventInTx`,
// payouts/writes/door.ts:223), which is banking's own and not a procedure, so its tables and
// transitions are folded into each rpc that runs it. When the event's source is the dispatcher or a
// webhook the door first follows Payments' funding (`readPayoutFundingInTx`), and whenever a move told
// the Payment something and the source is not Payments it calls the Payment's writer
// (`applyPayoutRailDeliveryInTx`): both are invokes of Payments' procedures. A workflow lists what
// every rpc it runs touches. Bridge calls go through the provider door; each is its own span
// `bridge <operation>` (platform/provider-observation.ts:54).

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_banking } from "../shared/foundation.ts";
import {
  error_ACCOUNT_NOT_FOUND,
  error_ENV_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_VERIFICATION_REQUIRED,
  error_WRONG_STATE,
  event_payout_transitioned,
} from "../shared/vocabulary.ts";
import { contract_erc20, integration_bridge, integration_chain_rpc, integration_mail } from "../shared/external.ts";
import {
  machine_payout,
  table_payout_transitions,
  table_payouts,
  table_quotes,
  table_rail_operations,
} from "./data.ts";
import { table_movements } from "../payments/data.ts";
import {
  procedure_payments_apply_payout_rail_delivery_in_tx,
  procedure_payments_read_payout_funding_in_tx,
} from "../payments/procedures.ts";
import {
  procedure_parties_party_by_id,
  procedure_parties_party_by_safe_address,
  procedure_parties_read_banking_verification,
  procedure_parties_read_payout_account_in_tx,
} from "../parties/procedures.ts";
import {
  procedure_accounts_read_owned_safe_addresses_in_tx,
  procedure_accounts_require_exact_account_identity_in_tx,
} from "../accounts/procedures.ts";
import { procedure_organizations_require_payroll_organization_identity_in_tx } from "../organizations/procedures.ts";
import { procedure_access_require_feature } from "../access/procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/banking/payouts.ts`;
const B = `${BACKEND}/src/banking`;
const PO = `${B}/payouts`;
const OPS = `${PO}/operations`;
const RULES = `${PO}/rules`;
const W = `${PO}/writes`;
const SPAN = `${BACKEND}/src/platform/provider-observation.ts:54`;

const S = Schema.String;
const N = Schema.Number;
const opt = Schema.optionalKey;
const U = Schema.Unknown;

const PAYOUT_STATES = [
  "Creating",
  "Quoted",
  "Funding",
  "InTransit",
  "Delivered",
  "Returning",
  "Refunded",
  "Cancelling",
  "Cancelled",
  "ClosedUnfunded",
  "Refused",
  "NeedsAttention",
] as const;
const PAYOUT_REFUSALS = [
  "stale_news",
  "duplicate_news",
  "late_answer",
  "unknown_payout",
  "field_invalid",
  "transfer_conflict",
  "not_allowed_in_state",
  "cancel_not_awaiting_funds",
  "lease_lost",
] as const;
const State = Schema.Literals(PAYOUT_STATES);
const StateOrNew = Schema.Literals([...PAYOUT_STATES, "new"]);
const Refused = Schema.Literals(PAYOUT_REFUSALS);

/** `Applied` (payouts/views.ts:134): what the door did, and what a dispatcher needs for its call. */
const Applied = Schema.Struct({
  applied: Schema.Boolean,
  refused: opt(Refused),
  state: opt(State),
  attempt: opt(N),
  firstTriedAt: opt(N),
  transferId: opt(S),
  request: opt(U),
});

/** `MoneySchema` and `AssetAmountSchema` (packages/protocol/src/money/schema.ts). */
const Money = Schema.Struct({ currency: S, value: S, decimals: N });
const AssetAmount = Schema.Struct({ asset: S, value: S });

/** `PaymentQuoteSchema` (packages/protocol/src/payments/payout-schema.ts:22): the terms the payer reads. */
const PaymentQuote = Schema.Struct({
  quoteId: S,
  partyAccountId: S,
  requestedOutput: Money,
  outputExact: Schema.Boolean,
  funding: AssetAmount,
  slippage: opt(AssetAmount),
  expiresAt: N,
  recipient: Schema.Struct({
    label: S,
    bankName: opt(S),
    last4: S,
    currency: Schema.Literals(["usd", "eur", "gbp"]),
    onCapxul: Schema.Boolean,
  }),
  rate: opt(S),
  warnings: Schema.Array(U),
});

/** `payoutBridgeRefusal` (tables/payouts.ts:77): what Bridge said when it refused the create call. */
const BridgeRefusal = Schema.Struct({ httpStatus: N, providerCode: opt(S), reason: opt(S) });

// ── the door, folded ────────────────────────────────────────────────────────────────────────

const DOOR_READS = [table_payouts, table_movements];
const DOOR_WRITES = [table_payouts, table_payout_transitions];
/** The door's call-backs into Payments, for a source that is not Payments. */
const DOOR_INVOKES = [procedure_payments_read_payout_funding_in_tx, procedure_payments_apply_payout_rail_delivery_in_tx];
const DOOR_WAS = [
  `${W}/door.ts:223`,
  `${W}/door.ts:112`,
  `${W}/door.ts:193`,
  `${W}/door.ts:249`,
  `${W}/effects.ts:39`,
  `${W}/lines.ts:82`,
  `${W}/notices.ts:30`,
  `${W}/refunds.ts:75`,
  `${PO}/writes.ts:32`,
  `${RULES}/transition.ts:123`,
  `${RULES}/transition.ts:165`,
];

/** What the door's timer and dispatcher events can move (rules/*.ts), with Payments followed first. */
const BRIDGE_AND_TIMER_DRIVES = [
  machine_payout.t.to_InTransit,
  machine_payout.t.to_Delivered,
  machine_payout.t.to_Returning,
  machine_payout.t.to_Refused,
  machine_payout.t.to_Cancelling,
  machine_payout.t.to_Cancelled,
  machine_payout.t.to_ClosedUnfunded,
  machine_payout.t.to_NeedsAttention,
];

/** `readBankingTarget` and the quote's checks (payouts/operations/prepare.ts:67). */
const PREPARE_INVOKES = [
  procedure_parties_read_banking_verification,
  procedure_accounts_require_exact_account_identity_in_tx,
  procedure_organizations_require_payroll_organization_identity_in_tx,
  procedure_access_require_feature,
  procedure_parties_read_payout_account_in_tx,
];
const PREPARE_WAS = [
  `${OPS}/prepare.ts:57`,
  `${OPS}/prepare.ts:69`,
  `${OPS}/prepare.ts:73`,
  `${OPS}/prepare.ts:78`,
  `${OPS}/prepare.ts:80`,
  `${OPS}/prepare.ts:84`,
  `${OPS}/prepare.ts:90`,
  `${OPS}/prepare.ts:99`,
  `${OPS}/prepare.ts:106`,
  `${OPS}/prepare.ts:113`,
  `${OPS}/prepare.ts:143`,
  `${PO}/rules.ts:24`,
  `${B}/bank-details/reads.ts:37`,
];

const SYSTEM_JOBS =
  "Its wide event keeps the job of its source as the actor (`bridge_payout_timer`, `bridge_payout_watchdog`, " +
  "`bridge_payout_dispatch`, else `bridge_payout_door`) and names the payer's Party beside it; only the payer's own quote names the payer.";

// ── internal rpcs ───────────────────────────────────────────────────────────────────────────

export const rpc_banking_payouts_prepare = defineRpc({
  id: "banking.payouts.prepare",
  title: "Check who may quote which bank payout, writing nothing",
  about:
    "Registered as the internal query `banking/payouts:prepare` (CAP-741). Decodes the quote input (INVALID_INPUT " +
    "`quoteInputInvalid`); resolves the payer's Party, verification and Safe (`readBankingTarget`, read access); a Safe " +
    "off Base Sepolia is INVALID_INPUT on chain; the `bank-payouts` gate must be on for the person (and Organization) " +
    "(FEATURE_NOT_AVAILABLE); the saved bank account comes from Parties' `readPayoutAccountInTx`; a payer whose Bridge " +
    "customer is not the account's, or whose people, terms or currency are not approved, is VERIFICATION_REQUIRED " +
    "(`rail: bridge`); the amount must suit the currency (`requireQuoteAmount`, INVALID_INPUT). A payout this request key " +
    "opened before (same actor) resumes with `opened: true` (other terms: INVALID_INPUT `requestKeyTermsDiffer`); " +
    "otherwise it names a new quote `quote_<ulid>` and payout `rail_operation_<ulid>`.",
  was: [`${CONVEX}:6`, ...PREPARE_WAS, `${PO}/errors.ts:143`, `${PO}/errors.ts:147`, `${PO}/errors.ts:151`, `${PO}/errors.ts:155`],
  concept: concept_banking,
  kind: "query",
  who: "internal: the quote action (`payments.quotes.quote`).",
  input: Schema.Struct({ authUserId: S, email: S, inputJson: S }),
  output: U,
  errors: [
    error_INVALID_INPUT,
    error_FEATURE_NOT_AVAILABLE,
    error_VERIFICATION_REQUIRED,
    error_ROLE_PERMISSION_DENIED,
    error_ACCOUNT_NOT_FOUND,
    error_SMART_ACCOUNT_MISSING,
    error_WRONG_STATE,
    error_UNKNOWN,
  ],
  reads: [table_payouts],
  writes: [],
  drives: [],
  invokes: PREPARE_INVOKES,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_payouts_request = defineRpc({
  id: "banking.payouts.request",
  title: "Open the quote's payout as Creating, with its saved Bridge call",
  about:
    "Registered as the internal mutation `banking/payouts:request` (CAP-739, CAP-741). A payout this request key opened " +
    "before is returned unchanged with the token it was opened with (other terms: INVALID_INPUT). EURC for a GBP account " +
    "is INVALID_INPUT. Otherwise the door's `quote_requested` opens the payout in one save: the payer, bank account, Safe, " +
    "journey, draft terms and the exact Bridge body (`payoutTransferRequest`: a fixed output, with `fundingAtMost` for a " +
    "typed source amount), a quote deadline two minutes on the wall clock, environment `sandbox`, the create to-do with " +
    "dispatch token 1, a 5-second timer and its tick job, the dispatcher scheduled, and its first line " +
    "from `new` with its `payout_transitioned`.",
  was: [`${CONVEX}:8`, `${OPS}/request.ts:30`, `${OPS}/request.ts:20`, `${OPS}/request.ts:83`, `${OPS}/request.ts:87`, `${PO}/external.ts:28`, `${W}/open.ts:15`, `${RULES}/transition.ts:16`, ...DOOR_WAS],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: the quote action (`payments.quotes.quote`).",
  input: Schema.Struct({
    quote: U,
    token: Schema.Literals(["usdc", "eurc"]),
    output: S,
    fundingAtMost: opt(S),
    draftQuoteJson: S,
  }),
  output: Schema.Struct({ quoteId: S, payoutId: S, state: StateOrNew, sourceToken: opt(Schema.Literals(["usdc", "eurc"])) }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_payouts],
  writes: DOOR_WRITES,
  drives: [machine_payout.t.to_Creating],
  invokes: [],
  emits: [event_payout_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_payouts_finalize = defineRpc({
  id: "banking.payouts.finalize",
  title: "Save Bridge's answer to the create call as the payout's deal",
  about:
    "Registered as the internal mutation `banking/payouts:finalize`, attributed to `bridge_payout_dispatch`. A missing " +
    "payout is UNKNOWN (`storedRowBroken`); one with no saved body or token is INVALID_INPUT (`fundingChoiceUnavailable`). " +
    "It completes the quote's terms from the stored draft (`quotedTerms`: Bridge's funding, its slippage at the quoted " +
    "rate, the earlier deadline; a draft that does not decode is UNKNOWN) and hands the door `bridge_answered` with the " +
    "deal: Bridge's transfer id, lowercased deposit address, funding, the locked output (the body's fixed amount, 2 " +
    "decimals) and Bridge's expiry. Before the deadline the payout moves to Quoted and saves the terms once; a late " +
    "answer cancels the transfer at once (`bridge_answered_late`); an old token is `late_answer`. Returns the state and " +
    "refusal.",
  was: [`${CONVEX}:7`, `${OPS}/finalize.ts:27`, `${OPS}/finalize.ts:51`, `${OPS}/finalize.ts:60`, `${OPS}/finalize.ts:64`, `${OPS}/finalize.ts:74`, `${PO}/rules.ts:118`, `${PO}/reads.ts:93`, `${RULES}/bridge-calls.ts:35`, ...DOOR_WAS],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: the dispatcher (`banking.payouts.dispatch`), after Bridge answered a create call.",
  input: Schema.Struct({
    payoutId: S,
    token: N,
    transferRef: S,
    fundingAddress: S,
    fundingValue: S,
    providerExpiresAt: opt(N),
  }),
  output: Schema.Struct({ state: StateOrNew, refused: opt(Refused) }),
  errors: [error_UNKNOWN, error_INVALID_INPUT],
  reads: DOOR_READS,
  writes: DOOR_WRITES,
  drives: [machine_payout.t.to_Quoted, machine_payout.t.to_Cancelling],
  invokes: DOOR_INVOKES,
  emits: [event_payout_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_payouts_outcome = defineRpc({
  id: "banking.payouts.outcome",
  title: "Read where a quote's payout stands",
  about:
    "Registered as the internal query `banking/payouts:outcome` (CAP-739): the payout's state (`new` when none), the " +
    "quote's completed terms once saved, and Bridge's refusal of the create call when it refused.",
  was: [`${CONVEX}:9`, `${OPS}/outcome.ts:25`, `${PO}/reads.ts:30`],
  concept: concept_banking,
  kind: "query",
  who: "internal: the quote action, polling while it waits for Bridge's answer.",
  input: Schema.Struct({ quoteId: S }),
  output: Schema.Struct({ state: StateOrNew, publicQuoteJson: opt(S), bridgeRefusal: opt(BridgeRefusal) }),
  errors: [],
  reads: [table_payouts],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_payouts_apply = defineRpc({
  id: "banking.payouts.apply",
  title: "Hand one action event to the payout door",
  about:
    "Registered as the internal mutation `banking/payouts:apply`, the door for an action (CAP-738): the quote's failed " +
    "balance check (a stay in Quoted that the deadline ends as `balance_check_failed`), a fired timer (`timer_fired` " +
    "with its token), the watchdog's `timer_overdue`, and the dispatcher's claim (`call_claimed`, which takes a 60-second " +
    "lease), Bridge's refusal, unusable answer or failed call, its cancel answer, and the transfer it read " +
    "(`bridge_transfer`: decoded at the Bridge door, else UNKNOWN `readTransferUnreadable`; checked against the payout " +
    "by `reportTransfer`, else PROVIDER_RESPONSE_INVALID; a transfer naming no payout is `unknown_payout`). A Refused " +
    "move keeps Bridge's refusal for the payer. Returns what the door did (`Applied`). " +
    SYSTEM_JOBS,
  was: [
    `${CONVEX}:15`,
    `${OPS}/apply.ts:48`,
    `${OPS}/apply.ts:27`,
    `${OPS}/apply.ts:36`,
    `${OPS}/apply.ts:68`,
    `${OPS}/apply.ts:83`,
    `${W}/door.ts:43`,
    `${PO}/writes.ts:202`,
    `${PO}/writes.ts:53`,
    `${PO}/errors.ts:17`,
    `${PO}/views.ts:19`,
    ...DOOR_WAS,
  ],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: the quote action (balance check), the timer tick, the watchdog and the dispatcher.",
  input: Schema.Struct({
    payoutId: S,
    event: U,
    source: Schema.Literals(["quote", "dispatcher", "webhook", "timer", "payments", "person", "watchdog", "conversion"]),
    bridgeRefusal: opt(BridgeRefusal),
  }),
  output: Applied,
  errors: [error_UNKNOWN, error_PROVIDER_RESPONSE_INVALID],
  reads: DOOR_READS,
  writes: DOOR_WRITES,
  drives: BRIDGE_AND_TIMER_DRIVES,
  invokes: DOOR_INVOKES,
  emits: [event_payout_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_payouts_overdue = defineRpc({
  id: "banking.payouts.overdue",
  title: "List the waiting payouts whose timer was lost",
  about:
    "Registered as the internal query `banking/payouts:overdue`, attributed to `bridge_payout_watchdog` (CAP-740): for each " +
    "waiting state, the payouts whose timer should have fired ten minutes ago or more, or that have none (it sorts " +
    "first), 50 at most in all. On a healthy system it finds none.",
  was: [`${CONVEX}:13`, `${OPS}/overdue.ts:16`, `${PO}/reads.ts:56`, `${RULES}/timers.ts:15`],
  concept: concept_banking,
  kind: "query",
  who: "internal: the watchdog (`banking.payouts.watchdog`).",
  input: Schema.Struct({}),
  output: Schema.Array(S),
  errors: [],
  reads: [table_payouts],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_payouts_resolve = defineRpc({
  id: "banking.payouts.resolve",
  title: "A person resolves a payout that needs attention",
  about:
    "Registered as the internal mutation `banking/payouts:resolve`, attributed to `bridge_payout_resolve` (CAP-740, " +
    "Aaron's ruling E2 of 14 Oct on CAP-725). Who and why must be 1 to 200 and 1 to 1000 characters after trimming " +
    "(INVALID_INPUT `resolutionUnnamed`). The door's `person_resolved` moves a NeedsAttention payout to the finished " +
    "state named, keeping who and why (`resolvedBy`), or to Cancelling before any send while Bridge still waits for " +
    "funds. A person's Delivered needs Capxul's funding proof and records the locked amount; an estimated deal locked " +
    "none, so it is refused. Any other answer is the door's refusal. Its wide event says `resolved_by` and " +
    "`resolution_reason`. The CLI path (CAP-753) is not in this code.",
  was: [`${CONVEX}:14`, `${OPS}/resolve.ts:33`, `${OPS}/resolve.ts:19`, `${OPS}/resolve.ts:52`, `${RULES}/attention.ts:61`, `${RULES}/attention.ts:45`, `${PO}/errors.ts:124`, ...DOOR_WAS],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: an engineer from the Convex dashboard; no session or role check in the code.",
  input: Schema.Struct({ payoutId: S, to: State, who: S, why: S }),
  output: Applied,
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: DOOR_READS,
  writes: DOOR_WRITES,
  drives: [
    machine_payout.t.to_Delivered,
    machine_payout.t.to_Refunded,
    machine_payout.t.to_Cancelled,
    machine_payout.t.to_ClosedUnfunded,
    machine_payout.t.to_Refused,
    machine_payout.t.to_Cancelling,
  ],
  invokes: [procedure_payments_apply_payout_rail_delivery_in_tx],
  emits: [event_payout_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_payouts_convert = defineRpc({
  id: "banking.payouts.convert",
  title: "Migrate stored bank legs into payouts, one page per run",
  about:
    "Registered as the internal mutation `banking/payouts:convert` (CAP-738, CAP-741), attributed to " +
    "`bridge_payout_conversion`; run by hand (`convex run banking/payouts:convert '{\"clear\":true}'` after `npx convex " +
    "export` and Aaron's go). It pages 50 retired journal rows (`railOperations`), finds each one's retired quote, and " +
    "unless the payout exists makes it from today's facts (`convertStoredLeg`, version 1, environment sandbox, the " +
    "bound Payment's funding from Payments' `readPayoutFundingInTx`): born Creating (no saved deal), Quoted, Funding, " +
    "InTransit, Delivered, Returning, Refunded or Cancelled, with that state's timer job, Bridge to-do and one " +
    "`converted` line. A leg that cannot convert (a row that does not decode, a missing quote or bound Payment) is " +
    "reported once as a defect and passed over. With `clear` it deletes both old rows of a leg that has its payout, " +
    "unless the quote's stored terms do not decode. A page that is not the last schedules the next run. Makes no Bridge call.",
  was: [
    `${CONVEX}:16`,
    `${OPS}/convert.ts:31`,
    `${OPS}/convert.ts:16`,
    `${OPS}/convert.ts:43`,
    `${OPS}/convert.ts:55`,
    `${OPS}/convert.ts:64`,
    `${W}/retired-rows.ts:149`,
    `${W}/retired-rows.ts:29`,
    `${W}/retired-rows.ts:103`,
    `${W}/retired-rows.ts:131`,
    `${W}/conversion.ts:25`,
    `${RULES}/conversion.ts:178`,
    `${RULES}/retired-rows.ts:16`,
    `${PO}/README.md:160`,
  ],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: a person runs it by hand from the Convex CLI; each run schedules the next page.",
  input: Schema.Struct({ cursor: opt(S), clear: opt(Schema.Boolean) }),
  output: Schema.Struct({ converted: N, cleared: N, broken: N, complete: Schema.Boolean }),
  errors: [error_UNKNOWN],
  reads: [table_rail_operations, table_quotes, table_payouts],
  writes: [table_rail_operations, table_quotes, table_payouts, table_payout_transitions],
  drives: [
    machine_payout.t.to_Creating,
    machine_payout.t.to_Quoted,
    machine_payout.t.to_Funding,
    machine_payout.t.to_InTransit,
    machine_payout.t.to_Delivered,
    machine_payout.t.to_Returning,
    machine_payout.t.to_Refunded,
    machine_payout.t.to_Cancelled,
  ],
  invokes: [procedure_payments_read_payout_funding_in_tx],
  emits: [event_payout_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_payouts_notice_facts = defineRpc({
  id: "banking.payouts.notice-facts",
  title: "Read what a payout's emails are built from",
  about:
    "Registered as the internal query `banking/payouts:noticeFacts` (G5): the payout's state, its Payment, the locked and " +
    "delivered amounts, the bank account's last four digits (null once the account is not active) and the payer's " +
    "mailbox: the declaring Party's email, else the email of the Party at the first Safe the person owns on the chain. " +
    "Null when no payout has the id.",
  was: [`${CONVEX}:17`, `${OPS}/notice-facts.ts:12`, `${PO}/reads/notices.ts:46`, `${PO}/reads/notices.ts:21`, `${PO}/reads/notices.ts:33`],
  concept: concept_banking,
  kind: "query",
  who: "internal: the payer's notice email run (`banking.payouts.notify`).",
  input: Schema.Struct({ payoutId: S }),
  output: Schema.NullOr(
    Schema.Struct({
      state: S,
      email: Schema.NullOr(S),
      paymentId: Schema.NullOr(S),
      accountLast4: Schema.NullOr(S),
      locked: Schema.NullOr(U),
      delivered: Schema.NullOr(U),
    }),
  ),
  errors: [],
  reads: [table_payouts],
  writes: [],
  drives: [],
  invokes: [
    procedure_parties_party_by_id,
    procedure_parties_party_by_safe_address,
    procedure_parties_read_payout_account_in_tx,
    procedure_accounts_read_owned_safe_addresses_in_tx,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── the public quote ────────────────────────────────────────────────────────────────────────

export const rpc_payments_quotes_quote = defineRpc({
  id: "payments.quotes.quote",
  title: "Quote a bank payout and wait for Bridge's terms",
  about:
    "Row `payments.quotes.quote` (Payments' protocol), registered as the public action `payments/quotes:quote` and " +
    "implemented by banking. Signed in (`signedInAction`). It runs Parties' public `parties.accounts.list` to find the " +
    "saved bank account (none: INVALID_INPUT `Save a bank account first`), checks the amount, runs Parties' internal " +
    "action `parties.accounts.register` to register the account at Bridge, then `banking.payouts.prepare`. A payout with " +
    "saved terms answers them at once. A new quote chooses its token (a typed asset, else USDC; for EUR, EURC when the " +
    "Safe holds enough), reads Bridge's rate unless it is the same money, locks the bank amount (a typed asset amount " +
    "buys its output less Bridge's 1% buffer; zero is INVALID_INPUT) and opens the payout (`banking.payouts.request`). It " +
    "polls `banking.payouts.outcome` every 250 ms for up to 35 s: terms return; Refused is Bridge's refusal (INVALID_INPUT " +
    "on amount with Bridge's reason, else PROVIDER_ERROR by status); an unusable state is PROVIDER_RESPONSE_INVALID; " +
    "Quoted with no terms is UNKNOWN; time out is PROVIDER_ERROR (timeout), and the payout keeps asking Bridge. Then it " +
    "reads the Safe's balance of the funding token: short, it tells the payout `balance_check_failed` " +
    "(`banking.payouts.apply`) and fails INSUFFICIENT_BALANCE. Touches are the internal rpcs'.",
  was: [
    `${BACKEND}/convex/payments/quotes.ts:1`,
    "packages/protocol/src/payments/payout-operations.ts:5",
    `${OPS}/quote.ts:164`,
    `${OPS}/quote.ts:169`,
    `${OPS}/quote.ts:175`,
    `${OPS}/quote.ts:180`,
    `${OPS}/quote.ts:188`,
    `${OPS}/quote.ts:195`,
    `${OPS}/quote.ts:44`,
    `${OPS}/quote.ts:103`,
    `${OPS}/quote.ts:68`,
    `${OPS}/quote.ts:41`,
    `${OPS}/quote.ts:208`,
    `${OPS}/quote.ts:217`,
    `${PO}/external.ts:7`,
    `${PO}/rules.ts:87`,
    `${BACKEND}/src/integrations/bridge/internal/create-failures.ts:15`,
    `${BACKEND}/src/integrations/bridge/internal/create-failures.ts:23`,
    `${BACKEND}/src/integrations/bridge/internal/create-failures.ts:42`,
    `${PO}/errors.ts:139`,
    `${PO}/errors.ts:167`,
    `${PO}/errors.ts:189`,
    ...PREPARE_WAS,
    SPAN,
  ],
  concept: concept_banking,
  kind: "action",
  who: "A signed-in person quoting a payout to a bank account saved for themselves or for an Organization whose Party they may read, with the `bank-payouts` gate on.",
  input: Schema.Struct({
    actor: opt(U),
    to: Schema.Struct({ partyAccountId: S }),
    amount: Schema.Union([Money, AssetAmount]),
    asset: opt(S),
    requestKey: S,
  }),
  output: PaymentQuote,
  errors: [
    error_NOT_AUTHENTICATED,
    error_INVALID_INPUT,
    error_ROLE_PERMISSION_DENIED,
    error_ACCOUNT_NOT_FOUND,
    error_SMART_ACCOUNT_MISSING,
    error_VERIFICATION_REQUIRED,
    error_INSUFFICIENT_BALANCE,
    error_WRONG_STATE,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
    error_FEATURE_NOT_AVAILABLE,
    error_UNKNOWN,
    error_ENV_MISSING,
  ],
  reads: DOOR_READS,
  writes: DOOR_WRITES,
  drives: [machine_payout.t.to_Creating],
  invokes: PREPARE_INVOKES,
  emits: [event_payout_transitioned],
  calls: [integration_bridge.c.readExchangeRate, integration_chain_rpc.c.fetchErc20Balance],
  chain: [contract_erc20.f.balanceOf],
  spans: ["convex.query", "convex.mutation", "convex.action", "bridge readExchangeRate", "chain.read eth_call"],
});

// ── workflows ───────────────────────────────────────────────────────────────────────────────

export const workflow_banking_payouts_dispatch = defineWorkflow({
  id: "banking.payouts.dispatch",
  title: "Make one Bridge call a payout saved, and bring the answer back",
  about:
    "Registered as the internal action `banking/payouts:dispatch`, attributed to `bridge_payout_dispatch` (CAP-739, " +
    "ADR-0029). The door schedules it in the save of every move that saves a Bridge call: the create to-do when the quote " +
    "opens the payout, the cancel to-do on a move to Cancelling, a retry the timer asks for, and a read (`call: read`) " +
    "after Bridge would not cancel or when a timer reads Bridge. A read with no transfer id is a defect; otherwise it " +
    "reads the transfer and hands it to `banking.payouts.apply` (`bridge_transfer`). A create or cancel first claims the " +
    "to-do's lease with its token (`call_claimed`; an old token or a held lease is `lease_lost` and nothing is sent). A " +
    "cancel deletes the transfer at Bridge (`not_awaiting_funds` is an answer, not a failure). A create sends the saved " +
    "body with the payout's id as idempotency key, so a retry replays Bridge's first answer; an answer goes to " +
    "`banking.payouts.finalize`, a failure to the door as `bridge_refused` (amount, capxul, or `key_expired` for a 422 " +
    "once the first try is 24 hours old), `bridge_answer_unusable` or `bridge_call_failed`. A payout with no saved body " +
    "is `create_answer_unreadable`. A defect is raised; other failures are logged. Timeout is Convex's action limit.",
  was: [
    `${CONVEX}:10`,
    `${OPS}/dispatch.ts:36`,
    `${OPS}/dispatch.ts:94`,
    `${OPS}/dispatch.ts:111`,
    `${OPS}/dispatch.ts:118`,
    `${OPS}/dispatch.ts:147`,
    `${OPS}/dispatch.ts:154`,
    `${OPS}/dispatch.ts:157`,
    `${OPS}/dispatch.ts:183`,
    `${PO}/external.ts:56`,
    `${PO}/external.ts:62`,
    `${PO}/external.ts:68`,
    `${RULES}/answers.ts:1`,
    `${RULES}/transition.ts:36`,
    `${W}/effects.ts:39`,
    `${PO}/README.md:48`,
    SPAN,
  ],
  concept: concept_banking,
  priority: "critical",
  trigger: { transition: machine_payout.t.to_Creating },
  instance: { per: table_payouts },
  steps: [
    { name: "attribute", about: "Records the run as `bridge_payout_dispatch` with the payout id and the call." },
    { name: "read", about: "call `read`: reads the transfer from Bridge and runs `banking.payouts.apply` with `bridge_transfer`." },
    { name: "claim", about: "Runs `banking.payouts.apply` with `call_claimed`; refused ends the run with the refusal logged." },
    { name: "cancel", about: "call `cancel`: deletes the transfer at Bridge and runs `apply` with `cancel_answered` or `bridge_call_failed`." },
    { name: "create", about: "call `create`: sends the saved body to Bridge under the payout's key." },
    { name: "answer", about: "An answer runs `banking.payouts.finalize`; a failure runs `apply` with the one event `createFailure` names." },
  ],
  reads: DOOR_READS,
  writes: DOOR_WRITES,
  drives: [machine_payout.t.to_Quoted, ...BRIDGE_AND_TIMER_DRIVES],
  invokes: DOOR_INVOKES,
  emits: [event_payout_transitioned],
  calls: [integration_bridge.c.createTransfer, integration_bridge.c.cancelTransfer, integration_bridge.c.readTransfer],
  chain: [],
  idempotency:
    "The to-do's token and lease: one claim per token; the payout's id is Bridge's idempotency key, so a repeated create gets the first transfer; the door applies an answer only while its token is current (`late_answer`).",
  timeoutMs: 600000,
  retries: { max: 0, backoff: "none" },
});

export const workflow_banking_payouts_tick = defineWorkflow({
  id: "banking.payouts.tick",
  title: "A payout's live timer fired",
  about:
    "Registered as the internal action `banking/payouts:tick`, attributed to `bridge_payout_timer` (CAP-740). The door " +
    "schedules it at the timer's wall time in the save that sets the timer, for every waiting state, and cancels the old " +
    "timer's job while it waits, so a payout has one live timer (`timerJob`). It hands `banking.payouts.apply` " +
    "`timer_fired` with the timer's token; a replaced timer is `stale_news`. By state: Creating and Cancelling ask " +
    "Bridge again or give up (create_no_answer at 23 h, cancel_failed at 24 h); Quoted cancels at its deadline with the " +
    "stage it reached; Funding follows Payments' send (`recover_send`) or gives up at 24 h as send_unknown, never " +
    "cancelling; InTransit and Returning read Bridge or give up at 7 and 14 days. On a local devnet " +
    "`CAPXUL_PAYOUT_GIVE_UP_DIVISOR` divides every give-up time. Its wide event carries `timer_purpose`, `timer_late_ms`, " +
    "`deadline_at` and `ms_to_deadline`. Timeout is Convex's action limit; the code sets none.",
  was: [
    `${CONVEX}:11`,
    `${OPS}/tick.ts:57`,
    `${OPS}/tick.ts:19`,
    `${W}/effects.ts:26`,
    `${W}/effects.ts:19`,
    `${W}/door.ts:243`,
    `${RULES}/timers.ts:20`,
    `${RULES}/timers.ts:34`,
    `${RULES}/funding.ts:85`,
    `${RULES}/funding.ts:150`,
    `${RULES}/bridge-calls.ts:76`,
    `${RULES}/delivery.ts:95`,
    `${W}/rows.ts:33`,
    `${PO}/README.md:66`,
  ],
  concept: concept_banking,
  priority: "critical",
  trigger: { transition: machine_payout.t.to_Creating },
  instance: { per: table_payouts },
  waits: [{ name: "timer", for: "timer", about: "Scheduled at the live timer's wall time (`runAtWallTime`), per the state's schedule." }],
  steps: [
    { name: "attribute", about: "Records the run as `bridge_payout_timer` with the payout, the timer and how late it ran." },
    { name: "apply", about: "Runs `banking.payouts.apply` with `timer_fired` and the timer's token; logs the new state or the refusal." },
  ],
  reads: DOOR_READS,
  writes: DOOR_WRITES,
  drives: BRIDGE_AND_TIMER_DRIVES,
  invokes: DOOR_INVOKES,
  emits: [event_payout_transitioned],
  calls: [],
  chain: [],
  idempotency: "The timer's token: a fired timer that a later move replaced is refused once as `stale_news`.",
  timeoutMs: 600000,
  retries: { max: 0, backoff: "none" },
});

export const workflow_banking_payouts_watchdog = defineWorkflow({
  id: "banking.payouts.watchdog",
  title: "Hand payouts whose timer was lost to a person, every 10 minutes",
  about:
    "Registered as the internal action `banking/payouts:watchdog`, the cron job `watch bank payout timers`, every 10 " +
    "minutes (`crons.interval`, not clock-aligned, registered unconditionally), attributed to `bridge_payout_watchdog` " +
    "(CAP-740, money rule M6). It runs `banking.payouts.overdue`, then `banking.payouts.apply` with `timer_overdue` for " +
    "each: the door checks again in its own save and moves a payout whose timer is ten minutes late or missing to " +
    "NeedsAttention `timer_lost`, once, with one alert. Its wide event counts `row_count` and `lost_timers`; a run that " +
    "found none is a no-op. Timeout is Convex's action limit; the code sets none.",
  was: [`${CONVEX}:12`, `${BACKEND}/src/platform/jobs.ts:62`, `${OPS}/watchdog.ts:21`, `${OPS}/watchdog.ts:32`, `${OPS}/watchdog.ts:35`, `${RULES}/attention.ts:131`, `${PO}/README.md:92`],
  concept: concept_banking,
  priority: "normal",
  trigger: { cron: "*/10 * * * *" },
  instance: "singleton",
  steps: [
    { name: "attribute", about: "Records the run as `bridge_payout_watchdog`." },
    { name: "overdue", about: "Runs `banking.payouts.overdue`: at most 50 waiting payouts with a late or missing timer." },
    { name: "hand-over", about: "Runs `banking.payouts.apply` with `timer_overdue` for each, counting the ones the door moved." },
  ],
  reads: [table_payouts, table_movements],
  writes: DOOR_WRITES,
  drives: [machine_payout.t.to_NeedsAttention],
  invokes: [procedure_payments_apply_payout_rail_delivery_in_tx],
  emits: [event_payout_transitioned],
  calls: [],
  chain: [],
  idempotency: "The door refuses `timer_overdue` for a payout that needs attention, has finished, or whose timer is not overdue.",
  timeoutMs: 600000,
  retries: { max: 0, backoff: "none" },
});

export const workflow_banking_payouts_notify = defineWorkflow({
  id: "banking.payouts.notify",
  title: "Email the payer that a payout is on its way or delivered",
  about:
    "Registered as the internal action `banking/payouts:notify`, attributed to `payout_notices` (G5). The door schedules it " +
    "in the save of a move into InTransit (`sent`) or Delivered (`delivered`), never for a conversion or a stay, so a " +
    "failed send never stops or repeats the move. It reads the notice facts (`banking.payouts.notice-facts`) and plans " +
    "one email (`bank-payout-sent` with the locked amount, `bank-payout-delivered` with the delivered or locked amount) " +
    "only while the payout is still in that state and has an email, a Payment and an amount. Mail delivers it; a send " +
    "the provider did not take is rescheduled after 1, then 4 minutes of business time, three attempts in all. Timeout is Convex's action limit.",
  was: [
    `${CONVEX}:18`,
    `${CONVEX}:4`,
    `${OPS}/notify.ts:21`,
    `${W}/notices.ts:22`,
    `${W}/notices.ts:30`,
    `${PO}/reads/notices.ts:71`,
    `${RULES}/notices.ts:36`,
    `${PO}/external/notices.ts:26`,
    `${BACKEND}/src/integrations/mail/notices.ts:17`,
    `${BACKEND}/src/integrations/mail/notices.ts:20`,
    `${BACKEND}/src/integrations/mail/notices.ts:163`,
  ],
  concept: concept_banking,
  priority: "low",
  trigger: { transition: machine_payout.t.to_InTransit },
  instance: { per: table_payouts },
  steps: [
    { name: "attribute", about: "Records the run as the system job `payout_notices`." },
    { name: "facts", about: "Runs `banking.payouts.notice-facts`; no payout sends nothing." },
    { name: "plan", about: "Plans the one email the event sends while the payout is still where the event put it." },
    { name: "deliver", about: "Sends it through Mail under the key `banking.payouts.notify:<payoutId>:<event>`; a refused send is rescheduled." },
  ],
  reads: [table_payouts],
  writes: [],
  drives: [],
  invokes: [
    procedure_parties_party_by_id,
    procedure_parties_party_by_safe_address,
    procedure_parties_read_payout_account_in_tx,
    procedure_accounts_read_owned_safe_addresses_in_tx,
  ],
  emits: [],
  calls: [integration_mail.c.deliverNotices],
  chain: [],
  idempotency: "The notice key per payout and event, and the facts read: a payout that has moved on sends nothing.",
  timeoutMs: 600000,
  retries: { max: 2, backoff: "exponential" },
});
