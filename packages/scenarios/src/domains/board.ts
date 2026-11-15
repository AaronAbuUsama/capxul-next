// The scenarios of the blueprint's domain "board" (a company's Board, its Directors and how many must sign): the
// checks of each of its operations, the journeys it leads, and where each claim of its operations is checked
// (../domain.ts). ../domains.ts lists it once.
import type { Board } from "@capxul/blueprint";
import { orgDirectorAdd } from "../checks/org-director-add.ts";
import { orgDirectorList } from "../checks/org-director-list.ts";
import { orgThresholdSet } from "../checks/org-threshold-set.ts";
import { at, type Domain } from "../domain.ts";
import { seatSam } from "../journeys/seat-sam.ts";

/** The checks of each of its operations. */
export const checks: Domain<typeof Board>["checks"] = {
  "org.director.list": orgDirectorList,
  "org.director.add": orgDirectorAdd,
  "org.threshold.set": orgThresholdSet,
};

/** The journeys it leads, in the order they run. */
export const journeys: Domain<typeof Board>["journeys"] = [seatSam];

/** Where each claim of each of its operations is checked, in claims.md's order. */
export const coverage: Domain<typeof Board>["coverage"] = {
  "org.director.list": [
    at(["org.director.list"], [seatSam, 1], [seatSam, 4]),
    at(["org.director.list"], [seatSam, 1], [seatSam, 4]),
  ],
  "org.director.add": [
    at(["org.director.add", "approval.sign"], [seatSam, 2], [seatSam, 3]),
    at([], [seatSam, 3]),
    at(["report.run"], [seatSam, 2], [seatSam, 5]),
    at(["org.director.add"], [seatSam, 2]),
    at(["org.director.add"], [seatSam, 2]),
    at(["org.director.add"], [seatSam, 2]),
  ],
  "org.threshold.set": [
    at(["org.threshold.set", "approval.sign"], [seatSam, 6], [seatSam, 7]),
    at(["org.member.grant", "approval.sign"], [seatSam, 8], [seatSam, 9]),
    at(["org.threshold.set"], [seatSam, 6]),
    at(["org.threshold.set"], [seatSam, 6]),
    at(["org.threshold.set"], [seatSam, 6]),
  ],
};
