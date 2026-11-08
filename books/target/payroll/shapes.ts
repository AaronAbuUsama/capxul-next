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

// ── Frappe HR's doctypes: the rpcs' inputs and outputs ─────────────────────────────────────
//
// The SDK speaks camelCase, as every other concept's; each field is the Frappe field of the same name
// (`dateOfJoining` is `date_of_joining`), so the head's Capxul app maps them by rule, not by hand.

const Frequency = Schema.Literals(["monthly", "fortnightly", "bimonthly", "weekly", "daily"]);
const EmploymentType = Schema.Literals(["full-time", "part-time", "contract", "intern", "apprentice", "probation", "commission", "piecework"]);
const EmployeeStatus = Schema.Literals(["active", "inactive", "suspended", "left"]);
const ComponentType = Schema.Literals(["earning", "deduction", "employer_contribution"]);
const SlipStatus = Schema.Literals(["draft", "submitted", "withheld", "paying", "escrowed", "paid", "cancelled"]);
const EntryStatus = Schema.Literals(["draft", "submitted", "paying", "paid", "cancelled"]);
/** A decimal amount at the token's display precision, as Frappe's Currency: `"4166.67"`. */
const Money = S;

export const EmployeeInput = Schema.Struct({
  orgId: S,
  /** The person's mailbox (their `personal_email`), `@handle` or Party id. */
  person: S,
  firstName: S,
  lastName: opt(S),
  dateOfJoining: Day,
  /** The department's key or `dep_…` id: the budget that pays them. */
  department: opt(S),
  designation: opt(S),
  employmentType: opt(EmploymentType),
});

export const EmployeeChange = Schema.Struct({
  orgId: S,
  employeeId: S,
  status: opt(Schema.Literals(["active", "inactive", "suspended", "left"])),
  /** With `status: left`: the last day worked, inclusive. */
  relievingDate: opt(Day),
  department: opt(S),
  designation: opt(S),
  employmentType: opt(EmploymentType),
});

export const Employee = Schema.Struct({
  employeeId: S,
  orgId: S,
  partyId: S,
  employeeName: S,
  status: EmployeeStatus,
  dateOfJoining: Day,
  relievingDate: Null(Day),
  department: Null(S),
  designation: Null(S),
  employmentType: EmploymentType,
  payeeSafe: S,
  /** True while the person has no Capxul account: pay to them waits in a claim escrow (payroll.new-hire-escrow). */
  unclaimed: Schema.Boolean,
  headName: Null(S),
});

export const EmployeeListInput = Schema.Struct({ orgId: S, department: opt(S), status: opt(EmployeeStatus) });

export const ComponentInput = Schema.Struct({
  orgId: S,
  /** An existing component's id to change it; absent to add one. */
  componentId: opt(S),
  name: S,
  abbr: S,
  type: ComponentType,
  description: opt(S),
  amount: opt(Money),
  formula: opt(S),
  condition: opt(S),
  dependsOnPaymentDays: opt(Schema.Boolean),
  statisticalComponent: opt(Schema.Boolean),
  doNotIncludeInTotal: opt(Schema.Boolean),
  isTaxApplicable: opt(Schema.Boolean),
  account: opt(S),
  liabilityAccount: opt(S),
  /** For a deduction or employer contribution: the Party it is remitted to (`@handle`, mailbox or Party id). */
  payee: opt(S),
  disabled: opt(Schema.Boolean),
});

export const Component = Schema.Struct({
  componentId: S,
  name: S,
  abbr: S,
  type: ComponentType,
  amount: Money,
  formula: Null(S),
  condition: Null(S),
  dependsOnPaymentDays: Schema.Boolean,
  statisticalComponent: Schema.Boolean,
  doNotIncludeInTotal: Schema.Boolean,
  payeePartyId: Null(S),
  portable: Schema.Boolean,
  disabled: Schema.Boolean,
});

/** A structure's row: a component by abbr, with its own amount or formula where it differs from the component's. */
export const StructureRowInput = Schema.Struct({ abbr: S, amount: opt(Money), formula: opt(S), condition: opt(S) });

export const StructureInput = Schema.Struct({
  orgId: S,
  name: S,
  payrollFrequency: Frequency,
  token: opt(S),
  earnings: Schema.Array(StructureRowInput),
  deductions: opt(Schema.Array(StructureRowInput)),
  employerContributions: opt(Schema.Array(StructureRowInput)),
  /** The structure this one replaces, which is cancelled with no assignment left on it. */
  amends: opt(S),
});

export const StructureRowOut = Schema.Struct({
  abbr: S,
  component: S,
  amount: Money,
  formula: Null(S),
  condition: Null(S),
  dependsOnPaymentDays: Schema.Boolean,
});

export const Structure = Schema.Struct({
  structureId: S,
  name: S,
  payrollFrequency: Null(Frequency),
  currency: S,
  isActive: Schema.Boolean,
  docstatus: Schema.Literals(["submitted", "cancelled"]),
  origin: Schema.Literals(["capxul", "agreement", "head"]),
  earnings: Schema.Array(StructureRowOut),
  deductions: Schema.Array(StructureRowOut),
  employerContributions: Schema.Array(StructureRowOut),
});

