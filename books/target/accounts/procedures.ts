// The accounts door: the one procedure another concept invokes inside its own transaction.
//
// Everything else other concepts need from accounts they read (organizations, payments, agents and
// equity depend on accounts and read `personal-safes` and `admissions` directly), or learn
// from `personal_safe_transitioned` and `waitlist_entry_transitioned` through the outbox.
//
// `accounts.admit` is the architecture's one procedure that is not a money fact
// (shared decision `procedures.accounts-admit`): an Organization's invitation, or money waiting in a
// claim escrow (accounts.money-waiting-admits), and the admission it carries must commit together, and
// accounts sits below organizations and payments, so the outbox cannot carry it.

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";
import { concept_accounts } from "../shared/foundation.ts";
import { error_INVALID_INPUT } from "../shared/vocabulary.ts";
import { machine_referral, machine_waitlist_entry, table_referrals, table_admissions } from "./data.ts";

const OLD = "packages/backend/src";

export const procedure_accounts_admit = defineProcedure({
  id: "accounts.admit",
  title: "Admit an invitee, someone money waits for, or an FDE's guest, to the beta",
  about:
    "Authority fact: an Organization invitation, money waiting in a claim escrow, or an Organization naming a guest of " +
    "its FDE, and the admission it carries are one fact, so its invitee is never still waiting when they come to take " +
    "the Seat, nor its recipient when they come to claim, nor its guest when they come to ask. Organizations invokes it in the transaction that writes the invitation (`org member invite`), `via` " +
    "`invitation` and `ref` the Organization's id; payments invokes it in the transaction that moves a claim escrow's " +
    "Payment to `escrowed`, `via` `escrow` and `ref` the Payment's id, with the mailbox the Payment keeps " +
    "(accounts.money-waiting-admits); organizations invokes it when it names an FDE guest (`org fde guest add`), `via` " +
    "`fde-guest` and `ref` the Organization's id (organizations.fde-guests). It normalizes the email (INVALID_INPUT when it is not one), admits the mailbox " +
    "`<via>:<ref>` (`admit`, or `admit_unlisted` when the mailbox never joined), and moves the mailbox's referral, if " +
    "one brought it, to `admitted`. A mailbox admitted already is left as it is and answers `admitted: false`, so " +
    "nothing is sent twice. Notices sends no beta welcome for any of the three: the invitation email, the " +
    "money-waiting email or the guest-named email is the welcome. An admission is never undone, so money taken back later leaves " +
    "its recipient admitted, as a cancelled invitation leaves its invitee. It makes no outside call.",
  concept: concept_accounts,
  input: Schema.Struct({
    email: Schema.String,
    /** What carries the admission: an Organization's invitation, money waiting in a claim escrow, or an FDE guest named. */
    via: Schema.Literals(["invitation", "escrow", "fde-guest"]),
    /** The Organization's id for an invitation or a guest; the escrowed Payment's id for money waiting. */
    ref: Schema.String,
  }),
  output: Schema.Struct({ email: Schema.String, admitted: Schema.Boolean }),
  errors: [error_INVALID_INPUT],
  reads: [table_admissions, table_referrals],
  writes: [table_admissions, table_referrals],
  drives: [machine_waitlist_entry.t.admit, machine_waitlist_entry.t.admit_unlisted, machine_referral.t.admit],
  invokes: [],
  emits: [],
  was: [`${OLD}/access/waitlist/writes.ts:71`, `${OLD}/access/waitlist/guards.ts:49`, `${OLD}/access/referrals/writes.ts:124`],
});
