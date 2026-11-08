// The as-is book of the old banking concept: the deposits area (money that arrives by bank).
//
// Every operation registered at `banking/deposits:*` (packages/backend/convex/banking/deposits.ts),
// as the old code does it. Four are public rows of `deposits` (packages/protocol/src/banking/
// operations.ts:61). `credit` and `autoMatch` only ever run because a save scheduled them (a move to
// delivered, the minute reconcile, a confirmed credit), so they are workflows; the other internal
// queries and mutations are rpcs that the inbox, catch-up and the credit run call.
//
// How touches are booked: an internal rpc lists what its own transaction does; a neighbour's
// in-transaction function it calls is an invoke of that neighbour's procedure. A workflow lists
// what every rpc it runs touches. Matching uses Requests' door in the same transaction as the
// deposit link, and never creates a Payment.

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_banking } from "../shared/foundation.ts";
import {
  error_ACCOUNT_NOT_FOUND,
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_bank_deposit_transitioned,
} from "../shared/vocabulary.ts";
import { contract_entry_point, integration_chain_rpc, integration_ponder } from "../shared/external.ts";
import {
  machine_bank_deposit,
  machine_bank_deposit_refund,
  table_rail_deposits,
  table_rail_receiving_accounts,
} from "./data.ts";
import { procedure_parties_read_banking_verification } from "../parties/procedures.ts";
import {
  procedure_requests_match_bank_deposit_in_tx,
  procedure_requests_read_bank_deposit_match_candidates_in_tx,
  procedure_requests_read_bank_deposit_request_by_reference_in_tx,
} from "../requests/procedures.ts";
import { procedure_accounts_mint_bank_deposit_tokens } from "../accounts/procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/banking/deposits.ts`;
const B = `${BACKEND}/src/banking`;
const D = `${B}/deposits`;
const OPS = `${D}/operations`;
const ROWS = "packages/protocol/src/banking/operations.ts";
const SCHEMA = "packages/protocol/src/banking/schema.ts";

const S = Schema.String;
const N = Schema.Number;
const opt = Schema.optionalKey;

// ── shared shapes and links ─────────────────────────────────────────────────────────────────

const Actor = opt(
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal("account") }),
    Schema.Struct({ kind: Schema.Literal("org"), orgId: S }),
  ]),
);

/** `BankDepositSchema` (protocol/banking/schema.ts:73): gross bank money and the net token credit apart. */
const BankDeposit = Schema.Struct({
  bankDepositId: S,
  receivingAccountId: S,
  currency: Schema.Literals(["usd", "eur", "gbp"]),
  amount: S,
  receivedAt: N,
  sender: opt(S),
  reference: opt(S),
  status: Schema.Literals(["processing", "arriving", "credited", "returned", "below_minimum"]),
  refundState: opt(Schema.Literals(["in_flight", "done", "failed"])),
  credit: opt(
    Schema.Struct({
      amount: Schema.Struct({ asset: S, value: S }),
      symbol: Schema.Literals(["USDC", "EURC"]),
      chainId: N,
      transactionHash: S,
      movementId: S,
    }),
  ),
  match: opt(
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal("request"), requestId: S, reference: S, how: Schema.Literals(["reference", "manual"]) }),
      Schema.Struct({ kind: Schema.Literal("not_request") }),
    ]),
  ),
});
const Page = <A extends Schema.Top>(item: A) => Schema.Struct({ items: Schema.Array(item), nextCursor: Schema.NullOr(S) });

/** `errors` (protocol/banking/operations.ts:16). */
const READ_ERRORS = [
  error_NOT_AUTHENTICATED,
  error_INVALID_INPUT,
  error_ROLE_PERMISSION_DENIED,
  error_ACCOUNT_NOT_FOUND,
  error_SMART_ACCOUNT_MISSING,
  error_UNKNOWN,
  error_ENV_MISSING,
];
/** `writeErrors` (protocol/banking/operations.ts:24). */
const WRITE_ERRORS = [...READ_ERRORS, error_WRONG_STATE];

const WHO_READ =
  "A signed-in person (`signedIn`) for their own Party's deposits, or for an Organization whose Party they may read (Parties' `requireReader`).";
const WHO_WRITE =
  "A signed-in person (`signedIn`) for their own Party's deposits, or for an Organization whose Party they may manage (Parties' `requireWriter`).";

