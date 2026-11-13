// doc.create, claim 1: a document is created as a draft and Frappe's validations apply. The Supplier list is the
// Supplier doctype's list (Site.REPORTS.supplierList), one row per Supplier with its fields.
import { Site } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { expect, scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { create, report } from "../support/site.ts";
import { head, northwind, textOf, unchangedRecord } from "../support/world.ts";

export const docCreate1 = scenario(
  { operation: "doc.create", claim: 1 },
  Effect.gen(function* () {
    const { org } = yield* northwind;
    const sam = { as: "sam" };
    const made = yield* create(org, Site.DOCTYPES.supplier, Site.supplierFields(Site.BRIGHTSIDE), sam);
    yield* expect(made.name !== "", "the Supplier has no name");
    yield* same("the Supplier's docstatus", made.docstatus, 0);
    yield* same("the Supplier's doctype", made.doctype, Site.DOCTYPES.supplier);
    yield* same("the Supplier's name field", made.fields[Site.SUPPLIER_FIELDS.name], Site.BRIGHTSIDE);

    const before = yield* head;
    const nameless = { ...Site.supplierFields(Site.BRIGHTSIDE), [Site.SUPPLIER_FIELDS.name]: "" };
    const refused = yield* refusal(
      "doc.create of a Supplier with no name",
      "SiteRefused",
      create(org, Site.DOCTYPES.supplier, nameless, sam),
    );
    yield* same(
      "SiteRefused",
      { org: refused.org, target: refused.target, reason: refused.reason },
      { org, target: Site.DOCTYPES.supplier, reason: "validation" },
    );
    yield* unchangedRecord("the refused Supplier", before);

    const rows = yield* report(org, Site.REPORTS.supplierList, {}, sam);
    yield* same(
      "the Supplier list's names",
      Arr.map(rows, (row) => textOf(row, Site.SUPPLIER_FIELDS.name)),
      [Site.BRIGHTSIDE],
    );
  }),
);
