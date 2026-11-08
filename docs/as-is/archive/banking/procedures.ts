// The old banking concept's door: the in-transaction functions other concepts call, as the old
// code has them (factory, branch integration/factory). Evidence, not the target design.
//
// The door is packages/backend/src/banking/index.ts, but its callers import most of these
// functions by deep path (`#banking/payouts/writes/payments`, `#banking/payouts/reads`, ...). Every
// function another concept imports from `#banking` is booked here: Payments' four payout calls and
// three payout reads, Payments' and Indexing's refund classification, Books' returned payout,
// Requests' Invoice binding, and Operator's two devnet fixtures.
//
// The payout door itself (`applyPayoutEventInTx`, payouts/writes/door.ts:223) is banking's own and
// no other concept calls it, so it is not a procedure: the four Payments calls fold its touches in.
// Each runs it with source `payments`, so it does not call Payments back
// (`applyPayoutRailDeliveryInTx`) and does not first follow Payments' funding.
//
// Work these functions do back through another concept's door that imports this file is named in
// `about` and not linked, to avoid a circular import: Payments' `readPayoutFundingInTx`, which the
// devnet payout fixture reads. A neighbour's function that does not import this file is an
// `invokes` link. What the door schedules (the dispatcher, the live timer's tick, the payer's
// notice email) is a workflow of the payouts area, named in `about`.

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";
import { concept_banking } from "../shared/foundation.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_payout_transitioned,
} from "../shared/vocabulary.ts";
import {
  machine_bank_deposit,
  machine_payout,
  table_payout_transitions,
  table_payouts,
  table_rail_deposits,
  table_rail_receiving_accounts,
} from "./data.ts";
import { table_movements } from "../payments/data.ts";
import { procedure_parties_party_by_id, procedure_parties_read_payout_account_in_tx } from "../parties/procedures.ts";
import { procedure_profiles_read_profile_party_id_in_tx } from "../profiles/procedures.ts";

const B = "packages/backend/src/banking";
const PO = `${B}/payouts`;
const PAY = "packages/backend/src/payments";

const S = Schema.String;
const N = Schema.Number;
const opt = Schema.optionalKey;
const U = Schema.Unknown;

const none = { drives: [], invokes: [], emits: [] } as const;

/** `PayoutBinding` (payouts/reads.ts:133): the Payment's binding to its payout, as Payments stored it. */
const PayoutBinding = Schema.Struct({
  quoteId: S,
  railOperationId: S,
  paymentId: S,
  commandId: S,
  partyAccountId: S,
  actorKind: Schema.Literals(["account", "organization"]),
  actorId: S,
  funding: Schema.Struct({ asset: S, value: S }),
  recipient: Schema.UndefinedOr(S),
});

const PAYOUT_DOOR =
  "Through the payout door (`applyPayoutEventInTx`, door.ts:223), with source `payments` and the payout's wall time: " +
  "`transitionPayout` decides; a move patches the payout (refused with UNKNOWN when it would break money rule M2, M3 or " +
  "M6), schedules the dispatcher for a saved Bridge call and the live timer's tick (cancelling the old timer's job), and " +
  "adds its log line, its `payout_transitioned` event and, into InTransit or Delivered, the payer's email " +
  "(`banking.payouts.notify`); a refusal adds one line. An event for no payout adds an `unknown_payout` line. After a " +
  "move it links Bridge's refund Movement (reads `movements` directly). Because the source is `payments`, the door " +
  "neither follows Payments' funding first nor calls the Payment's writer back.";

const DOOR_WAS = [`${PO}/writes/door.ts:223`, `${PO}/writes/door.ts:112`, `${PO}/writes/effects.ts:39`, `${PO}/writes/lines.ts:82`, `${PO}/writes/refunds.ts:75`];
const DOOR_READS = [table_payouts, table_movements];
const DOOR_WRITES = [table_payouts, table_payout_transitions];

// ── payout reads ────────────────────────────────────────────────────────────────────────────

