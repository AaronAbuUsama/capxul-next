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

/**
 * `org hr employee add <person> --first-name --joined <day> [--last-name] [--department] [--designation] [--type]`.
 * The CLI's flags name these fields: `--joined` is `dateOfJoining`, `--type` is `employmentType`; `--last-name` is
 * optional, as Frappe's `last_name` is (payroll.command-fit).
 */
export const EmployeeInput = Schema.Struct({
  orgId: S,
  /** The person, a Party as the grammar names one: their mailbox (their `personal_email`), `@handle`, Safe address or Party id. */
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

/** `org hr employee list [--department] [--status] [--after] [--limit]`: one page, as every list (payroll.command-fit). */
export const EmployeeListInput = Schema.Struct({ orgId: S, department: opt(S), status: opt(EmployeeStatus), after: opt(S), limit: opt(Schema.Int) });

/** `org hr employee get|suspend|deactivate|reinstate <employee>`: the Employee by its `emp_` id. */
export const EmployeeRef = Schema.Struct({ orgId: S, employeeId: S });
/** `org hr employee change <employee> [--department] [--designation] [--type]`: its fields only, never its status (a
 * status is a lifecycle verb); `--type` is `employmentType`. */
export const EmployeeEdit = Schema.Struct({
  orgId: S,
  employeeId: S,
  department: opt(S),
  designation: opt(S),
  employmentType: opt(EmploymentType),
});
/** `org hr employee leave <employee> --on <day>`: the last day worked; `confirm` true from a script (`--confirm`), with no preview. */
export const EmployeeLeave = Schema.Struct({ orgId: S, employeeId: S, relievingDate: Day, confirm: opt(Schema.Boolean) });

/** A component's fields as `org payroll component add` and `change` set them; on a change every one is optional.
 * The flags: `--payment-days` is `dependsOnPaymentDays`, `--statistical` `statisticalComponent`, `--not-in-total`
 * `doNotIncludeInTotal`, `--taxable` `isTaxApplicable` (each off unless given: payroll.component-defaults),
 * `--liability-account` `liabilityAccount`; the rest by their own names. */
const COMPONENT_FIELDS = {
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
  /** For a deduction or employer contribution: the Party its liability is owed to (`@handle`, mailbox or Party id). */
  payee: opt(S),
} as const;

/** `org payroll component add <name> --abbr --type (--amount | --formula) …`. */
export const ComponentAddInput = Schema.Struct({ orgId: S, name: S, abbr: S, type: ComponentType, ...COMPONENT_FIELDS });
/** `org payroll component change <component> …`: the component by its `sc_` id or abbreviation, and the fields given. */
export const ComponentChangeInput = Schema.Struct({ orgId: S, component: S, name: opt(S), abbr: opt(S), ...COMPONENT_FIELDS });
/** `org payroll component disable|enable <component>`. */
export const ComponentRef = Schema.Struct({ orgId: S, component: S });

export const ComponentInput = Schema.Struct({
  orgId: S,
  /** An existing component's `sc_` id or abbreviation, to change it; absent to add one. */
  componentId: opt(S),
  /** Required to add one (with `abbr`, `type`, and an `amount` or a `formula`); on a change, only the fields given change. */
  name: opt(S),
  abbr: opt(S),
  type: opt(ComponentType),
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
  /** For a deduction or employer contribution: the Party its liability is owed to (`@handle`, mailbox or Party id). */
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

/**
 * `org payroll structure create <name> --frequency --token --earning <abbr>[=<amount|formula>]… [--deduction …]…
 * [--contribution …]… [--amends <structure>]`: `--frequency` is `payrollFrequency`; each `--earning`, `--deduction` and
 * `--contribution` is one row of `earnings`, `deductions` and `employerContributions`, in the order given, its value
 * after `=` the row's amount when it is a decimal and its formula otherwise.
 */
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

/** `org payroll structure assign <structure> <employee> --start <day> --base [--variable] [--department]
 * [--payable-account]`: `--start` is `fromDate`, `--payable-account` `payrollPayableAccount`. */
export const AssignmentInput = Schema.Struct({
  orgId: S,
  employeeId: S,
  structureId: S,
  fromDate: Day,
  base: Money,
  variable: opt(Money),
  /** The Employee's department, which a run of it pays them from; when given it must be theirs (payroll.run-employees). */
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

/** One Employee as `org hr employee get` prints it, and every Employee write after its change (G9): the record and the
 * submitted assignment that pays them today, or null (payroll.command-fit). */
export const EmployeeView = Schema.Struct({ employee: Employee, assignment: Null(Assignment) });

export const CancelInput = Schema.Struct({ orgId: S, structureId: opt(S), assignmentId: opt(S) });
/** `org payroll structure cancel <structure>`. */
export const StructureRef = Schema.Struct({ orgId: S, structureId: S });
/** `org payroll structure unassign <assignment>`. */
export const AssignmentRef = Schema.Struct({ orgId: S, assignmentId: S });

export const StructureListInput = Schema.Struct({ orgId: S, employeeId: opt(S) });

/** A page of a list, as every list's (G5, G9): at most `limit` (1 to 100, 25 by default) after the cursor `after`. */
const PAGE = { after: opt(S), limit: opt(Schema.Int) } as const;
/** `org payroll component list [--after] [--limit]`. */
export const ComponentListInput = Schema.Struct({ orgId: S, ...PAGE });
/** `org payroll structure list [--employee <employee>] [--after] [--limit]`. */
export const StructurePageInput = Schema.Struct({ orgId: S, employeeId: opt(S), ...PAGE });
/** One submitted structure as `org payroll structure list` prints it: its rows and the assignments that name it. */
export const StructureListed = Schema.Struct({ ...Structure.fields, assignments: Schema.Array(Assignment) });

/** `org payroll run create <department> --start --end [--posting] [--frequency] [--employee <employee>]…`: `--start`
 * and `--end` are `startDate` and `endDate`, `--posting` `postingDate`, each `--employee` one of `employees`. Leave
 * without pay and absences come from the period's attendance, never a flag (payroll.attendance-based). */
export const RunInput = Schema.Struct({
  orgId: S,
  department: S,
  startDate: Day,
  endDate: Day,
  postingDate: opt(Day),
  /** `--frequency`; absent: monthly, the frequency a start-up's structures pay at. */
  payrollFrequency: opt(Frequency),
  /** Only these Employees; absent: every Employee of the department with an assignment in the run's token, active or in their last period (payroll.run-employees). */
  employees: opt(Schema.Array(S)),
});

export const SlipRowOut = Schema.Struct({
  abbr: S,
  component: S,
  amount: Money,
  defaultAmount: Money,
  /** `additional`: an Additional Salary's row, an advance's recovery (payroll.advance-recovery). */
  source: Schema.Literals(["structure", "collection", "additional"]),
});

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
  /** Days of unpaid leave, and days marked absent, the period's attendance took off its payment days (payroll.attendance-based). */
  leaveWithoutPay: N,
  absentDays: N,
  earnings: Schema.Array(SlipRowOut),
  deductions: Schema.Array(SlipRowOut),
  employerContributions: Schema.Array(SlipRowOut),
  grossPay: Money,
  totalDeduction: Money,
  netPay: Money,
  currency: S,
  status: SlipStatus,
  /** Frappe's Salary Withholding reason while it is withheld (`org payroll payslip withhold --reason`); null otherwise. */
  withholdingReason: Null(S),
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

/** A Payroll Entry the head submitted, as payroll.head.sync reads it from the head's changes and takes it in (IMPORT_RUN). */
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
      /** The head's Salary Withholding holds it (Frappe's Withheld): taken in withheld, never paid with the run. */
      withheld: Schema.Boolean,
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
/** `org payroll payslip withhold <slip> --reason <text>`. */
export const SlipWithhold = Schema.Struct({ orgId: S, salarySlipId: S, reason: S });
/** `org payroll payslip release <slip>`. */
export const SlipRef = Schema.Struct({ orgId: S, salarySlipId: S });

/** `org payroll run list [--department] [--status] [--after] [--limit]`: one page, as every list (payroll.command-fit). */
export const RunListInput = Schema.Struct({ orgId: S, department: opt(S), status: opt(EntryStatus), after: opt(S), limit: opt(Schema.Int) });

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

/**
 * The caller's own payslips, from every Organization that pays them; one slip with `salarySlipId`. `orgId` is one
 * payer's, from `payroll payslip list --employer <handle>`: a filter, never `--org`, which acts for an Organization.
 */
export const MySlipsInput = Schema.Struct({
  salarySlipId: opt(S),
  orgId: opt(S),
  /** A page of the list: the cursor the last page gave, and at most `limit` (1 to 100, 25 by default). */
  after: opt(S),
  limit: opt(Schema.Int),
});
/** `payroll payslip list [--employer <handle>] [--after] [--limit]`. */
export const MySlipsList = Schema.Struct({ employer: opt(S), after: opt(S), limit: opt(Schema.Int) });
/** `payroll payslip get <slip>`. */
export const MySlipRef = Schema.Struct({ salarySlipId: S });
/** One of the caller's payslips, with the Organization that pays it. */
export const MySlip = Schema.Struct({ payer: Schema.Struct({ orgId: S, name: S }), slip: Slip });
