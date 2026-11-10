// Moved out of the built book by the cut, 10 November 2026, from books/target/accounts/operations.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { budget, defineOperation } from "../../../packages/book/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROFILE_NOT_FOUND,
  error_SMART_ACCOUNT_MISSING,
  error_WRONG_ENVIRONMENT,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { rpc_accounts_admission_join, rpc_accounts_admission_status, WaitlistStatus } from "./admission.ts";
import { flow_client_auth_sign_in, flow_client_auth_verify_otp } from "./flows.ts";
import { rpc_accounts_grants_fund } from "./grants.ts";
import {
  rpc_accounts_referrals_grant_invites,
  rpc_accounts_referrals_invite,
  rpc_accounts_referrals_list,
  rpc_accounts_referrals_show,
} from "./referrals.ts";
import { rpc_accounts_setup_check, rpc_accounts_setup_lifecycle, SetupCheck, SetupLifecycle } from "./setup.ts";

export const operation_referral_invite = defineOperation({
  ...frozenText("referral.invite"),
  priority: "normal",
  implementedBy: rpc_accounts_referrals_invite,
  acceptance: [
    line(
      "referral.invite",
      1,
      "cli: from person-unclaimed, `invitesLeft` 2; read: `waitlist status` as the friend is `admitted` with `referredBy` masked, and the referrer's `referral list` shows the friend `invite` at `admitted`; world: the mail sink holds the friend's invite email.",
    ),
    line("referral.invite", 2, "cli: from person-on-waitlist, exit 6 with FEATURE_NOT_AVAILABLE; world: unchanged."),
    line(
      "referral.invite",
      3,
      "cli: from person-unclaimed, the referrer's own mailbox (with a +tag) is INVALID_INPUT; from two-people-admitted, the other's mailbox is WRONG_STATE `already_admitted`; from person-admitted-no-invites, WRONG_STATE `no_invites_left`; world: unchanged each time.",
    ),
  ],
  returns: Schema.Struct({ email: S, access: Schema.Literal("admitted"), invitesLeft: Int }),
  refusals: [
    { error: error_WRONG_STATE, given: PERSON_NO_INVITES, when: when("referral.invite", "WRONG_STATE") },
    { error: error_FEATURE_NOT_AVAILABLE, given: PERSON_WAITING, when: when("referral.invite", "FEATURE_NOT_AVAILABLE") },
    { error: error_INVALID_INPUT, given: PERSON_ADMITTED, when: when("referral.invite", "INVALID_INPUT") },
    { error: error_NOT_AUTHENTICATED, given: NO_SESSION, when: when("referral.invite", "NOT_AUTHENTICATED") },
  ],
  budget: budget("write"),
  was: ["apps/docs/factory/operations/referral.invite.yaml", "apps/cli/src/commands/referral"],
});

export const operation_referral_list = defineOperation({
  ...frozenText("referral.list"),
  priority: "normal",
  implementedBy: rpc_accounts_referrals_list,
  acceptance: [
    line(
      "referral.list",
      1,
      "cli: from person-unclaimed, after one friend joins with the person's `--ref` and another is invited, two rows newest first: the invite at `admitted`, the link at `attributed`, each email shown as first letter and domain.",
    ),
  ],
  returns: rpc_accounts_referrals_list.output,
  refusals: [{ error: error_NOT_AUTHENTICATED, given: NO_SESSION, when: when("referral.list", "NOT_AUTHENTICATED") }],
  budget: budget("read"),
  was: ["apps/docs/factory/operations/referral.list.yaml", "apps/cli/src/commands/referral"],
});

export const operation_referral_show = defineOperation({
  ...frozenText("referral.show"),
  priority: "normal",
  implementedBy: rpc_accounts_referrals_show,
  acceptance: [
    line(
      "referral.show",
      1,
      "cli: from person-unclaimed, the first run prints a code and `invitesLeft` 3, a second run the same code and still 3; world: one code row, made once.",
    ),
    line("referral.show", 2, "cli: from person-on-waitlist, a code and its link with `invitesLeft` 0."),
  ],
  returns: rpc_accounts_referrals_show.output,
  refusals: [{ error: error_NOT_AUTHENTICATED, given: NO_SESSION, when: when("referral.show", "NOT_AUTHENTICATED") }],
  budget: budget("write"),
  was: ["apps/docs/factory/operations/referral.show.yaml", "apps/cli/src/commands/referral"],
});

