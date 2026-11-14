// The scenarios of the blueprint's domain "approvals" (giving a signature an operation asked for): the checks of each
// of its operations, the journeys it leads (none yet), and where each claim of its operations is checked
// (../domain.ts). ../domains.ts lists it once.
import type { Approvals } from "@capxul/blueprint";
import { approvalSign } from "../checks/approval-sign.ts";
import { foundNorthwind } from "../journeys/found-northwind.ts";
import { payAndBranch } from "../journeys/pay-and-branch.ts";
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
    at(["approval.sign"], [payAndBranch, 5], [payAndBranch, 6]),
    at(["approval.sign"], [payAndBranch, 5]),
    at(["approval.sign"], [payAndBranch, 5]),
    at(["approval.sign", "world.clock.warp"], [payAndBranch, 8], [payAndBranch, 9]),
    at(["approval.sign"], [foundNorthwind, 3], [foundNorthwind, 6]),
  ],
};
