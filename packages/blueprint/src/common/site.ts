// The vocabulary of a company's site, declared here once (decisions.md, 40): the doctypes, field names, reports,
// filters and row fields the claims and the starting worlds name, and the documents the starting worlds make. The
// operations type a document's fields and a report's filters and rows as JSON values (decisions.md, 30); the names
// inside them are ERPNext's own and the Capxul app's (packages/frappe-app), as each entry says.
import type { Fields } from "./values.ts";

type FieldValues = typeof Fields.Type;

/** The doctypes the claims name: ERPNext's own. */
export const DOCTYPES = {
  supplier: "Supplier",
  purchaseInvoice: "Purchase Invoice",
  paymentEntry: "Payment Entry",
  /** A doctype only HR roles may create: what a member who keeps the books is refused. */
  employee: "Employee",
} as const;

/**
 * The reports the claims run, by the name report.run takes. A name that is a doctype's, not a report's, runs the
 * doctype's list (Frappe's report view): one row per document, keyed by its fields.
 */
export const REPORTS = {
  generalLedger: "General Ledger",
  trialBalance: "Trial Balance",
  accountsPayable: "Accounts Payable",
  /** Every Supplier of the company: the Supplier doctype's list. */
  supplierList: DOCTYPES.supplier,
  /** Frappe's log of scheduled jobs, one row per run of a job: a doctype's list. */
  scheduledJobLog: "Scheduled Job Log",
  /** A payroll report, which only HR roles open. */
  payroll: "Salary Register",
} as const;

/**
 * The filters the claims give, by report. report.run fills what ERPNext requires and the caller leaves out:
 * `company`, always the company the site keeps, and for a report over a period `from_date` (the company's founding
 * day) and `to_date` (the world's today, in world time). Every other filter is the report's own.
 */
export const FILTERS = {
  generalLedger: { account: "account", voucher: "voucher_no" },
  scheduledJobLog: { job: "scheduled_job_type" },
} as const;

/** The fields of a report's rows the claims read: ERPNext's and Frappe's own names. */
export const ROW_FIELDS = {
  /** The General Ledger's and the Trial Balance's account. */
  account: "account",
  debit: "debit",
  credit: "credit",
  /** The document a General Ledger or Accounts Payable row is for. Opening, total and closing rows have none. */
  voucher: "voucher_no",
  /** What Accounts Payable says is still owed on the voucher. */
  outstanding: "outstanding",
  closingDebit: "closing_debit",
  closingCredit: "closing_credit",
  /** The job a Scheduled Job Log row is a run of: its Scheduled Job Type. */
  job: "scheduled_job_type",
} as const;

/**
 * The company Safe's ledger account. The Capxul app makes it when a company's site is set up, named
 * `Capxul Safe (USDC) - <the company's abbreviation>` (packages/frappe-app/capxul/setup.py), so it is found by this
 * prefix rather than spelled.
 */
export const SAFE_ACCOUNT_PREFIX = "Capxul Safe";

/**
 * The site's daily job: the Capxul app's `capxul.clock.daily` (packages/frappe-app/capxul/hooks.py), whose
 * Scheduled Job Type Frappe names by the method's last two parts. A warp runs it once for every day it passes.
 */
export const DAILY_JOB = { method: "capxul.clock.daily", jobType: "clock.daily" } as const;

/** The fields of a Supplier the claims read and write. `paymentAddress` is the Capxul app's own field. */
export const SUPPLIER_FIELDS = {
  name: "supplier_name",
  group: "supplier_group",
  paymentAddress: "capxul_wallet_address",
} as const;

/** The Supplier the starting world `payment-drafted` makes, and the address it is paid at: nobody's in the cast. */
export const BRIGHTSIDE = "Brightside Cleaning Ltd";
export const PAYEE_ADDRESS = "0x00000000000000000000000000000000b215de01";
/** What `payment-drafted`'s Purchase Invoice and Payment Entry are for, in USDC. */
export const INVOICE_AMOUNT = 125.5;

/** A Supplier named `name`, paid at `PAYEE_ADDRESS`, in ERPNext's default group. */
export const supplierFields = (name: string): FieldValues => ({
  [SUPPLIER_FIELDS.name]: name,
  [SUPPLIER_FIELDS.group]: "All Supplier Groups",
  [SUPPLIER_FIELDS.paymentAddress]: PAYEE_ADDRESS,
});

/** A Purchase Invoice from `supplier` for one line of office cleaning of `amount`. */
export const invoiceFields = (supplier: string, amount: number): FieldValues => ({
  supplier,
  items: [{ item_name: "Office cleaning", description: "Office cleaning", uom: "Nos", qty: 1, rate: amount }],
});

/** A payment to `supplier` from the company Safe's account, against `invoice` when there is one. */
export const paymentFields = (
  supplier: string,
  safeAccount: string,
  amount: number,
  invoice: string | null,
): FieldValues => ({
  payment_type: "Pay",
  party_type: DOCTYPES.supplier,
  party: supplier,
  paid_from: safeAccount,
  paid_amount: amount,
  received_amount: amount,
  references:
    invoice === null
      ? []
      : [{ reference_doctype: DOCTYPES.purchaseInvoice, reference_name: invoice, allocated_amount: amount }],
});
