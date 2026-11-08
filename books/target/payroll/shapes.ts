// The Effect Schemas payroll's rpcs, flows and operations take and give. Not records: values the
// area files, flows.ts and operations.ts share, so one shape is written once.

import { Schema } from "effect";
import { AGREEMENT_KINDS, AGREEMENT_STATUSES, WRITE_CHANGES, WRITE_STATUSES } from "./data.ts";

const S = Schema.String;
const N = Schema.Number;
const Null = Schema.NullOr;
const opt = Schema.optionalKey;

export const Status = Schema.Literals(AGREEMENT_STATUSES);
export const Period = Schema.Literals(["year", "month", "week"]);
/** A rate as written: `{ amount: "180000", per: "year" }`, in whole token units with cents. */
export const Rate = Schema.Struct({ amount: S, per: Period });
/** `YYYY-MM-DD`, a day at 00:00 UTC, or an exact ISO time where the flag allows one. */
export const Day = S;

// ── inputs ──────────────────────────────────────────────────────────────────────────────────

export const OfferInput = Schema.Struct({
  orgId: S,
  /** The department's key or its `dep_…` id. */
  department: S,
  /** A person's email or an Organization's `@handle`. */
  payee: S,
  /** From the one rate flag: `--salary`, `--stream` or `--amount` (a retainer). */
  kind: Schema.Literals(["salary", "stream", "retainer"]),
  rate: Rate,
  token: opt(S),
  start: opt(Day),
  /** The last day paid, inclusive: makes the offer a fixed term. */
  end: opt(Day),
  release: opt(Schema.Literals(["monthly", "weekly", "daily", "second"])),
  expires: opt(Day),
});

export const AgreementRef = Schema.Struct({ orgId: S, agreementId: S });

export const ChangeInput = Schema.Struct({
  orgId: S,
  agreementId: S,
  rate: opt(Rate),
  /** Only for a lowering; the default is 00:00 UTC tomorrow. */
  from: opt(Day),
  /** `--cancel`: cancel the lowering that waits for its date. */
  cancel: opt(Schema.Boolean),
});

export const EndInput = Schema.Struct({ orgId: S, agreementId: S, on: Day });

export const OrgListInput = Schema.Struct({ orgId: S, department: opt(S), status: opt(Status) });

/** A payee's request; `orgId` is the payee Organization with `--org`. */
export const PayeeRef = Schema.Struct({ agreementId: S, orgId: opt(S) });
export const AcceptInput = Schema.Struct({ agreementId: S, termsHash: opt(S), orgId: opt(S) });
export const PayeeListInput = Schema.Struct({ status: opt(Status), orgId: opt(S) });

export const WriteRef = Schema.Struct({ writeId: S });

// ── outputs ─────────────────────────────────────────────────────────────────────────────────

export const Party = Schema.Struct({
  kind: Schema.Literals(["person", "organization"]),
  safe: S,
  label: Null(S),
  email: Null(S),
  handle: Null(S),
});

/** The department an agreement draws on: its budget in its one token, as Budgets answers now. */
export const Department = Schema.Struct({
  budgetId: S,
  key: S,
  name: S,
  token: S,
  budget: S,
  committed: S,
  left: S,
  /** What this write adds to or frees from the budget, and when. */
  change: opt(Schema.Struct({ adds: S, frees: S, at: Null(S) })),
});

/** An agreement as it now stands: the terms as offered, the status, and what Agreements answers now. */
export const Agreement = Schema.Struct({
  agreementId: S,
  orgId: S,
  department: Schema.Struct({ budgetId: S, key: S, name: S }),
  kind: Schema.Literals(AGREEMENT_KINDS),
  status: Status,
  payer: Schema.Struct({ orgId: S, name: S, safe: S }),
  payee: Party,
  offeredBy: Schema.Struct({ safe: S, label: Null(S) }),
  token: S,
  rate: Rate,
  release: Schema.Literals(["1mo", "7d", "1d", "1s"]),
  startsAt: Null(S),
  endsAt: Null(S),
  offerExpiresAt: S,
  acceptedAt: Null(S),
  pausedAt: Null(S),
  pendingChange: Null(Schema.Struct({ rate: Rate, effectiveAt: S })),
  terms: Schema.Struct({ documentId: S, hash: S }),
  earned: Null(S),
  collectable: Null(S),
  collected: Null(S),
  nextReleaseAt: Null(S),
  chainId: Null(S),
});

/** One row of a list, with the next command to run. */
export const AgreementRow = Schema.Struct({
  agreementId: S,
  department: S,
  payer: S,
  payee: S,
  kind: Schema.Literals(AGREEMENT_KINDS),
  token: S,
  rate: Rate,
  yearlyRate: S,
  status: Status,
  offeredBy: S,
  earned: Null(S),
  collectable: Null(S),
  collected: Null(S),
  nextReleaseAt: Null(S),
  next: Null(Schema.Array(S)),
});

/** A write as it stands, with what carries it. */
export const Write = Schema.Struct({
  writeId: S,
  agreementId: S,
  change: Schema.Literals(WRITE_CHANGES),
  status: Schema.Literals(WRITE_STATUSES),
  approvalId: Null(S),
  proposalId: Null(S),
  txHash: Null(S),
  landedAt: Null(S),
  failure: Null(S),
});

/** What a holder's or payee's prepare rpc answers: the write, the approval or proposal to sign, the agreement as it will be. */
export const Prepared = Schema.Struct({
  write: Write,
  approval: Null(Schema.Struct({ approvalId: S, url: S, expiresAt: S })),
  proposal: Null(Schema.Struct({ proposalId: S, approvalId: S, nonce: S })),
  agreement: Agreement,
  department: Null(Department),
});

/** A collection with nothing released: nothing is signed or stored. */
export const NothingReleased = Schema.Struct({
  status: Schema.Literal("nothing_released"),
  collected: Schema.Literal("0.00"),
  nextReleaseAt: Null(S),
  agreement: Agreement,
});

/** The one payment a collection made: the indexed PaymentSent that payments settles. */
export const CollectionPayment = Schema.Struct({
  /** `payment_` and the 64 hex digits of the v4 payment id the collection's PaymentSent names (payments.chain-born-ids). */
  paymentId: S,
  amount: S,
  token: S,
  from: S,
  to: S,
  txHash: S,
  periodStart: S,
  periodEnd: S,
});

/** A write followed to its end: what the write flows return without `--no-wait`. */
export const Followed = Schema.Struct({
  write: Write,
  agreement: Agreement,
  department: Null(Department),
  payment: Null(CollectionPayment),
});

/** The payslip a collection shows before it is approved, when the payer's `payslip-preview` gate is on. */
export const Payslip = Schema.Struct({
  periodStart: S,
  periodEnd: S,
  rate: Rate,
  gross: S,
  token: S,
  terms: Schema.Struct({ documentId: S, hash: S }),
});

export const PreparedCollection = Schema.Struct({
  ...Prepared.fields,
  amount: S,
  periodStart: S,
  periodEnd: S,
  payslip: Null(Payslip),
});

// ── the --json returns of the write commands ────────────────────────────────────────────────

/** Org agreement offer, change, end, pause, resume, withdraw. */
export const HolderWriteReturns = Schema.Struct({
  status: Schema.Union([Schema.Literal("awaiting_approval"), Status]),
  approvalId: S,
  agreement: Agreement,
  department: Department,
  next: Null(Schema.Array(S)),
});