export const procedure_banking_read_payout_delivery_in_tx = defineProcedure({
  id: "banking.read-payout-delivery-in-tx",
  title: "Read a payout's delivery leg",
  about:
    "What the Payment's writer and views read from the payout a Payment names (CAP-741): the leg's word (pending, done, " +
    "failed, refunded; Bridge's `delivered` counts only in Funding), how far it got (`stage`), why its Payment failed in " +
    "Bridge's spelling (`failureReason`), a needs-attention reason, the delivered bank amount and the refund Movement. " +
    "Null when the payout is not stored, a stored-row defect each caller handles. Payments' views, its rail writer and its " +
    "payout reads call it.",
  was: [
    `${PO}/reads.ts:128`,
    `${PO}/reads.ts:104`,
    `${PO}/rules/stage.ts:28`,
    `${PO}/rules/stage.ts:79`,
    `${PO}/rules/stage.ts:110`,
    `${B}/index.ts:3`,
    `${PAY}/views/payments.ts:17`,
    `${PAY}/writes/rails.ts:2`,
    `${PAY}/reads/payouts.ts:4`,
  ],
  concept: concept_banking,
  input: Schema.Struct({ railOperationId: S }),
  output: Schema.NullOr(
    Schema.Struct({
      state: Schema.Literals(["pending", "done", "failed", "refunded"]),
      stage: Schema.Literals(["quoted", "funding", "in_transit", "delivered", "needs_attention"]),
      failureReason: Schema.Literals(["bridge_returned", "bridge_refunded", "bridge_undeliverable", "bridge_error", "bridge_canceled"]),
      reason: opt(S),
      deliveredOutputValue: opt(S),
      refundMovementId: opt(S),
    }),
  ),
  errors: [],
  reads: [table_payouts],
  writes: [],
  ...none,
});

export const procedure_banking_read_payout_deadline_in_tx = defineProcedure({
  id: "banking.read-payout-deadline-in-tx",
  title: "Read an unsent payout's deadline",
  about:
    "At each authorization boundary an unsent payout needs a live quote and provider transfer. A missing payout is " +
    "UNKNOWN (`storedRowBroken` on payments.railOperationId); a payout bound to another quote, Payment, command, bank " +
    "account or payer is INVALID_INPUT on quoteId; a passed quote deadline, an expired Bridge transfer, or a failed or " +
    "refunded delivery is WRONG_STATE (method `payments.payouts.authorize`). Returns the quote's deadline translated into " +
    "the caller's backend time. Payments' payout guard and `acceptPayoutQuoteInTx` read it.",
  was: [`${PO}/reads.ts:148`, `${PO}/reads.ts:97`, `${B}/index.ts:4`, `${PAY}/guards/payouts.ts:3`, `${PO}/writes/payments.ts:79`],
  concept: concept_banking,
  input: Schema.Struct({ binding: PayoutBinding, now: N }),
  output: N,
  errors: [error_UNKNOWN, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [table_payouts],
  writes: [],
  ...none,
});

export const procedure_banking_read_payout_quote_for_payment_in_tx = defineProcedure({
  id: "banking.read-payout-quote-for-payment-in-tx",
  title: "Read the payout quote a Payment pays",
  about:
    "The stored quote (the payout opened for it) checked against the Payment: same payer, bank account and saved deal, " +
    "else INVALID_INPUT on quoteId; a passed deadline is WRONG_STATE `quote_expired` (`staleQuote`, on the payer's " +
    "prepare row); a funding asset or exact amount that differs is INVALID_INPUT; a bank account whose Bridge refs " +
    "changed is WRONG_STATE `bank_account_changed`; a failed or refunded delivery is INVALID_INPUT. Reads the bank account " +
    "through Parties' `readPayoutAccountInTx`. Stored terms that do not decode are UNKNOWN. Returns the binding terms, " +
    "recipient label and warning, funding address, Safe, locked output and deadline. Payments' personal, Organization and " +
    "payout command writers call it.",
  was: [
    `${PO}/reads/quotes.ts:19`,
    `${PO}/reads.ts:72`,
    `${PO}/errors.ts:181`,
    `${B}/index.ts:1`,
    `${PAY}/commands/writes/organizations.ts:9`,
    `${PAY}/commands/writes/payouts.ts:5`,
    `${PAY}/commands/writes/personal.ts:8`,
  ],
  concept: concept_banking,
  input: Schema.Struct({
    actor: U,
    quoteId: S,
    partyAccountId: S,
    amount: Schema.Struct({ asset: S, value: S }),
    now: N,
  }),
  output: Schema.Struct({
    quoteId: S,
    railOperationId: S,
    partyAccountId: S,
    ownerPartyId: S,
    recipientLabel: S,
    recipientOnCapxul: Schema.Boolean,
    warnRecipientOnCapxul: Schema.Boolean,
    fundingAddress: S,
    sourceSafe: S,
    requestedOutput: Schema.Struct({ currency: S, value: S, decimals: N }),
    outputExact: Schema.Boolean,
    expiresAt: N,
  }),
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_UNKNOWN],
  reads: [table_payouts],
  writes: [],
  drives: [],
  invokes: [procedure_parties_read_payout_account_in_tx],
  emits: [],
});

