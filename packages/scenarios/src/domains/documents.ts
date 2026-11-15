// The scenarios of the blueprint's domain "documents" (a company's documents on its site): the checks of each of its
// operations, the journeys it leads, and where each claim of its operations is checked (../domain.ts). ../domains.ts
// lists it once.
import type { Documents } from "@capxul/blueprint";
import { docCreate } from "../checks/doc-create.ts";
import { docSubmit } from "../checks/doc-submit.ts";
import { foundNorthwind } from "../journeys/found-northwind.ts";
import { payAndBranch } from "../journeys/pay-and-branch.ts";
import { at, type Domain } from "../domain.ts";

/** The checks of each of its operations. */
export const checks: Domain<typeof Documents>["checks"] = {
  "doc.create": docCreate,
  "doc.submit": docSubmit,
};

/** The journeys it leads, in the order they run. */
export const journeys: Domain<typeof Documents>["journeys"] = [payAndBranch];

/** Where each claim of each of its operations is checked, in claims.md's order. */
export const coverage: Domain<typeof Documents>["coverage"] = {
  "doc.create": [
    at(["doc.create"], [foundNorthwind, 7], [foundNorthwind, 8]),
    at(["doc.create"], [foundNorthwind, 7]),
    at(["doc.create"], [foundNorthwind, 7]),
    at(["doc.submit"], [payAndBranch, 2]),
  ],
  "doc.submit": [
    at(["doc.submit"], [payAndBranch, 2]),
    at(["doc.submit"], [payAndBranch, 2]),
    at(["doc.submit"], [payAndBranch, 2]),
    at(["doc.submit"], [payAndBranch, 2]),
  ],
};