const DEPOSIT_DRIVES = [
  machine_bank_deposit.t.to_scheduled,
  machine_bank_deposit.t.to_received,
  machine_bank_deposit.t.to_in_review,
  machine_bank_deposit.t.to_sent,
  machine_bank_deposit.t.to_delivered,
  machine_bank_deposit.t.to_micro,
  machine_bank_deposit_refund.t.to_in_flight,
  machine_bank_deposit_refund.t.to_done,
  machine_bank_deposit_refund.t.to_failed,
];

const MATCH_WAS = [`${D}/writes/matching.ts:45`, `${D}/writes/matching.ts:12`, `${D}/writes/matching.ts:76`, `${D}/events/matching.ts:11`];

const Stall = Schema.Literals(["not_creditable", "mint_unrecorded", "no_transaction", "transfer_not_indexed"]);
const BackOffResult = Schema.Struct({ parked: Schema.Boolean, superseded: Schema.Boolean, attempts: N });

// ── public rpcs ─────────────────────────────────────────────────────────────────────────────

export const rpc_banking_deposits_list = defineRpc({
  id: "banking.deposits.list",
  title: "List the actor's bank deposits",
  about:
    "Row `banking.deposits.list`, registered as the public query `banking/deposits:list`. Reads the actor's Party (Parties' " +
    "`readBankingVerification`, read access), then the Party's deposits newest first, 20 a page, with `unmatched` " +
    "keeping only those with no match (a filter after the index). A cursor that does not read is INVALID_INPUT. Each " +
    "row's public status is derived (`depositStatus`); the credit shows only once credited.",
  was: [`${CONVEX}:1`, `${OPS}/list.ts:9`, `${D}/reads.ts:31`, `${D}/views.ts:7`, `${D}/rules.ts:187`, `${ROWS}:62`, `${SCHEMA}:105`],
  concept: concept_banking,
  kind: "query",
  who: WHO_READ,
  input: Schema.Struct({ actor: Actor, cursor: opt(S), unmatched: opt(Schema.Boolean) }),
  output: Page(BankDeposit),
  errors: READ_ERRORS,
  reads: [table_rail_deposits],
  writes: [],
  drives: [],
  invokes: [procedure_parties_read_banking_verification],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_deposits_get = defineRpc({
  id: "banking.deposits.get",
  title: "Read one bank deposit",
  about:
    "Row `banking.deposits.get`, registered as the public query `banking/deposits:get`: the deposit by Capxul's id when it " +
    "belongs to the actor's Party (read access), else null.",
  was: [`${CONVEX}:2`, `${OPS}/get.ts:9`, `${D}/reads.ts:20`, `${D}/views.ts:7`, `${ROWS}:71`],
  concept: concept_banking,
  kind: "query",
  who: WHO_READ,
  input: Schema.Struct({ actor: Actor, bankDepositId: S }),
  output: Schema.NullOr(BankDeposit),
  errors: READ_ERRORS,
  reads: [table_rail_deposits],
  writes: [],
  drives: [],
  invokes: [procedure_parties_read_banking_verification],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_deposits_candidates = defineRpc({
  id: "banking.deposits.candidates",
  title: "List the open Invoices a bank deposit could pay",
  about:
    "Row `banking.deposits.candidates`, registered as the public query `banking/deposits:candidates`. Needs write access " +
    "to the actor's Party. A deposit that is not the Party's is INVALID_INPUT on bankDepositId; a deposit with no asset " +
    "yet answers an empty page. Requests' `readBankDepositMatchCandidatesInTx` lists the issuer's compatible open " +
    "Invoices: fiat ones by the gross currency, asset ones by the net asset and Safe. A page that does not decode is a " +
    "defect (`orDie`, UNKNOWN); on a DevNet whose fault switch names `deposit-candidates-decode` it is built to fail.",
  was: [`${CONVEX}:12`, `${OPS}/candidates.ts:14`, `${OPS}/candidates.ts:19`, `${OPS}/candidates.ts:29`, `${OPS}/candidates.ts:41`, `${ROWS}:76`, `${SCHEMA}:109`],
  concept: concept_banking,
  kind: "query",
  who: WHO_WRITE,
  input: Schema.Struct({ actor: Actor, bankDepositId: S, cursor: opt(S) }),
  output: Page(
    Schema.Struct({
      requestId: S,
      reference: S,
      amount: Schema.Unknown,
      dueAt: N,
      payerPartyId: opt(S),
      payerLabel: opt(S),
    }),
  ),
  errors: READ_ERRORS,
  reads: [table_rail_deposits],
  writes: [],
  drives: [],
  invokes: [procedure_parties_read_banking_verification, procedure_requests_read_bank_deposit_match_candidates_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_deposits_match = defineRpc({
  id: "banking.deposits.match",
  title: "Match a bank deposit to an Invoice, or mark it not a request",
  about:
    "Row `banking.deposits.match`, registered as the public mutation `banking/deposits:match`. Needs write access to the " +
    "actor's Party; a deposit that is not the Party's is INVALID_INPUT. `matchDeposit`: the same match again returns the " +
    "deposit; another match already recorded is WRONG_STATE. A null request records `not_request`. Otherwise the deposit " +
    "must be credited with its asset facts (else WRONG_STATE) and its gross amount within two decimals (else " +
    "INVALID_INPUT); Requests' `matchBankDepositInTx` settles the Invoice in the same transaction (fiat by gross, asset by " +
    "net), the deposit records the request and reference with `how: manual`, and `bank_deposit_transitioned` (matched) " +
    "is scheduled. No Payment row is created.",
  was: [`${CONVEX}:11`, `${OPS}/match.ts:11`, `${OPS}/match.ts:16`, ...MATCH_WAS, `${ROWS}:85`],
  concept: concept_banking,
  kind: "mutation",
  who: WHO_WRITE,
  input: Schema.Struct({ actor: Actor, bankDepositId: S, requestId: Schema.NullOr(S) }),
  output: BankDeposit,
  errors: WRITE_ERRORS,
  reads: [table_rail_deposits],
  writes: [table_rail_deposits],
  drives: [],
  invokes: [procedure_parties_read_banking_verification, procedure_requests_match_bank_deposit_in_tx],
  emits: [event_bank_deposit_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

// ── internal rpcs ───────────────────────────────────────────────────────────────────────────

export const rpc_banking_deposits_record = defineRpc({
  id: "banking.deposits.record",
  title: "Apply one normalized Bridge deposit event",
  about:
    "Registered as the internal mutation `banking/deposits:record` (`recordDeposit`). Reads the receiving account Bridge's " +
    "virtual account names (none, or one with no bank rail: UNKNOWN `receivingAccountMissing`). A deposit known under " +
    "another receiving account is refused (`IDENTITY_CONFLICT`) and returned. A new deposit needs an amount and a bank " +
    "state or a refund state, else it is dropped (null); it is inserted as `bank_deposit_<ulid>` with the account's " +
    "owner, Safe, currency and token snapshot and the token's configured asset. A known deposit moves by " +
    "`transitionDeposit`; a refused event only keeps a late payer memo. An accepted event stores the net amount, the " +
    "delivered gross amount, the frozen token and asset, the Bridge tx hash, a first sender and memo, and clears the " +
    "credit back-off and park. A move or birth to delivered schedules a held credit run (`banking.deposits.credit`); a " +
    "completed refund schedules `bank_deposit_transitioned` (returned); a memo arriving on a credited deposit schedules " +
    "`banking.deposits.auto-match`.",
  was: [
    `${CONVEX}:3`,
    `${OPS}/record.ts:22`,
    `${D}/writes.ts:35`,
    `${D}/writes.ts:45`,
    `${D}/writes.ts:63`,
    `${D}/writes.ts:76`,
    `${D}/writes.ts:88`,
    `${D}/writes/record.ts:21`,
    `${D}/writes/record.ts:95`,
    `${D}/writes/record.ts:111`,
    `${D}/writes/record.ts:128`,
    `${D}/writes/schedule.ts:20`,
    `${D}/errors.ts:9`,
    `${D}/rules.ts:155`,
  ],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: the Bridge inbox's process run (`banking.webhooks.process`).",
  input: Schema.Struct({
    depositRef: S,
    railAccountRef: S,
    event: Schema.Literals([
      "deposit_scheduled",
      "deposit_received",
      "deposit_in_review",
      "deposit_sent",
      "deposit_delivered",
      "deposit_micro",
      "refund_started",
      "refund_completed",
      "refund_failed",
    ]),
    occurredAt: N,
    sequence: N,
    grossAmount: opt(S),
    netAmount: opt(S),
    bridgeTxHash: opt(S),
    sender: opt(S),
    payerReference: opt(S),
    settlementToken: opt(Schema.Literals(["usdc", "eurc"])),
  }),
  output: Schema.NullOr(Schema.Unknown),
  errors: [error_UNKNOWN],
  reads: [table_rail_receiving_accounts, table_rail_deposits],
  writes: [table_rail_deposits],
  drives: DEPOSIT_DRIVES,
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_deposits_load = defineRpc({
  id: "banking.deposits.load",
  title: "Load one bank deposit by Bridge's deposit id",
  about:
    "Registered as the internal query `banking/deposits:load` (deposits/reads.ts:51): the deposit Bridge's id names, or " +
    "null. No code in the old system runs it; it is only registered.",
  was: [`${CONVEX}:4`, `${D}/reads.ts:51`, `${D}/reads.ts:9`],
  concept: concept_banking,
  kind: "query",
  who: "internal: no caller in the old code.",
  input: Schema.Struct({ depositRef: S }),
  output: Schema.NullOr(Schema.Unknown),
  errors: [],
  reads: [table_rail_deposits],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_deposits_claim_mint = defineRpc({
  id: "banking.deposits.claim-mint",
  title: "Prepare a delivered deposit for its credit, claiming the staging mint",
  about:
    "Registered as the internal mutation `banking/deposits:claimMint` (`claimDepositMint`). A run the deposit is not held " +
    "for is `superseded`. A missing, undelivered, returned or parked deposit is not ready. Otherwise it works out the " +
    "exact net amount in the configured asset (zero or less is INVALID_INPUT; a stray failure is folded to its code; a " +
    "DevNet fault `deposit-credit-throw` throws here) and, only on staging (`SITE_URL` https://api.staging.capxul.com on " +
    "Base Sepolia), claims the one mint (`mintClaimedAt`). It writes only when the price or the claim changed. Returns " +
    "`{ ready, staging, claimed, superseded, row }`.",
  was: [`${CONVEX}:5`, `${OPS}/claim-mint.ts:6`, `${D}/writes/credit.ts:50`, `${D}/writes/credit.ts:21`, `${D}/writes/credit.ts:72`, `${D}/rules.ts:207`],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: the credit run (`banking.deposits.credit`).",
  input: Schema.Struct({ depositRef: S, runId: opt(S) }),
  output: Schema.Struct({
    ready: Schema.Boolean,
    staging: Schema.Boolean,
    claimed: Schema.Boolean,
    superseded: Schema.Boolean,
    row: Schema.NullOr(Schema.Unknown),
  }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_rail_deposits],
  writes: [table_rail_deposits],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_deposits_record_mint = defineRpc({
  id: "banking.deposits.record-mint",
  title: "Record the staging mint's transaction hash",
  about:
    "Registered as the internal mutation `banking/deposits:recordMint` (`recordDepositMint`). A deposit with no mint claim " +
    "is WRONG_STATE (unclaimed); a recorded hash that differs is INVALID_INPUT on txHash; the first hash is stored. " +
    "Returns the row.",
  was: [`${CONVEX}:6`, `${OPS}/record-mint.ts:6`, `${D}/writes/credit.ts:95`],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: the credit run, after its staging mint.",
  input: Schema.Struct({ depositRef: S, txHash: S }),
  output: Schema.NullOr(Schema.Unknown),
  errors: [error_WRONG_STATE, error_INVALID_INPUT],
  reads: [table_rail_deposits],
  writes: [table_rail_deposits],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_deposits_confirm = defineRpc({
  id: "banking.deposits.confirm",
  title: "Credit a delivered deposit from its indexed transfer",
  about:
    "Registered as the internal mutation `banking/deposits:confirm` (`confirmDeposit`). A missing, undelivered or returned " +
    "deposit is returned as it is. The hash must be the staging mint's or Bridge's (else INVALID_INPUT on txHash); an " +
    "already credited deposit is returned. Otherwise it stores the Movement (`chainMovementId`: credited), clears the " +
    "retries, schedules `bank_deposit_transitioned` (credited) and, with a payer memo, `banking.deposits.auto-match`.",
  was: [`${CONVEX}:8`, `${OPS}/confirm.ts:8`, `${D}/writes/credit.ts:123`, `${D}/writes/credit.ts:147`, `${D}/writes/credit.ts:157`, `${D}/writes/credit.ts:159`, `${D}/events.ts:77`],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: the credit run, once Ponder shows the exact transfer.",
  input: Schema.Struct({ depositRef: S, txHash: S, movementId: S }),
  output: Schema.NullOr(Schema.Unknown),
  errors: [error_INVALID_INPUT],
  reads: [table_rail_deposits],
  writes: [table_rail_deposits],
  drives: [],
  invokes: [],
  emits: [event_bank_deposit_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_deposits_reconcile = defineRpc({
  id: "banking.deposits.reconcile",
  title: "Schedule a credit run for each due delivered deposit",
  about:
    "Registered as the internal mutation `banking/deposits:reconcile` (`reconcileDeposits`). Up to 100 delivered, " +
    "uncredited, unparked deposits whose `nextAttemptAt` is due (never tried sorts first); each is held for one run " +
    "(`scheduleCredit`: a new `runId`, `nextAttemptAt` ten minutes on) and its `banking.deposits.credit` is scheduled. " +
    "Returns the count; a tick with none is a no-op.",
  was: [`${CONVEX}:9`, `${OPS}/reconcile.ts:11`, `${D}/writes/credit.ts:174`, `${D}/writes/schedule.ts:20`, `${B}/rules.ts:42`],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: the minute catch-up (`banking.reconcile.catch-up`), every tick.",
  input: Schema.Struct({}),
  output: N,
  errors: [],
  reads: [table_rail_deposits],
  writes: [table_rail_deposits],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_banking_deposits_back_off = defineRpc({
  id: "banking.deposits.back-off",
  title: "Back off a delivered deposit a credit run left uncredited",
  about:
    "Registered as the internal mutation `banking/deposits:backOff` (`backOffCredit`), attributed to the system job " +
    "`bridge_deposit_credit` (CAP-832), with the deposit's facts. A missing, undelivered, credited or parked deposit is " +
    "left. A run the deposit is not held for is `superseded`. Otherwise `afterFailure`: it waits 1, 2, 4 ... minutes, at " +
    "most an hour, or at the tenth run is parked with the reason (a stall word or the failure's code).",
  was: [`${CONVEX}:10`, `${OPS}/back-off.ts:7`, `${D}/writes/credit.ts:207`, `${D}/rules.ts:16`, `${B}/rules.ts:21`],
  concept: concept_banking,
  kind: "mutation",
  who: "internal: the credit run (`banking.deposits.credit`), after a run that did not credit.",
  input: Schema.Struct({ depositRef: S, reason: S, runId: opt(S) }),
  output: BackOffResult,
  errors: [],
  reads: [table_rail_deposits],
  writes: [table_rail_deposits],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── workflows ───────────────────────────────────────────────────────────────────────────────

export const workflow_banking_deposits_credit = defineWorkflow({
  id: "banking.deposits.credit",
  title: "Credit one delivered bank deposit",
  about:
    "Registered as the internal action `banking/deposits:credit`. Scheduled with the `runId` the deposit is held for by " +
    "every move or birth to delivered (`banking.deposits.record`), by the minute reconcile (`banking.deposits.reconcile`) " +
    "and by the DevNet seed. It runs `claim-mint` (a superseded run stops; a deposit gone, credited, parked or no longer " +
    "delivered stops). On staging with a fresh claim it mints the net raw amount of the test token into the Safe from " +
    "the faucet Safe (Accounts' `mintBankDepositTokens`: a sponsored UserOperation calling the token's open `mint`) and " +
    "runs `record-mint`; a claim with no recorded mint is `mint_unrecorded` for a person. Then it polls Ponder for the " +
    "transaction's transfers (14 s budget) and confirms the one transfer of the exact token, Safe and raw amount " +
    "(`confirm`); none is `transfer_not_indexed`. A run that leaves the deposit uncredited, with a stall word or a " +
    "failure, runs `back-off`: handled until the tenth, which parks it and fails with the failure or `creditStalled` " +
    "(UNKNOWN), one alert. Timeout is Convex's action limit; the code sets none.",
  was: [
    `${CONVEX}:7`,
    `${OPS}/credit.ts:112`,
    `${OPS}/credit.ts:26`,
    `${OPS}/credit.ts:31`,
    `${OPS}/credit.ts:48`,
    `${OPS}/credit.ts:59`,
    `${OPS}/credit.ts:67`,
    `${OPS}/credit.ts:76`,
    `${OPS}/credit.ts:78`,
    `${OPS}/credit.ts:88`,
    `${OPS}/credit.ts:133`,
    `${OPS}/credit.ts:149`,
    `${D}/rules.ts:210`,
    `${D}/errors.ts:20`,
    `${D}/external.ts:11`,
    `${D}/writes/schedule.ts:30`,
    `${BACKEND}/src/accounts/grants/external/mints.ts:84`,
    `${BACKEND}/src/accounts/grants/external/faucet.ts:150`,
    `${BACKEND}/src/integrations/ponder/pages.ts:65`,
    `${D}/README.md:17`,
  ],
  concept: concept_banking,
  priority: "critical",
  trigger: { transition: machine_bank_deposit.t.to_delivered },
  instance: { per: table_rail_deposits },
  steps: [
    { name: "claim", about: "Runs `banking.deposits.claim-mint`; superseded, gone, credited, parked or not delivered ends the run quietly." },
    { name: "ready", about: "A deposit with no exact amount or asset is `not_creditable`." },
    { name: "mint", about: "Staging with a fresh claim: mints the net raw amount from the faucet Safe and waits for its receipt." },
    { name: "record-mint", about: "Runs `banking.deposits.record-mint` with the mint's hash." },
    { name: "poll", about: "Polls Ponder's transfers of the hash (Bridge's or the mint's) within 14 s for the exact transfer." },
    { name: "confirm", about: "Runs `banking.deposits.confirm` with the hash and the transfer's Movement id." },
    { name: "back-off", about: "An uncredited run runs `banking.deposits.back-off` with its stall word or failure code; the tenth fails." },
  ],
  reads: [table_rail_deposits],
  writes: [table_rail_deposits],
  drives: [],
  invokes: [procedure_accounts_mint_bank_deposit_tokens],
  emits: [event_bank_deposit_transitioned],
  calls: [
    integration_chain_rpc.c.fetchAddressCode,
    integration_chain_rpc.c.fetchEntryPointNonce,
    integration_chain_rpc.c.fetchUserOperationFees,
    integration_chain_rpc.c.sponsorUserOperation,
    integration_chain_rpc.c.sendUserOperation,
    integration_chain_rpc.c.waitForUserOperationReceipt,
    integration_ponder.c.readTransactionFacts,
  ],
  chain: [contract_entry_point.f.getNonce],
  idempotency:
    "The deposit is held for one run (`runId`); the mint is claimed once (`mintClaimedAt`) and its hash recorded once; `confirm` credits once (`chainMovementId`).",
  timeoutMs: 600000,
  retries: { max: 9, backoff: "exponential" },
});

export const workflow_banking_deposits_auto_match = defineWorkflow({
  id: "banking.deposits.auto-match",
  title: "Match a credited deposit to an Invoice by its payer's reference",
  about:
    "Registered as the internal mutation `banking/deposits:autoMatch`. `confirm` schedules it when a deposit with a payer " +
    "memo is credited, and `record` when a memo arrives on a deposit already credited. Nothing happens for a deposit that " +
    "is gone, already matched, has no memo or is not credited, or whose memo Requests' " +
    "`readBankDepositRequestByReferenceInTx` resolves to no single Invoice of the issuer. Otherwise it matches as " +
    "`banking.deposits.match` does, `how: reference`, in the deposit owner's name, and schedules `bank_deposit_transitioned` " +
    "(matched). Timeout is Convex's mutation limit; the code sets none.",
  was: [`${CONVEX}:13`, `${OPS}/auto-match.ts:14`, `${OPS}/auto-match.ts:24`, `${OPS}/auto-match.ts:32`, `${D}/writes/credit.ts:160`, `${D}/writes/record.ts:100`, ...MATCH_WAS],
  concept: concept_banking,
  priority: "normal",
  trigger: { after: rpc_banking_deposits_confirm },
  instance: { per: table_rail_deposits },
  steps: [
    { name: "load", about: "Reads the deposit; gone, matched, memo-less or not credited ends the run." },
    { name: "find", about: "Asks Requests for the one Invoice of the issuer with this reference; none ends the run." },
    { name: "match", about: "Settles the Invoice through Requests and records the match on the deposit, in one transaction." },
  ],
  reads: [table_rail_deposits],
  writes: [table_rail_deposits],
  drives: [],
  invokes: [procedure_requests_read_bank_deposit_request_by_reference_in_tx, procedure_requests_match_bank_deposit_in_tx],
  emits: [event_bank_deposit_transitioned],
  calls: [],
  chain: [],
  idempotency: "A deposit already matched is left; `matchDeposit` returns a repeat of the same match unchanged.",
  timeoutMs: 1000,
  retries: { max: 0, backoff: "none" },
});
