// The scenarios of the blueprint's domain "record" (reading a world's record): the checks of each of its operations,
// the journeys it leads (none yet), and where each claim of its operations is checked (../domain.ts). ../domains.ts
// lists it once.
import type { Record } from "@capxul/blueprint";
import { recordExport } from "../checks/record-export.ts";
import { branchTheBooks } from "../journeys/branch-the-books.ts";
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
    at(["record.export", "world.snapshot.restore"], [branchTheBooks, 3], [branchTheBooks, 8]),
    at(["record.export", "report.run"], [branchTheBooks, 8]),
    at(["record.export"], [twoOperators, 5]),
    at(["record.export"], [branchTheBooks, 8]),
  ],
};