export const procedure_banking_read_returned_payout_payment_in_tx = defineProcedure({
  id: "banking.read-returned-payout-payment-in-tx",
  title: "Find the Payment a refund Movement returned",
  about:
    "For Books to book a return against its Payment (CAP-969): the Payment of the payout already linked to the Movement, " +
    "else of the one payout with a Payment that used the Bridge deposit address the Movement came from; null for a " +
    "source that is not an EVM address or when none or several match.",
  was: [`${PO}/reads.ts:194`, `${B}/index.ts:5`, "packages/backend/src/books/facts/writes/observed.ts:9", "packages/backend/src/books/facts/writes/outside.ts:12"],
  concept: concept_banking,
  input: Schema.Struct({ movement: Schema.Struct({ movementId: S, chainId: N, source: S }) }),
  output: Schema.NullOr(S),
  errors: [],
  reads: [table_payouts],
  writes: [],
  ...none,
});

// ── what Payments tells a payout ────────────────────────────────────────────────────────────

export const procedure_banking_bind_payout_payment_in_tx = defineProcedure({
  id: "banking.bind-payout-payment-in-tx",
  title: "Bind a payout to the Payment born for it",
  about:
    "`payment_bound`: the payout keeps the Payment and its settlement and command links (a stay in Quoted). A payout " +
    "bound to another quote, Payment, command or settlement, or a settlement that already has a payout, is INVALID_INPUT " +
    "on quoteId; a bind the door refuses after the quote's deadline is WRONG_STATE `quote_expired` (`staleQuote`), any " +
    "other refusal WRONG_STATE (`payoutSendRefused`), so the Payment's save fails and no Payment is born without its " +
    "binding. " +
    PAYOUT_DOOR,
  was: [`${PO}/writes/payments.ts:25`, `${PO}/rules/funding.ts:25`, `${PO}/errors.ts:110`, `${B}/index.ts:16`, `${PAY}/commands/writes/payouts.ts:4`, ...DOOR_WAS],
  concept: concept_banking,
  input: Schema.Struct({ quoteId: S, railOperationId: S, settlementId: S, paymentId: S, commandId: S, now: N }),
  output: Schema.Void,
  errors: [error_INVALID_INPUT, error_WRONG_STATE, error_UNKNOWN],
  reads: DOOR_READS,
  writes: DOOR_WRITES,
  drives: [],
  invokes: [],
  emits: [event_payout_transitioned],
});

export const procedure_banking_accept_payout_quote_in_tx = defineProcedure({
  id: "banking.accept-payout-quote-in-tx",
  title: "Accept a payout quote as the signed send is claimed",
  about:
    "Checks the deadline (`readPayoutDeadlineInTx`), then tells the payout what the Payment sends and where " +
    "(`send_claimed`, money rule M1): Quoted moves to Funding with `acceptedAt` and the funding watch timer. A send that " +
    "is not the deal's asset, amount or deposit address is UNKNOWN (`payoutSendMismatch`); a payout that can take no send " +
    "is WRONG_STATE (`payoutSendRefused`); a stored asset or recipient that does not read back is UNKNOWN. Either fails " +
    "the execution's claim, so nothing is sent; the refusal line rolls back with it. A claim taken again finds the payout " +
    "already holding this Payment's send and passes. Payments' execution claim calls it. " +
    PAYOUT_DOOR,
  was: [`${PO}/writes/payments.ts:78`, `${PO}/rules/funding.ts:33`, `${PO}/errors.ts:96`, `${B}/index.ts:15`, `${PAY}/executions/writes/claims.ts:12`, ...DOOR_WAS],
  concept: concept_banking,
  input: Schema.Struct({ binding: PayoutBinding, now: N }),
  output: Schema.Void,
  errors: [error_UNKNOWN, error_INVALID_INPUT, error_WRONG_STATE],
  reads: DOOR_READS,
  writes: DOOR_WRITES,
  drives: [machine_payout.t.to_Funding],
  invokes: [procedure_banking_read_payout_deadline_in_tx],
  emits: [event_payout_transitioned],
});

