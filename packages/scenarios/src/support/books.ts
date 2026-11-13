// A company's documents and reports, as the scenarios ask for them. The blueprint types a document's fields and a
// report's filters and rows as JSON values (decisions.md, 30) and does not name them, so everything a scenario
// assumes about the site is here, once, for the blueprint to take over:
// - documents use ERPNext's own field names; a supplier's payment address is the Capxul app's
//   `capxul_wallet_address` (packages/frappe-app/capxul/setup.py);
// - the company Safe's ledger account is the one whose name begins "Capxul Safe" (the app names it
//   "Capxul Safe (USDC) - <abbr>"), found in the General Ledger rather than spelled;
// - reports are ERPNext's, by name, with the filters the blueprint's example uses: the site fills the rest
//   (company, dates). Rows carry ERPNext's fields: `account`, `debit`, `credit`, `voucher_no`, `outstanding`,
//   `closing_debit`, `closing_credit`.
import type { Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import { Capxul } from "../client.ts";
import { answers, present } from "./expect.ts";
import { fieldOf, textOf, type Json } from "./world.ts";

type Fields = typeof Values.Fields.Type;
type Row = Fields;

export const REPORTS = {
  generalLedger: "General Ledger",
  trialBalance: "Trial Balance",
  accountsPayable: "Accounts Payable",
  /** Every supplier with its addresses: ERPNext's list of suppliers as a report. */
  supplierList: "Supplier Addresses And Contacts",
  /** Frappe's log of scheduled jobs, one row per run. */
  scheduledJobLog: "Scheduled Job Log",
  /** A payroll report, which only HR roles open. */
  payroll: "Salary Register",
} as const;

export const BRIGHTSIDE = "Brightside Cleaning Ltd";
/** The payment address the scenarios give a supplier they create. Any address of no one in the cast. */
export const PAYEE_ADDRESS = "0x00000000000000000000000000000000b215de01";
const SAFE_ACCOUNT_PREFIX = "Capxul Safe";

export const supplierFields = (name: string): Fields => ({
  supplier_name: name,
  supplier_group: "All Supplier Groups",
  capxul_wallet_address: PAYEE_ADDRESS,
});

export const invoiceFields = (supplier: string, amount: number): Fields => ({
  supplier,
  items: [{ item_name: "Office cleaning", description: "Office cleaning", uom: "Nos", qty: 1, rate: amount }],
});

/** A payment to `supplier` from the company Safe's account, against `invoice` when there is one. */
export const paymentFields = (
  supplier: string,
  safeAccount: string,
  amount: number,
  invoice: string | null,
): Fields => ({
  payment_type: "Pay",
  party_type: "Supplier",
  party: supplier,
  paid_from: safeAccount,
  paid_amount: amount,
  received_amount: amount,
  references:
    invoice === null
      ? []
      : [{ reference_doctype: "Purchase Invoice", reference_name: invoice, allocated_amount: amount }],
});

/** A JSON value as a number: ERPNext sends amounts as numbers, and sometimes as numeric text. */
export const numberOf = (value: Json | undefined): number => {
  if (typeof value === "number") return value;
  return typeof value === "string" && Str.trim(value) !== "" ? Number(value) : 0;
};

/** A report's rows, run as `as`. */
export const report = (org: string, name: string, filters: Fields, as: string) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const answer = yield* capxul["report.run"]({ org, report: name, filters }, { as });
    return answer.rows;
  });

/** The General Ledger's rows that are postings (opening, total and closing rows name no voucher). */
export const ledger = (org: string, filters: Fields, as: string) =>
  Effect.map(report(org, REPORTS.generalLedger, filters, as), (rows) =>
    Arr.filter(rows, (row) => textOf(row, "voucher_no") !== ""),
  );

export const linesOf = (rows: ReadonlyArray<Row>, voucher: string) =>
  Arr.filter(rows, (row) => textOf(row, "voucher_no") === voucher);

const isSafeAccount = (account: string) => Str.startsWith(SAFE_ACCOUNT_PREFIX)(account);

/** The company Safe's ledger account, as the General Ledger names it. */
export const safeAccount = (org: string, as: string) =>
  Effect.flatMap(ledger(org, {}, as), (rows) =>
    present(
      `a General Ledger line on an account named "${SAFE_ACCOUNT_PREFIX}…"`,
      Option.getOrNull(
        Arr.findFirst(
          Arr.map(rows, (row) => textOf(row, "account")),
          isSafeAccount,
        ),
      ),
    ),
  );

/** Debits less credits of the lines on the company Safe's account. */
export const safeBalance = (rows: ReadonlyArray<Row>) =>
  Arr.reduce(
    Arr.filter(rows, (row) => isSafeAccount(textOf(row, "account"))),
    0,
    (sum, row) => sum + numberOf(fieldOf(row, "debit")) - numberOf(fieldOf(row, "credit")),
  );

/** Credits to the company Safe's account among `rows`. */
export const safeCredits = (rows: ReadonlyArray<Row>) =>
  Arr.filter(rows, (row) => isSafeAccount(textOf(row, "account")) && numberOf(fieldOf(row, "credit")) > 0);

/** What Accounts Payable says is still owed on `invoice`: 0 when it lists nothing for it. */
export const outstanding = (org: string, invoice: string, as: string) =>
  Effect.map(report(org, REPORTS.accountsPayable, {}, as), (rows) =>
    Arr.reduce(linesOf(rows, invoice), 0, (sum, row) => sum + numberOf(fieldOf(row, "outstanding"))),
  );

/** The Trial Balance's closing balance (debit less credit) of the company Safe's account. */
export const trialSafeBalance = (org: string, as: string) =>
  Effect.flatMap(report(org, REPORTS.trialBalance, {}, as), (rows) =>
    Effect.map(
      present(
        "the company Safe's account in the Trial Balance",
        Option.getOrNull(Arr.findFirst(rows, (row) => isSafeAccount(textOf(row, "account")))),
      ),
      (row) => numberOf(fieldOf(row, "closing_debit")) - numberOf(fieldOf(row, "closing_credit")),
    ),
  );

/** Creates a document as `as`. */
export const create = (org: string, doctype: string, fields: Fields, as: string) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return yield* capxul["doc.create"]({ org, doctype, fields }, { as });
  });

/** Submits a document as `as`. */
export const submit = (org: string, doctype: string, name: string, as: string) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return yield* capxul["doc.submit"]({ org, doctype, name }, { as });
  });

/** A Payment Entry from the company Safe, created and submitted as `as`: it must be held. */
export const holdPayment = (
  org: string,
  payment: { readonly supplier: string; readonly invoice: string | null; readonly amount: number },
  as: string,
) =>
  Effect.gen(function* () {
    const account = yield* safeAccount(org, as);
    const fields = paymentFields(payment.supplier, account, payment.amount, payment.invoice);
    const created = yield* create(org, "Payment Entry", fields, as);
    const held = yield* answers(
      `doc.submit of ${created.name}`,
      "Held",
      submit(org, "Payment Entry", created.name, as),
    );
    return { created, held };
  });
