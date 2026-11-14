// The scenarios of the blueprint's domain "reports" (running a company's reports on its site): the checks of each of
// its operations, the journeys it leads (none yet), and where each claim of its operations is checked (../domain.ts).
// ../domains.ts lists it once.
import type { Reports } from "@capxul/blueprint";
import { reportRun } from "../checks/report-run.ts";
import { foundNorthwind } from "../journeys/found-northwind.ts";
import { payAndBranch } from "../journeys/pay-and-branch.ts";
import { at, type Domain } from "../domain.ts";

/** The checks of each of its operations. */
export const checks: Domain<typeof Reports>["checks"] = {
  "report.run": reportRun,
};

/** The journeys it leads, in the order they run. */
export const journeys: Domain<typeof Reports>["journeys"] = [];

/** Where each claim of each of its operations is checked, in claims.md's order. */
export const coverage: Domain<typeof Reports>["coverage"] = {
  "report.run": [
    at(["report.run"], [payAndBranch, 6]),
    at(["report.run"], [foundNorthwind, 8]),
    at(["report.run"], [foundNorthwind, 8]),
  ],
};
