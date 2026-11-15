// The scenarios of the blueprint's domain "record" (reading a world's record): the checks of each of its operations,
// the journeys it leads (none yet), and where each claim of its operations is checked (../domain.ts). ../domains.ts
// lists it once.
import type { Record } from "@capxul/blueprint";
import { recordExport } from "../checks/record-export.ts";
import { payAndBranch } from "../journeys/pay-and-branch.ts";
import { twoOperators } from "../journeys/two-operators.ts";
import { at, type Domain } from "../domain.ts";

/** The checks of each of its operations. */
export const checks: Domain<typeof Record>["checks"] = {
  "record.export": recordExport,
};

/** The journeys it leads, in the order they run. */
export const journeys: Domain<typeof Record>["journeys"] = [];

/** Where each claim of each of its operations is checked, in claims.md's order. */
export const coverage: Domain<typeof Record>["coverage"] = {
  "record.export": [
    at(["record.export", "world.snapshot.restore"], [payAndBranch, 4], [payAndBranch, 10]),
    at(["record.export", "report.run"], [payAndBranch, 10]),
    at(["record.export"], [twoOperators, 5]),
    at(["record.export"], [payAndBranch, 10]),
  ],
};