export const procedure_banking_payout_funding_verified_in_tx = defineProcedure({
  id: "banking.payout-funding-verified-in-tx",
  title: "Tell a payout its Payment's funding was verified",
  about:
    "`funding_verified`: Payments proved the bound Payment's funding on chain (M3). Funding, or a Quoted payout whose " +
    "proof arrived before its claim, moves to InTransit with the in-transit notice and the delivery read timer; Bridge " +
    "news the payout held applies in the same save, so it can land in Delivered, Returning or NeedsAttention. A proof " +
    "naming another Payment is refused. Payments' send verification calls it. " +
    PAYOUT_DOOR,
  was: [`${PO}/writes/payments.ts:113`, `${PO}/rules/funding.ts:97`, `${PO}/rules/funding.ts:123`, `${B}/index.ts:17`, `${PAY}/verifications/writes/sends.ts:5`, ...DOOR_WAS],
  concept: concept_banking,
  input: Schema.Struct({ railOperationId: S, paymentId: S, now: N }),
  output: Schema.Void,
  errors: [error_UNKNOWN],
  reads: DOOR_READS,
  writes: DOOR_WRITES,
  drives: [machine_payout.t.to_InTransit, machine_payout.t.to_Delivered, machine_payout.t.to_Returning, machine_payout.t.to_NeedsAttention],
  invokes: [],
  emits: [event_payout_transitioned],
});

export const procedure_banking_payout_send_failed_in_tx = defineProcedure({
  id: "banking.payout-send-failed-in-tx",
  title: "Tell a payout its Payment's send did not land",
  about:
    "`send_not_landed`: the bound Payment's send failed. A Funding payout records `sendFailedAt`, notices `failed` and " +
    "moves to Cancelling with its cancel to-do and retry timer, so the dispatcher cancels the transfer at Bridge. In any " +
    "other state the door refuses it (one line). Payments' command outcome writer calls it. " +
    PAYOUT_DOOR,
  was: [`${PO}/writes/payments.ts:132`, `${PO}/rules/funding.ts:141`, `${PO}/rules/moves.ts:175`, `${B}/index.ts:18`, `${PAY}/writes/outcomes.ts:5`, ...DOOR_WAS],
  concept: concept_banking,
  input: Schema.Struct({ railOperationId: S, now: N }),
  output: Schema.Void,
  errors: [error_UNKNOWN],
  reads: DOOR_READS,
  writes: DOOR_WRITES,
  drives: [machine_payout.t.to_Cancelling],
  invokes: [],
  emits: [event_payout_transitioned],
});

export const procedure_banking_classify_payout_refund_in_tx = defineProcedure({
  id: "banking.classify-payout-refund-in-tx",
  title: "Classify a Movement as a payout refund",
  about:
    "A return from a known Bridge deposit address is a refund even before its provider reference arrives: true when a " +
    "bound payout's route (chain, deposit address, Safe and token) matches the Movement. When Bridge named this exact " +
    "refund transaction, the payout keeps the Movement (`refundMovementId`), a write outside the door. A vanished row is " +
    "UNKNOWN. Payments' Movement window writer calls it.",
  was: [`${PO}/writes/refunds.ts:43`, `${PO}/writes/refunds.ts:13`, `${B}/index.ts:8`, `${PAY}/movements/writes/windows.ts:8`, `${B}/tables/README.md:14`],
  concept: concept_banking,
  input: Schema.Struct({ movement: U, now: N }),
  output: Schema.Boolean,
  errors: [error_UNKNOWN],
  reads: [table_payouts],
  writes: [table_payouts],
  ...none,
});