export const operation_waitlist_invites_grant = defineOperation({
  ...frozenText("waitlist.invites.grant"),
  priority: "normal",
  implementedBy: rpc_accounts_referrals_grant_invites,
  acceptance: [],
  returns: Schema.Struct({ email: S, invitesLeft: Int }),
  refusals: [{ error: error_INVALID_INPUT, given: PERSON_ADMITTED, when: when("waitlist.invites.grant", "INVALID_INPUT") }],
  budget: budget("write"),
  was: ["apps/docs/factory/operations/waitlist.invites.grant.yaml", "packages/backend/scripts/beta-waitlist.ts"],
});

export const operation_waitlist_join = defineOperation({
  ...frozenText("waitlist.join"),
  priority: "normal",
  implementedBy: rpc_accounts_admission_join,
  acceptance: [
    line(
      "waitlist.join",
      1,
      "cli: from person-signed-in (not on the list), `waitlist join --note A` then `--note B` both print one `requestedAt`, the second with note B; read: `waitlist status` shows note B and that `requestedAt`.",
    ),
    line("waitlist.join", 2, "cli: from person-unclaimed, `waitlist join --note X` still prints `access` `admitted`; read: `waitlist status` keeps `admittedAt`."),
    line("waitlist.join", 3, "cli: from person-on-waitlist, a 501-character note is exit 2 with INVALID_INPUT on `note`; world: unchanged."),
  ],
  returns: Schema.Struct({
    email: S,
    access: WaitlistStatus.fields.access,
    requestedAt: WaitlistStatus.fields.requestedAt,
    note: WaitlistStatus.fields.note,
    referredBy: WaitlistStatus.fields.referredBy,
  }),
  refusals: [
    { error: error_INVALID_INPUT, given: PERSON_WAITING, when: when("waitlist.join", "INVALID_INPUT") },
    { error: error_NOT_AUTHENTICATED, given: NO_SESSION, when: when("waitlist.join", "NOT_AUTHENTICATED") },
  ],
  budget: budget("write"),
  was: ["apps/docs/factory/operations/waitlist.join.yaml", "apps/cli/src/commands/waitlist"],
});

export const operation_waitlist_status = defineOperation({
  ...frozenText("waitlist.status"),
  priority: "normal",
  implementedBy: rpc_accounts_admission_status,
  acceptance: [
    line(
      "waitlist.status",
      1,
      "cli: from person-on-waitlist-open-beta (on the list, never admitted, the deployment's `beta-access` gate on for everyone), `access` `open` and `admittedAt` null.",
    ),
    rewritten(
      "waitlist.status",
      2,
      "In a closed beta a person stays `waiting` until an operator admits them, or money waits for them in a claim escrow, then gets `admitted` with `admittedAt`.",
      "cli: from person-on-waitlist with the gate closed, `access` `waiting`; after the operator's waitlist tool admits the email, `access` `admitted` with `admittedAt`. " +
        "From person-with-money-waiting (never on the list, the gate closed, 5 USDC waiting for the mailbox in a claim escrow), `access` `admitted` with `admittedAt` " +
        "the instant the escrow was indexed; world: its admissions row is `escrow:<the Payment>`, and `dev mail notices --to nobody@outside.test` shows `money-waiting` and no `beta-welcome`.",
    ),
  ],
  returns: WaitlistStatus,
  refusals: [{ error: error_NOT_AUTHENTICATED, given: NO_SESSION, when: when("waitlist.status", "NOT_AUTHENTICATED") }],
  budget: budget("read"),
  was: ["apps/docs/factory/operations/waitlist.status.yaml", "apps/cli/src/commands/waitlist"],
});
