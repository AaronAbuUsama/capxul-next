// `capxul document create` (today `doc.create`): a draft document on a company's site.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { verb, claim, kept } from "@capxul/blueprint-tools";
import { NoSiteUser, NotImplemented, OrgNotFound, SiteRefused, SiteUnavailable } from "../../../common/refusals.ts";
import { Fields, OrgId } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { DocCreated } from "../events.ts";
import { supplierCreated } from "../examples.ts";
import { Created, Doctype } from "../values.ts";

export const create = verb({
  rpc: Rpc.make("doc.create", {
    payload: {
      org: OrgId,
      doctype: Doctype,
      /** Field values as typed JSON values, never JSON text. */ fields: Fields,
    },
    success: Created,
    error: Schema.Union([OrgNotFound, NoSiteUser, SiteRefused, SiteUnavailable, NotImplemented]),
  }),
  emits: [
    {
      event: DocCreated,
      carries: ({ payload, success }) => ({ org: payload.org, doctype: success.doctype, name: success.name }),
    },
  ],
  budget: {
    ms: 1_500,
    excludes: ["waking a parked world"],
    provisional: true,
    basis: "one call to the company's site on the world's bench; the bench is not measured yet",
  },
  examples: [
    {
      payload: { org: "org_northwind1", doctype: "Supplier", fields: { supplier_name: "Brightside Cleaning Ltd" } },
      success: supplierCreated,
    },
  ],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** What `doc.create` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: create,
  claims: [
    claim(
      "A document is created as a draft and Frappe's validations apply.",
      w.officeHolder,
      "doc.create as sam of a Supplier named Brightside Cleaning Ltd answers its name and docstatus 0. A Supplier with no name is refused with SiteRefused for validation, and report.run of the Supplier list (Site.REPORTS.supplierList, the Supplier doctype's list) shows only Brightside.",
      { refusals: [SiteRefused], origin: kept("doc.create/c-4a88a94b435451b9"), thinLine: true },
    ),
    claim(
      "A caller with no user on the company's site is refused, and nothing is made.",
      w.officeHolder,
      "doc.create as pat is refused with NoSiteUser; record.export shows no new entry.",
      { refusals: [NoSiteUser] },
    ),
    claim(
      "A member whose roles do not allow the document is refused by the site, and nothing is made.",
      w.officeHolder,
      "doc.create as sam of an Employee is refused with SiteRefused for permission; record.export shows no new entry.",
      { refusals: [SiteRefused] },
    ),
    claim(
      "The answer carries the document's hash, and a payment held for the document names the same hash.",
      w.paymentDrafted,
      "The hash doc.create answered for the Payment Entry (the `payment` fact) equals `payment.documentHash` in doc.submit's Held answer for it.",
    ),
  ],
  dropped: [],
};
