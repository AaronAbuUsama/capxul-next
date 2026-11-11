// The error codes the permissions operations add to the platform's own: see
// `#errors/code-table`. An operation that adds a code adds it here.

import { conceptErrors } from "../errors/code-table.ts";

export const PERMISSIONS_ERRORS = conceptErrors({
  codes: [
    // A v4 allowance asks its parent budget for more than it has left to give (CAP-1144).
    "CHILDREN_EXCEED_PARENT",
  ],
  classes: { CHILDREN_EXCEED_PARENT: "state" },
  expected: [
    // The Directors resize the parent or ask for less: a refusal, not a defect.
    "CHILDREN_EXCEED_PARENT",
  ],
  reasons: [],
});