export const AssignmentInput = Schema.Struct({
  orgId: S,
  employeeId: S,
  structureId: S,
  fromDate: Day,
  base: Money,
  variable: opt(Money),
  /** The department budget the pay comes from; defaults to the Employee's department. */
  department: opt(S),
  payrollPayableAccount: opt(S),
});

export const Assignment = Schema.Struct({
  assignmentId: S,
  employeeId: S,
  structureId: S,
  fromDate: Day,
  base: Money,
  variable: Money,
  currency: S,
  department: S,
  agreementId: Null(S),
  docstatus: Schema.Literals(["submitted", "cancelled"]),
});

export const CancelInput = Schema.Struct({ orgId: S, structureId: opt(S), assignmentId: opt(S) });

export const StructureListInput = Schema.Struct({ orgId: S, employeeId: opt(S) });

export const RunInput = Schema.Struct({
  orgId: S,
  department: S,
  startDate: Day,
  endDate: Day,
  postingDate: opt(Day),
  payrollFrequency: Frequency,
  /** Only these Employees; absent: every active Employee of the department with an assignment in the run's token. */
  employees: opt(Schema.Array(S)),
  /** Days of leave without pay, per Employee, in the period. */
  leaveWithoutPay: opt(Schema.Array(Schema.Struct({ employeeId: S, days: N }))),
});

export const SlipRowOut = Schema.Struct({ abbr: S, component: S, amount: Money, defaultAmount: Money, source: Schema.Literals(["structure", "collection"]) });

export const Slip = Schema.Struct({
  salarySlipId: S,
  orgId: S,
  employeeId: S,
  employeeName: S,
  payrollEntryId: Null(S),
  source: Schema.Literals(["run", "collection"]),
  computedBy: Schema.Literals(["capxul", "head", "chain"]),
  startDate: Day,
  endDate: Day,
  postingDate: Day,
  totalWorkingDays: N,
  paymentDays: N,
  earnings: Schema.Array(SlipRowOut),
  deductions: Schema.Array(SlipRowOut),
  employerContributions: Schema.Array(SlipRowOut),
  grossPay: Money,
  totalDeduction: Money,
  netPay: Money,
  currency: S,
  status: SlipStatus,
  document: Null(Schema.Struct({ documentId: S, hash: S })),
  /** Once paid: the settled facts that came back from the chain. */
  paid: Null(Schema.Struct({ paymentId: S, txHash: S, blockNumber: Schema.Int, paidAt: S })),
});

export const Run = Schema.Struct({
  payrollEntryId: S,
  orgId: S,
  department: S,
  startDate: Day,
  endDate: Day,
  postingDate: Day,
  payrollFrequency: Frequency,
  currency: S,
  status: EntryStatus,
  computedBy: Schema.Literals(["capxul", "head"]),
  numberOfEmployees: Schema.Int,
  totals: Schema.Struct({ grossPay: Money, totalDeduction: Money, netPay: Money }),
  approvalId: Null(S),
  slips: Schema.Array(Slip),
});

export const RunRef = Schema.Struct({ orgId: S, payrollEntryId: S });

export const ImportInput = Schema.Struct({
  orgId: S,
  /** The head's Payroll Entry `name`. */
  headName: S,
  department: S,
  startDate: Day,
  endDate: Day,
  postingDate: Day,
  payrollFrequency: Frequency,
  slips: Schema.Array(
    Schema.Struct({
      headName: S,
      employeeId: S,
      assignmentId: S,
      totalWorkingDays: N,
      paymentDays: N,
      leaveWithoutPay: N,
      earnings: Schema.Array(Schema.Struct({ abbr: S, amount: Money, defaultAmount: Money })),
      deductions: Schema.Array(Schema.Struct({ abbr: S, amount: Money, defaultAmount: Money })),
      employerContributions: opt(Schema.Array(Schema.Struct({ abbr: S, amount: Money, defaultAmount: Money }))),
      grossPay: Money,
      totalDeduction: Money,
      netPay: Money,
    }),
  ),
});

export const WithholdInput = Schema.Struct({ orgId: S, salarySlipId: S, withhold: Schema.Boolean, reason: opt(S) });

export const RunListInput = Schema.Struct({ orgId: S, department: opt(S), status: opt(EntryStatus) });

export const RunRow = Schema.Struct({
  payrollEntryId: S,
  department: S,
  startDate: Day,
  endDate: Day,
  status: EntryStatus,
  numberOfEmployees: Schema.Int,
  netPay: Money,
  currency: S,
  next: Null(Schema.Array(S)),
});

/** The caller's own payslips, from every Organization that pays them; one slip with `salarySlipId`. */
export const MySlipsInput = Schema.Struct({ salarySlipId: opt(S), orgId: opt(S) });
