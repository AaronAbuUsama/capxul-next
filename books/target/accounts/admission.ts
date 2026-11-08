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
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
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

export const rpc_accounts_admission_status = defineRpc({
  id: "accounts.admission.status",
  title: "Where the signed-in person stands in the beta",
  about:
    "The caller's mailbox from the session. `admitted` with `admittedAt` when the entry is admitted; else `open` when " +
    "access' `beta-access` gate is on for the person; else `waiting`, also when the mailbox has no entry. Answers the " +
    "entry's times and note (null without one), who referred them (masked, from the referral that brought the mailbox; " +
    "null when there is none or it was voided) and the invites they can spend (0 without a code row). It writes nothing " +
    "and shows no place in a queue: an operator picks who is admitted.",
  concept: concept_accounts,
  kind: "query",
  who: "A signed-in person, for their own mailbox.",
  input: Schema.Struct({}),
  output: WaitlistStatus,
  errors: [error_NOT_AUTHENTICATED],
  reads: [...STANDING, table_referrals, table_referral_codes],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  ...noCalls,
  budget: budget("read"),
  was: [`${W}/operations/status.ts:15`, `${W}/rules.ts:11`, `${W}/views.ts:6`, `${R}/reads.ts:49`],
});

export const rpc_accounts_admission_join = defineRpc({
  id: "accounts.admission.join",
  title: "Join the beta waitlist, or change what you will build",
  about:
    "A note over 500 characters is INVALID_INPUT (`note`). With `ref`: a code nobody holds, or the caller's own mailbox's " +
    "code (dots and plus tags taken out), is INVALID_INPUT (`ref`); otherwise a mailbox that is not admitted and that no " +
    "referral brought yet is tied to the code's owner by link (`referral.attribute`); the first referral wins and a " +
    "later `--ref` changes nothing. Then a mailbox with no entry joins (`waitlist-entry.join`, stamping `requested_at` " +
    "and the person's id); an existing entry keeps its `requested_at`, and its note changes only when a note is given. " +
    "An admission is never undone. Answers the status, as `accounts.admission.status` would.",
  concept: concept_accounts,
  kind: "mutation",
  who: "A signed-in person, for their own mailbox.",
  input: Schema.Struct({ note: Schema.optionalKey(S), ref: Schema.optionalKey(S) }),
  output: WaitlistStatus,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [...STANDING, table_referrals, table_referral_codes],
  writes: [table_admissions, table_referrals],
  drives: [machine_waitlist_entry.t.join, machine_referral.t.attribute],
  invokes: [],
  emits: [],
  ...noCalls,
  budget: budget("write"),
  was: [`${W}/operations/join.ts:23`, `${W}/rules.ts:17`, `${W}/writes.ts:32`, `${R}/writes.ts:182`, `${R}/reads.ts:65`],
});

export const rpc_accounts_admission_admit = defineRpc({
  id: "accounts.admission.admit",
  title: "An operator admits a wave of mailboxes",
  about:
    "The operator's waitlist tool, run with the deployment's operator key (no person session; anything else is " +
    "NOT_AUTHENTICATED). More than 200 emails is INVALID_INPUT (`emails`). In one transaction, each email that is one is " +
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
});
