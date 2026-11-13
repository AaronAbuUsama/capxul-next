// report.run, claim 2: a report the caller's roles do not open, and a report that does not exist, are each refused
// by the site. The payroll report is the one books.ts names.
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { report, REPORTS } from "../support/books.ts";
import { northwind } from "../support/world.ts";

const NO_SUCH_REPORT = "Ledger of Everything";

export const reportRun2 = scenario(
  { operation: "report.run", claim: 2 },
  Effect.gen(function* () {
    const { org } = yield* northwind;
    const payroll = yield* refusal(
      `report.run of ${REPORTS.payroll} as sam`,
      "SiteRefused",
      report(org, REPORTS.payroll, {}, "sam"),
    );
    yield* same(
      "SiteRefused",
      { org: payroll.org, target: payroll.target, reason: payroll.reason },
      { org, target: REPORTS.payroll, reason: "permission" },
    );
    const missing = yield* refusal(
      `report.run of ${NO_SUCH_REPORT}`,
      "SiteRefused",
      report(org, NO_SUCH_REPORT, {}, "sam"),
    );
    yield* same(
      "SiteRefused",
      { org: missing.org, target: missing.target, reason: missing.reason },
      { org, target: NO_SUCH_REPORT, reason: "not_found" },
    );
  }),
);
