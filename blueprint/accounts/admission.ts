// The admission area: where a mailbox stands in the permissioned beta, joining the waitlist, and
// an operator's admissions.
//
// The beta gate is `admitted` (a waitlist entry admitted), else `open` (access' `beta-access` gate
// is on for the person), else `waiting`. It is checked only where accounts and the concepts above
// it act: setting up the Safe, the faucet, `referral invite` and `org create` (shared decision
// `procedures.accounts-admit`). Signing in always works.
//
// Not ported: the public request form (POST /waitlist/request) with its per-IP window, the hold
// that recorded every held sign-in, the operator's `waitlist list` and the "you are on the list"
// email (decision `accounts.admission-paths`).

import { Schema } from "effect";
import { budget, defineRpc } from "../../packages/blueprint-engine/src/index.ts";
import { concept_accounts } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED } from "../shared/vocabulary.ts";
import {
  machine_referral,
  machine_waitlist_entry,
  table_referral_codes,
  table_referrals,
  table_admissions,
} from "./data.ts";
import { table_feature_flags } from "../access/data.ts";

const OLD = "packages/backend/src";
const W = `${OLD}/access/waitlist`;
const R = `${OLD}/access/referrals`;

const S = Schema.String;
const noCalls = { calls: [], chain: [], spans: [] } as const;

/** Where a mailbox stands: its entry, then the `beta-access` gate for the person. */
const STANDING = [table_admissions, table_feature_flags] as const;

/** What `waitlist status` answers; `waitlist join` answers its first five fields. */
export const WaitlistStatus = Schema.Struct({
  email: S,
  access: Schema.Literals(["admitted", "open", "waiting"]),
  requestedAt: Schema.NullOr(Schema.Number),
  admittedAt: Schema.NullOr(Schema.Number),
  note: Schema.NullOr(S),
  /** The referrer's mailbox masked (first letter and domain), or null; null for a voided referral. */
  referredBy: Schema.NullOr(S),
  invitesLeft: Schema.Int,
});

export const rpc_accounts_admission_admit = defineRpc({
  id: "accounts.admission.admit",
  title: "An operator admits a wave of mailboxes",
  about:
    "The operator's waitlist tool, run with the deployment's operator key (no person session; anything else is " +
    "NOT_AUTHENTICATED). More than 200 emails is INVALID_INPUT (`emails`); a `by` that is blank, or longer than 64 " +
    "characters (Unicode code points) after trimming, is INVALID_INPUT (`by`). In one transaction, each email that is one is " +
    "admitted `operator:<by>`: a waiting entry moves (`admit`), a mailbox with no entry is born admitted " +
    "(`admit_unlisted`), and the referral that brought it, if any, moves to `admitted`. An email admitted already is " +
    "reported in `already` and changes nothing; one that is not an email in `invalid`. The welcome email follows from " +
    "the transition (notices), so a failed send never undoes an admission.",
  concept: concept_accounts,
  kind: "mutation",
  who: "A Capxul operator with the deployment's operator key, through the operator's waitlist tool.",
  input: Schema.Struct({ emails: Schema.Array(S), by: S }),
  output: Schema.Struct({ admitted: Schema.Array(S), already: Schema.Array(S), invalid: Schema.Array(S) }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [table_admissions, table_referrals],
  writes: [table_admissions, table_referrals],
  drives: [machine_waitlist_entry.t.admit, machine_waitlist_entry.t.admit_unlisted, machine_referral.t.admit],
  invokes: [],
  emits: [],
  ...noCalls,
  budget: budget("write"),
  was: [`${W}/operations/admit.ts:23`, `${W}/rules.ts:38`, `${W}/writes.ts:71`, `${R}/writes.ts:124`],

  spans: ["rpc.accounts.admission.admit"],
});
