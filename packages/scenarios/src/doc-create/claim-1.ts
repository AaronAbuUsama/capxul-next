// doc.create, claim 1: a document is created as a draft and Frappe's validations apply. The Supplier list is read
// with the report books.ts names; a row shows a supplier when one of its values is the supplier's name.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Rec from "effect/Record";
import { expect, scenario } from "../scenario.ts";
import { refusal, same, show } from "../support/expect.ts";
import { BRIGHTSIDE, create, report, REPORTS, supplierFields } from "../support/books.ts";
import { head, northwind, unchangedRecord } from "../support/world.ts";

export const docCreate1 = scenario(
  { operation: "doc.create", claim: 1 },
  Effect.gen(function* () {
    const { org } = yield* northwind;
    const made = yield* create(org, "Supplier", supplierFields(BRIGHTSIDE), "sam");
    yield* expect(made.name !== "", "the Supplier has no name");
    yield* same("the Supplier's docstatus", made.docstatus, 0);
    yield* same("the Supplier's doctype", made.doctype, "Supplier");
    yield* same("the Supplier's supplier_name", made.fields["supplier_name"], BRIGHTSIDE);

    const before = yield* head;
    const nameless = { ...supplierFields(BRIGHTSIDE), supplier_name: "" };
    const refused = yield* refusal(
      "doc.create of a Supplier with no name",
      "SiteRefused",
      create(org, "Supplier", nameless, "sam"),
    );
    yield* same(
      "SiteRefused",
      { org: refused.org, target: refused.target, reason: refused.reason },
      { org, target: "Supplier", reason: "validation" },
    );
    yield* unchangedRecord("the refused Supplier", before);

    const rows = yield* report(org, REPORTS.supplierList, {}, "sam");
    const shows = (row: (typeof rows)[number]) =>
      Arr.some(Rec.values(row), (value) => value === BRIGHTSIDE || value === made.name);
    yield* expect(
      rows.length > 0 && Arr.every(rows, shows),
      `the Supplier list must show only Brightside; it shows ${show(rows)}`,
    );
  }),
);
