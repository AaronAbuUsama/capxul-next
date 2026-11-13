// doc.submit, claim 2: an ordinary document posts to the ledger when submitted. The invoice's lines must balance:
// 125.50 USDC debited and credited.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { expect, scenario } from "../scenario.ts";
import { answers, same, sameAmount } from "../support/expect.ts";
import { create, invoiceFields, ledger, linesOf, numberOf, submit, supplierFields } from "../support/books.ts";
import { fieldOf, northwind } from "../support/world.ts";

export const docSubmit2 = scenario(
  { operation: "doc.submit", claim: 2 },
  Effect.gen(function* () {
    const { org } = yield* northwind;
    const supplier = yield* create(org, "Supplier", supplierFields("Harbour Paper Co"), "sam");
    const invoice = yield* create(org, "Purchase Invoice", invoiceFields(supplier.name, 125.5), "sam");
    const posted = yield* answers(
      `doc.submit of ${invoice.name}`,
      "Posted",
      submit(org, "Purchase Invoice", invoice.name, "sam"),
    );
    yield* same(
      "the posted document",
      [posted.doctype, posted.name, posted.docstatus],
      ["Purchase Invoice", invoice.name, 1],
    );
    const lines = linesOf(yield* ledger(org, {}, "sam"), invoice.name);
    yield* expect(lines.length >= 2, `the General Ledger shows ${lines.length} lines for ${invoice.name}`);
    const total = (field: string) => Arr.reduce(lines, 0, (sum, line) => sum + numberOf(fieldOf(line, field)));
    yield* sameAmount("the invoice's debits", total("debit"), 125.5);
    yield* sameAmount("the invoice's credits", total("credit"), 125.5);
  }),
);
