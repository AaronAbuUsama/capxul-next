// The error codes the accounts operations add to the platform's own: see
// `#errors/code-table`. An operation that adds a code adds it here.

import { conceptErrors } from "../errors/code-table.ts";

export const ACCOUNTS_ERRORS = conceptErrors({
  codes: [],
  classes: {},
  expected: [],
  // An agent read or write by someone who does not own the agent (W9).
  reasons: ["not_agent_owner"],
});