// ── devnet fixtures ─────────────────────────────────────────────────────────────────────────

export const procedure_banking_ensure_proof_payout_in_tx = defineProcedure({
  id: "banking.ensure-proof-payout-in-tx",
  title: "Write the devnet Bridge payout fixture's payout once",
  about:
    "Operator's `seedBridgePayout` fixture (CAP-670): the payout of an accepted quote bound to its funded Payment, made " +
    "as the migration makes a payout from stored facts, without a Bridge call. A payout already stored changes nothing. " +
    "Its leg is `pending`, and its funding is what Payments' `readPayoutFundingInTx` says (named here, not linked: " +
    "Payments' procedures import this file), so it is born InTransit when funded, Funding while funding, else Quoted, " +
    "with that state's timer job and one `converted` line and `payout_transitioned` event. Input `ProofPayout` " +
    "(writes/proofs.ts:12), booked as Unknown.",
  was: [`${PO}/writes/proofs.ts:42`, `${PO}/writes/conversion.ts:25`, `${PO}/rules/conversion.ts:178`, `${B}/index.ts:10`, "packages/backend/src/operator/fixtures/writes.ts:13"],
  concept: concept_banking,
  input: U,
  output: Schema.Void,
  errors: [error_UNKNOWN],
  reads: [table_payouts],
  writes: [table_payouts, table_payout_transitions],
  drives: [machine_payout.t.to_InTransit, machine_payout.t.to_Funding, machine_payout.t.to_Quoted],
  invokes: [],
  emits: [event_payout_transitioned],
});

export const procedure_banking_seed_devnet_deposit = defineProcedure({
  id: "banking.seed-devnet-deposit",
  title: "Seed a delivered bank deposit on a DevNet",
  about:
    "Operator's `operator.fixtures.seedDeposit` (CAP-788): a delivered USD deposit of 100 (net 99 USDC) for the person's " +
    "Party, so the deposit fault switches have a row to fire on, and its held credit run (`banking.deposits.credit`). " +
    "Refused unless the DevNet's fault switch names a deposit fault (NOT_AUTHENTICATED); a person with no person Party " +
    "is INVALID_INPUT on authUserId. Reads the Party through Profiles and Parties.",
  was: [`${B}/deposits/writes/devnet.ts:35`, `${B}/deposits/errors.ts:26`, `${B}/deposits/writes/schedule.ts:20`, `${B}/index.ts:22`, "packages/backend/src/operator/fixtures/operations/seed-deposit.ts:5"],
  concept: concept_banking,
  input: Schema.Struct({ authUserId: S }),
  output: Schema.Struct({ bankDepositId: S, depositRef: S, assetId: S }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN],
  reads: [],
  writes: [table_rail_deposits],
  drives: [machine_bank_deposit.t.to_delivered],
  invokes: [procedure_profiles_read_profile_party_id_in_tx, procedure_parties_party_by_id],
  emits: [],
});

// ── bank details ────────────────────────────────────────────────────────────────────────────

export const procedure_banking_require_receiving_account_for_invoice_in_tx = defineProcedure({
  id: "banking.require-receiving-account-for-invoice-in-tx",
  title: "Bind a fiat Invoice to its issuer's active bank details",
  about:
    "The receiving account a fiat Invoice is paid into must exist, belong to the Invoice issuer's Party, be active and " +
    "be in the Invoice's currency; otherwise INVALID_INPUT on receivingAccountId. Returns the account's id, owner, " +
    "currency and destination, never bank numbers. Requests' money Invoice writer calls it.",
  was: [`${B}/bank-details/reads/invoices.ts:5`, `${B}/index.ts:11`, "packages/backend/src/requests/writes/money-invoices.ts:9"],
  concept: concept_banking,
  input: Schema.Struct({ receivingAccountId: S, ownerPartyId: S, currency: S }),
  output: Schema.Struct({
    receivingAccountId: S,
    ownerPartyId: S,
    currency: S,
    destination: Schema.Struct({ chainId: N, token: Schema.Literals(["usdc", "eurc"]), address: S }),
  }),
  errors: [error_INVALID_INPUT],
  reads: [table_rail_receiving_accounts],
  writes: [],
  ...none,
});
