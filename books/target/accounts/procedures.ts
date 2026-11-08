// The accounts door: the one procedure another concept invokes inside its own transaction.
//
// Everything else other concepts need from accounts they read (organizations, payments, agents and
// equity depend on accounts and read `personal-safes` and `admissions` directly), or learn
// from `personal_safe_transitioned` and `waitlist_entry_transitioned` through the outbox.
//
// `accounts.admit` is the architecture's one procedure that is not a money fact
// (shared decision `procedures.accounts-admit`): an Organization's invitation and the admission it
// carries must commit together, and accounts sits below organizations, so the outbox cannot carry it.

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";
import { concept_accounts } from "../shared/foundation.ts";
import { error_INVALID_INPUT } from "../shared/vocabulary.ts";
import { machine_referral, machine_waitlist_entry, table_referrals, table_admissions } from "./data.ts";

const OLD = "packages/backend/src";

export const procedure_accounts_admit = defineProcedure({
  id: "accounts.admit",
  title: "Admit an Organization invitation's invitee to the beta",
  about:
    "Authority fact: an invitation and the admission it carries are one fact, so an invitee who holds the invitation is " +
    "never still waiting when they come to take the Seat. Organizations invokes it in the transaction that writes the " +
    "invitation (`org member invite`). It normalizes the email (INVALID_INPUT when it is not one), admits the mailbox " +
    "`invitation:<org_id>` (`admit`, or `admit_unlisted` when the mailbox never joined), and moves the mailbox's referral, " +
    "if one brought it, to `admitted`. A mailbox admitted already is left as it is and answers `admitted: false`, so " +
    "nothing is sent twice. Notices does not send the beta welcome for an `invitation` admission: the invitation email is " +
    "the welcome. It makes no outside call.",
  concept: concept_accounts,
  input: Schema.Struct({ email: Schema.String, orgId: Schema.String }),
  output: Schema.Struct({ email: Schema.String, admitted: Schema.Boolean }),
  errors: [error_INVALID_INPUT],
  reads: [table_admissions, table_referrals],
  writes: [table_admissions, table_referrals],
  drives: [machine_waitlist_entry.t.admit, machine_waitlist_entry.t.admit_unlisted, machine_referral.t.admit],
  invokes: [],
  emits: [],
  was: [`${OLD}/access/waitlist/writes.ts:71`, `${OLD}/access/waitlist/guards.ts:49`, `${OLD}/access/referrals/writes.ts:124`],
});
