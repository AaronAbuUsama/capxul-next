// The scenarios of the blueprint's domain "organizations" (founding a company and granting its members permissions):
// the checks of each of its operations, the journeys it leads, and where each claim of its operations is checked
// (../domain.ts). ../domains.ts lists it once.
import type { Organizations } from "@capxul/blueprint";
import { orgCreate } from "../checks/org-create.ts";
import { orgMemberGrant } from "../checks/org-member-grant.ts";
import { foundNorthwind } from "../journeys/found-northwind.ts";
import { at, type Domain } from "../domain.ts";

/** The checks of each of its operations. */
export const checks: Domain<typeof Organizations>["checks"] = {
  "org.create": orgCreate,
  "org.member.grant": orgMemberGrant,
};

/** The journeys it leads, in the order they run. */
export const journeys: Domain<typeof Organizations>["journeys"] = [foundNorthwind];

/** Where each claim of each of its operations is checked, in claims.md's order. */
export const coverage: Domain<typeof Organizations>["coverage"] = {
  "org.create": [
    at(["org.create"], [foundNorthwind, 2]),
    at(["org.create"], [foundNorthwind, 2]),
    at(["approval.sign"], [foundNorthwind, 3], [foundNorthwind, 4]),
    at(["org.create"], [foundNorthwind, 2]),
    at(["org.create"], [foundNorthwind, 1]),
    at(["org.create"], [foundNorthwind, 1], [foundNorthwind, 2]),
    at(["org.create"], [foundNorthwind, 1], [foundNorthwind, 2]),
  ],
  "org.member.grant": [
    at(["org.member.grant", "approval.sign"], [foundNorthwind, 5], [foundNorthwind, 6], [foundNorthwind, 7]),
    at(["org.member.grant"], [foundNorthwind, 5], [foundNorthwind, 9]),
    at(["org.member.grant"], [foundNorthwind, 5]),
    at(["org.member.grant"], [foundNorthwind, 5]),
    at([], [foundNorthwind, 6]),
    at(["org.member.grant"], [foundNorthwind, 5], [foundNorthwind, 9]),
    at([], [foundNorthwind, 9], [foundNorthwind, 10]),
  ],
};
