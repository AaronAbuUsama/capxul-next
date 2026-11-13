// doc.submit, claim 2: an ordinary document posts to the ledger when submitted. The invoice's lines must balance:
// 125.50 USDC debited and credited.
import { Site } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { expect, scenario } from "../scenario.ts";
import { answers, same, sameAmount } from "../support/expect.ts";
import { create, ledger, linesOf, numberOf, submit } from "../support/site.ts";
import { fieldOf, northwind } from "../support/world.ts";

export const docSubmit2 = scenario(
  { operation: "doc.submit", claim: 2 },
  Effect.gen(function* () {
    const { org } = yield* northwind;
    const sam = { as: "sam" };
    const supplier = yield* create(org, Site.DOCTYPES.supplier, Site.supplierFields("Harbour Paper Co"), sam);
    const fields = Site.invoiceFields(supplier.name, Site.INVOICE_AMOUNT);
    const invoice = yield* create(org, Site.DOCTYPES.purchaseInvoice, fields, sam);
    const posted = yield* answers(
      `doc.submit of ${invoice.name}`,
      "Posted",
      submit(org, Site.DOCTYPES.purchaseInvoice, invoice.name, sam),
    );
    yield* same(
      "the posted document",
      [posted.doctype, posted.name, posted.docstatus],
      [Site.DOCTYPES.purchaseInvoice, invoice.name, 1],
    );
    const lines = linesOf(yield* ledger(org, {}, sam), invoice.name);
    yield* expect(lines.length >= 2, `the General Ledger shows ${lines.length} lines for ${invoice.name}`);
    const total = (field: string) => Arr.reduce(lines, 0, (sum, line) => sum + numberOf(fieldOf(line, field)));
    yield* sameAmount("the invoice's debits", total(Site.ROW_FIELDS.debit), Site.INVOICE_AMOUNT);
    yield* sameAmount("the invoice's credits", total(Site.ROW_FIELDS.credit), Site.INVOICE_AMOUNT);
  }),
);
