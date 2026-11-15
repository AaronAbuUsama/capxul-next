// The scenarios of the blueprint's domain "approvals" (giving a signature an operation asked for): the checks of each
// of its operations, the journeys it leads (none yet), and where each claim of its operations is checked
// (../domain.ts). ../domains.ts lists it once.
import type { Approvals } from "@capxul/blueprint";
import { approvalSign } from "../checks/approval-sign.ts";
import { foundNorthwind } from "../journeys/found-northwind.ts";
import { branchTheBooks } from "../journeys/branch-the-books.ts";
import { payBrightside } from "../journeys/pay-brightside.ts";
import { at, type Domain } from "../domain.ts";

/** The checks of each of its operations. */
export const checks: Domain<typeof Approvals>["checks"] = {
  "approval.sign": approvalSign,
};

/** The journeys it leads, in the order they run. */
export const journeys: Domain<typeof Approvals>["journeys"] = [];

/** Where each claim of each of its operations is checked, in claims.md's order. */
export const coverage: Domain<typeof Approvals>["coverage"] = {
  "approval.sign": [
    at(["approval.sign"], [payBrightside, 4], [payBrightside, 5]),
    at(["approval.sign"], [payBrightside, 4]),
    at(["approval.sign"], [payBrightside, 3]),
    at(["approval.sign", "world.clock.warp"], [branchTheBooks, 6], [branchTheBooks, 7]),
    at(["approval.sign"], [foundNorthwind, 3], [foundNorthwind, 6]),
  ],
};
