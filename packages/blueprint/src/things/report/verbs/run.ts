// The concept "reports": a company's reports, run on its site as the caller's own site user. Reads only.
//
// `capxul report run` (today `report.run`): running a company's report on its site.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { declare, claim, kept } from "@capxul/blueprint-tools";
import { NoSiteUser, NotImplemented, OrgNotFound, SiteRefused, SiteUnavailable } from "../../../common/refusals.ts";
import { Fields, OrgId } from "../../../common/values.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";

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

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

/** It moves no thing with a lifecycle (the machine format): why. */
export const stateless = "a read: runs a report on the company's site and changes nothing";

/** What `report.run` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: run,
  claims: [
    claim(
      "A report runs as the caller and the books agree with the chain.",
      w.paid,
      "report.run as sam of the General Ledger filtered to the Capxul Safe account answers lines whose balance equals the company Safe's USDC balance read through the door's chain RPC at the latest block (chain.balance of `contracts.usdc` for the `founded` fact's Safe); the Trial Balance agrees, and the paid invoice has nothing outstanding in Accounts Payable.",
      { origin: kept("report.run/c-6c39c42c744b8c91"), thinLine: true },
    ),
    claim(
      "A report the caller's roles do not open, and a report that does not exist, are each refused by the site.",
      w.paid,
      "report.run as sam of a payroll report is refused with SiteRefused for permission; of `Ledger of Everything`, with SiteRefused for not_found.",
      { refusals: [SiteRefused] },
    ),
    claim(
      "A caller with no user on the company's site is refused.",
      w.paid,
      "report.run as pat is refused with NoSiteUser.",
      {
        refusals: [NoSiteUser],
      },
    ),
  ],
  dropped: [],
};
