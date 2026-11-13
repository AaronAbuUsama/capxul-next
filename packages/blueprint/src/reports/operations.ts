// The concept "reports": a company's reports, run on its site as the caller's own site user. Reads only.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { NoSiteUser, OrgNotFound, SiteRefused, SiteUnavailable, NotImplemented } from "../errors.ts";
import { declare } from "../operation.ts";
import { Fields, OrgId } from "../values.ts";

export const run = declare({
  rpc: Rpc.make("report.run", {
    payload: {
      org: OrgId,
      report: Schema.String.check(Schema.isBetweenLength(1, 140)),
      /** The report's filters, by name, as typed JSON values. */
      filters: Fields,
    },
    success: Schema.Struct({
      report: Schema.String,
      columns: Schema.Array(Schema.Struct({ field: Schema.String, label: Schema.String, type: Schema.String })),
      /** One row per line, keyed by the columns' `field`. */
      rows: Schema.Array(Fields),
    }),
    error: Schema.Union([OrgNotFound, NoSiteUser, SiteRefused, SiteUnavailable, NotImplemented]),
  }),
  emits: [],
  budget: {
    ms: 8_000,
    excludes: ["waking a parked world"],
    provisional: true,
    basis: "no report has been timed; a report reads many rows on the site. The first green run replaces this",
  },
  examples: [
    {
      payload: { org: "org_northwind1", report: "General Ledger", filters: { account: "Capxul Safe - NW" } },
      success: {
        report: "General Ledger",
        columns: [
          { field: "account", label: "Account", type: "Link" },
          { field: "debit", label: "Debit", type: "Currency" },
          { field: "credit", label: "Credit", type: "Currency" },
        ],
        rows: [{ account: "Capxul Safe - NW", debit: 0, credit: 125.5 }],
      },
    },
  ],
});
