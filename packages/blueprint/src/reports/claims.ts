// The acceptance claims of report.run. Rendered into claims.md.
import { claim, kept, type ClaimsOf } from "../claims/claim.ts";
import { NoSiteUser, SiteRefused } from "../errors.ts";
import { startingWorlds as w } from "../starting-worlds.ts";
import * as Reports from "./operations.ts";

export const run: ClaimsOf = {
  operation: Reports.run,
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
