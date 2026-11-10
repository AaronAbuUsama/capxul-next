// The error codes the organizations operations add to the platform's own: see
// `#errors/code-table`. An operation that adds a code adds it here.

import { conceptErrors } from "../errors/code-table.ts";

export const ORGANIZATIONS_ERRORS = conceptErrors({
  codes: [
    // A v4 company's founders' shares and option pool exceed a class's authorised (CAP-1174).
    "AUTHORISED_EXCEEDED",
    // A shareholder holds fewer votes than the company Governor's proposal threshold (CAP-1202).
    "BELOW_THRESHOLD",
    // An option grant asks for more than the pool has left (CAP-1182).
    "POOL_EXCEEDED",
    // A seller's shares in the class are still vesting (CAP-1217).
    "SHARES_LOCKED",
  ],
  classes: {
    AUTHORISED_EXCEEDED: "input",
    BELOW_THRESHOLD: "state",
    POOL_EXCEEDED: "input",
    SHARES_LOCKED: "state",
  },
  expected: [
    // The Board asked for more shares than it authorises: it raises authorised or issues fewer.
    "AUTHORISED_EXCEEDED",
    // A shareholder with too few votes to propose: they ask a larger holder to propose it.
    "BELOW_THRESHOLD",
    // The Board granted more options than the pool has left: it grows the pool or grants fewer.
    "POOL_EXCEEDED",
    // The seller offered more than vesting has unlocked: they sell fewer, or wait.
    "SHARES_LOCKED",
  ],
  reasons: [
    // A Director's Safe that still owns a v4 company Safe but no longer wears the Director hat.
    "director_hat_lapsed",
  ],
});
