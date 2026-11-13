// Reading and writing a company's site through the operations, in the blueprint's vocabulary (`Site`): its
// documents, its General Ledger, Trial Balance and Accounts Payable, and the company Safe's ledger account. Every
// call names whom it acts as, and may go `at` another world's door.
import { Site, type Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import { Capxul } from "../client.ts";
import { answers, present } from "./expect.ts";
import { fieldOf, textOf, type Json, type Who } from "./world.ts";

type Fields = typeof Values.Fields.Type;
type Row = Fields;
const ROW = Site.ROW_FIELDS;

/** A JSON value as a number: ERPNext sends amounts as numbers, and sometimes as numeric text. */
export const numberOf = (value: Json | undefined): number => {
  if (typeof value === "number") return value;
  return typeof value === "string" && Str.trim(value) !== "" ? Number(value) : 0;
};

/** A report's rows. */
export const report = (org: string, name: string, filters: Fields, who: Who) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const answer = yield* capxul["report.run"]({ org, report: name, filters }, who);
    return answer.rows;
  });

/** The General Ledger's rows that are postings (opening, total and closing rows name no voucher). */
export const ledger = (org: string, filters: Fields, who: Who) =>
  Effect.map(report(org, Site.REPORTS.generalLedger, filters, who), (rows) =>
    Arr.filter(rows, (row) => textOf(row, ROW.voucher) !== ""),
  );

export const linesOf = (rows: ReadonlyArray<Row>, voucher: string) =>
  Arr.filter(rows, (row) => textOf(row, ROW.voucher) === voucher);

const isSafeAccount = (account: string) => Str.startsWith(Site.SAFE_ACCOUNT_PREFIX)(account);

/** The company Safe's ledger account, as the General Ledger names it. */
export const safeAccount = (org: string, who: Who) =>
  Effect.flatMap(ledger(org, {}, who), (rows) =>
    present(
      `a General Ledger line on an account named "${Site.SAFE_ACCOUNT_PREFIX}…"`,
      Option.getOrNull(
        Arr.findFirst(
          Arr.map(rows, (row) => textOf(row, ROW.account)),
          isSafeAccount,
        ),
      ),
    ),
  );

/** Debits less credits of the lines on the company Safe's account. */
export const safeBalance = (rows: ReadonlyArray<Row>) =>
  Arr.reduce(
    Arr.filter(rows, (row) => isSafeAccount(textOf(row, ROW.account))),
    0,
    (sum, row) => sum + numberOf(fieldOf(row, ROW.debit)) - numberOf(fieldOf(row, ROW.credit)),
  );

/** Credits to the company Safe's account among `rows`. */
export const safeCredits = (rows: ReadonlyArray<Row>) =>
  Arr.filter(rows, (row) => isSafeAccount(textOf(row, ROW.account)) && numberOf(fieldOf(row, ROW.credit)) > 0);

/** What Accounts Payable says is still owed on `invoice`: 0 when it lists nothing for it. */
export const outstanding = (org: string, invoice: string, who: Who) =>
  Effect.map(report(org, Site.REPORTS.accountsPayable, {}, who), (rows) =>
    Arr.reduce(linesOf(rows, invoice), 0, (sum, row) => sum + numberOf(fieldOf(row, ROW.outstanding))),
  );

/** The Trial Balance's closing balance (debit less credit) of the company Safe's account. */
export const trialSafeBalance = (org: string, who: Who) =>
  Effect.flatMap(report(org, Site.REPORTS.trialBalance, {}, who), (rows) =>
    Effect.map(
      present(
        "the company Safe's account in the Trial Balance",
        Option.getOrNull(Arr.findFirst(rows, (row) => isSafeAccount(textOf(row, ROW.account)))),
      ),
      (row) => numberOf(fieldOf(row, ROW.closingDebit)) - numberOf(fieldOf(row, ROW.closingCredit)),
    ),
  );

/** Creates a document. */
export const create = (org: string, doctype: string, fields: Fields, who: Who) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return yield* capxul["doc.create"]({ org, doctype, fields }, who);
  });

/** Submits a document. */
export const submit = (org: string, doctype: string, name: string, who: Who) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return yield* capxul["doc.submit"]({ org, doctype, name }, who);
  });

/** A Payment Entry from the company Safe, created and submitted: it must be held. */
export const holdPayment = (
  org: string,
  payment: { readonly supplier: string; readonly invoice: string | null; readonly amount: number },
  who: Who,
) =>
  Effect.gen(function* () {
    const account = yield* safeAccount(org, who);
    const fields = Site.paymentFields(payment.supplier, account, payment.amount, payment.invoice);
    const created = yield* create(org, Site.DOCTYPES.paymentEntry, fields, who);
    const held = yield* answers(
      `doc.submit of ${created.name}`,
      "Held",
      submit(org, Site.DOCTYPES.paymentEntry, created.name, who),
    );
    return { created, held };
  });
