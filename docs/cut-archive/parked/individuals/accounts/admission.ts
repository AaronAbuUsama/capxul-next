// Moved out of the built book by the cut, 10 November 2026, from books/target/accounts/admission.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

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
