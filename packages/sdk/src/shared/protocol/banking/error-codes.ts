// The error codes the banking operations add to the platform's own: see
// `#errors/code-table`. An operation that adds a code adds it here.

import { conceptErrors } from "../errors/code-table.ts";

export const BANKING_ERRORS = conceptErrors({
  codes: [],
  classes: {},
  expected: [],
  reasons: [],
});
