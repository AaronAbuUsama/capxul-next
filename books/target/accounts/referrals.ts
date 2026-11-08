// The referrals area: a person's referral link and invites, spending an invite on a friend, the
// people they referred, and the operator's grant and void.
//
// Each admitted person starts with 3 invites and earns 1 more each time someone they referred gets
// a live Safe (CapxulSafeClaimed, the qualify in ./processes.ts), up to 10 in all; an operator may
// grant past the cap. Mailboxes are compared with dots (Gmail) and plus tags taken out, so a person
// cannot refer themselves. Phase 1 rewards access only.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_accounts } from "../shared/foundation.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  machine_referral,
  machine_waitlist_entry,
  table_referral_codes,
  table_referrals,
  table_waitlist_entries,
} from "./data.ts";
import { table_feature_gates } from "./links.ts";

const OLD = "packages/backend/src";
const R = `${OLD}/access/referrals`;

const S = Schema.String;
const Int = Schema.Int;
const noCalls = { calls: [], chain: [], spans: [] } as const;

/** Where the caller stands (admitted, open or waiting): their entry, then the `beta-access` gate. */
const STANDING = [table_waitlist_entries, table_feature_gates] as const;

export const rpc_accounts_referrals_show = defineRpc({
  id: "accounts.referrals.show",
  title: "Your referral link, invites left, and how far your referrals came",
  about:
    "A mutation, because the first ask makes the caller's code row (a fresh code from the 32-character alphabet, drawn " +
    "again on a clash) and, when the caller is admitted or the beta is open to them, gives the 3 starting invites once " +
    "(`started_at`). A waiting person gets a code and a link and no invites. Answers the code, the link (the join page " +
    "with `?ref=<code>`), invites left, and how many of their referrals that are not voided reached each stage.",
  concept: concept_accounts,
  kind: "mutation",
  who: "A signed-in person, for their own mailbox, even while still on the waitlist.",
  input: Schema.Struct({}),
  output: Schema.Struct({
    code: S,
    link: S,
    invitesLeft: Int,
    counts: Schema.Struct({ attributed: Int, admitted: Int, qualified: Int, rewarded: Int }),
  }),
  errors: [error_NOT_AUTHENTICATED],
  reads: [...STANDING, table_referral_codes, table_referrals],
  writes: [table_referral_codes],
  drives: [],
  invokes: [],
  emits: [],
  ...noCalls,
  budget: budget("write"),
  was: [`${R}/operations/show.ts:21`, `${R}/writes.ts:38`, `${R}/rules.ts:6`, `${R}/views.ts:17`],
});

export const rpc_accounts_referrals_invite = defineRpc({
  id: "accounts.referrals.invite",
  title: "Spend one invite: admit a friend's mailbox, tied to you",
  about:
    "Not an email, or the caller's own mailbox once dots and plus tags are taken out, is INVALID_INPUT (`email`). A " +
    "waiting caller is FEATURE_NOT_AVAILABLE (share the link instead); an open beta-access gate lets them invite without " +
    "an admission. A friend already admitted is WRONG_STATE (`already_admitted`) and spends nothing; no invite left is " +
    "WRONG_STATE (`no_invites_left`). Otherwise, in one transaction: one invite is spent, the friend is tied to the " +
    "caller by invite unless a referral brought them already (`referral.attribute`; that earlier referral is the one " +
    "admitted), the friend's mailbox is admitted `referral:<caller>` (`admit`, or `admit_unlisted` when they never " +
    "joined) and their referral moves to `admitted`. The invite email follows from the transition (notices).",
  concept: concept_accounts,
  kind: "mutation",
  who: "A signed-in person who is admitted, or to whom the beta is open.",
  input: Schema.Struct({ email: S }),
  output: Schema.Struct({ email: S, access: Schema.Literal("admitted"), invitesLeft: Int }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_FEATURE_NOT_AVAILABLE, error_WRONG_STATE],
  reads: [...STANDING, table_referral_codes, table_referrals],
  writes: [table_referral_codes, table_waitlist_entries, table_referrals],
  drives: [
    machine_referral.t.attribute,
    machine_referral.t.admit,
    machine_waitlist_entry.t.admit,
    machine_waitlist_entry.t.admit_unlisted,
  ],
  invokes: [],
  emits: [],
  ...noCalls,
  budget: budget("write"),
  was: [`${R}/operations/invite.ts:24`, `${R}/rules.ts:37`, `${R}/errors.ts:8`, `${R}/writes.ts:77`, `${OLD}/access/waitlist/writes.ts:71`],
});

export const rpc_accounts_referrals_list = defineRpc({
  id: "accounts.referrals.list",
  title: "The people you referred, newest first",
  about:
    "Every referral the caller's mailbox made, newest first (`by-referrer-attributed`), each with the friend's mailbox " +
    "masked (first letter and domain), how they came, their stage and stage times. Voided referrals are listed at stage " +
    "`voided`.",
  concept: concept_accounts,
  kind: "query",
  who: "A signed-in person, for their own referrals.",
  input: Schema.Struct({}),
  output: Schema.Array(
    Schema.Struct({
      email: S,
      via: Schema.Literals(["link", "invite"]),
      stage: Schema.Literals(["attributed", "admitted", "qualified", "rewarded", "voided"]),
      attributedAt: Schema.Number,
      admittedAt: Schema.NullOr(Schema.Number),
      qualifiedAt: Schema.NullOr(Schema.Number),
    }),
  ),
  errors: [error_NOT_AUTHENTICATED],
  reads: [table_referrals],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  ...noCalls,
  budget: budget("read"),
  was: [`${R}/operations/list.ts:13`, `${R}/views.ts:33`, `${R}/rules.ts:68`],
});

export const rpc_accounts_referrals_grant_invites = defineRpc({
  id: "accounts.referrals.grant-invites",
  title: "An operator grants a person more invites, or voids a referral",
  about:
    "The operator's tool, run with the deployment's operator key (anything else is NOT_AUTHENTICATED). `invites grant`: " +
    "not an email is INVALID_INPUT; it makes the mailbox's code row when absent (with the starting invites when the " +
    "mailbox is admitted), then adds the count (a whole number, at least 0) to invites left and granted, past the cap " +
    "of 10, and answers the email and invites left. `invites void`: not an email is INVALID_INPUT; no referral answers " +
    "`voided: false`; otherwise it voids the referral that brought the mailbox (`referral.void`, reason `operator`) and " +
    "answers `voided: true`, also for one voided already. An admission or invites a voided referral gave stay.",
  concept: concept_accounts,
  kind: "mutation",
  who: "A Capxul operator with the deployment's operator key, through the operator's waitlist tool.",
  input: Schema.Union([Schema.Struct({ email: S, count: Int }), Schema.Struct({ referee: S })]),
  output: Schema.Union([Schema.Struct({ email: S, invitesLeft: Int }), Schema.Struct({ referee: S, voided: Schema.Boolean })]),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [table_waitlist_entries, table_referral_codes, table_referrals],
  writes: [table_referral_codes, table_referrals],
  drives: [machine_referral.t.void],
  invokes: [],
  emits: [],
  ...noCalls,
  budget: budget("write"),
  was: [`${R}/operations/grant-invites.ts:20`, `${R}/operations/void.ts:19`, `${R}/writes.ts:83`, `${R}/writes.ts:162`],
});
