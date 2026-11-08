// The as-is book of the old access concept: the referrals area (the 2026-11-02 referrals plan;
// phase 1 rewards access only).
//
// Registered at `access/referrals:*` (packages/backend/convex/access/referrals.ts): three public rows
// of `referrals` (packages/protocol/src/access/operations.ts:180), the operator's grant and void
// (run with the deployment's deploy key), and the qualify a live Safe schedules (a workflow). The
// entry loads the mail provider because an invite and a qualify admit people.
//
// The context map and the access README's opening leave referrals out, and the README's shape tree
// has no `referrals/` entry. Referrals key on normalized emails, as the waitlist does, so a referral
// works before the friend has an account. Admission is the waitlist's (`admitInTx`); every admission
// marks the admitted person's referral admitted.

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_access } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_referral_transitioned,
  event_waitlist_entry_transitioned,
} from "../shared/vocabulary.ts";
import {
  machine_referral,
  machine_waitlist_entry,
  table_beta_waitlist,
  table_feature_flags,
  table_feature_gates,
  table_feature_syncs,
  table_referral_codes,
  table_referrals,
} from "./data.ts";
import { procedure_access_authenticated_user } from "./procedures.ts";
import { rpc_accounts_claims_claim } from "../accounts/claims.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/access/referrals.ts`;
const R = `${BACKEND}/src/access/referrals`;
const OPS = `${R}/operations`;
const W = `${BACKEND}/src/access/waitlist`;
const ROWS = "packages/protocol/src/access/operations.ts";

const S = Schema.String;
const N = Schema.Number;

/** `CALL` and `DEFECTS` (operations.ts:11, packages/protocol/src/operation.ts:54). */
const CALL_DEFECTS = [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING];

/** Where a person stands: their waitlist row, then the `beta-access` gate (waitlist/reads.ts:37). */
const STANDING_READS = [table_beta_waitlist, table_feature_gates, table_feature_flags, table_feature_syncs];

/** `ensureCodeInTx` (referrals/writes.ts:38): the code row made on first ask; 3 starting invites once, within the cap of 10. */
const ENSURE_CODE_WAS = [`${R}/writes.ts:38`, `${R}/writes.ts:29`, `${R}/writes.ts:65`, `${R}/rules.ts:6`, `${R}/rules.ts:11`, `${R}/rules.ts:15`, `${R}/rules.ts:18`, `${R}/external.ts:12`];

/** `admitInTx` (waitlist/writes.ts:71) as a referral runs it: list, admit, mark that person's referral admitted. */
const ADMIT = {
  reads: [table_beta_waitlist, table_referrals, table_referral_codes],
  writes: [table_beta_waitlist, table_referrals],
  drives: [machine_waitlist_entry.t.to_admitted, machine_referral.t.to_admitted],
  was: [`${W}/writes.ts:71`, `${W}/writes.ts:32`, `${W}/writes.ts:90`, `${R}/writes.ts:124`, `${W}/writes.ts:121`],
};

// ── public rows ─────────────────────────────────────────────────────────────────────────────

export const rpc_access_referrals_show = defineRpc({
  id: "access.referrals.show",
  title: "Your referral link, invites left, and how far your referrals came",
  about:
    "Row `access.referrals.show`, registered as `access/referrals:show` (`capxul referral`). A mutation: signed in, it makes " +
    "the person's code row on first ask (stamping their authUserId) and, when they are admitted or the beta is open to them, " +
    "gives the 3 starting invites once. Answers the code, the link (CAPXUL_JOIN_URL, default https://capxul.com/join, with " +
    "`?ref=<code>`), invites left, and how many live (not voided) referrals reached each stage.",
  was: [`${CONVEX}:9`, `${OPS}/show.ts:21`, `${OPS}/show.ts:27`, `${OPS}/show.ts:30`, `${OPS}/show.ts:39`, `${OPS}/show.ts:40`, `${R}/views.ts:17`, `${R}/external.ts:9`, `${R}/rules.ts:79`, `${ROWS}:182`, `${ROWS}:151`, ...ENSURE_CODE_WAS],
  concept: concept_access,
  kind: "mutation",
  who: "A signed-in person.",
  input: Schema.Struct({}),
  output: Schema.Struct({
    code: S,
    link: S,
    invitesLeft: N,
    counts: Schema.Struct({ attributed: N, admitted: N, qualified: N, rewarded: N }),
  }),
  errors: CALL_DEFECTS,
  reads: [...STANDING_READS, table_referral_codes, table_referrals],
  writes: [table_referral_codes],
  drives: [],
  invokes: [procedure_access_authenticated_user],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_referrals_invite = defineRpc({
  id: "access.referrals.invite",
  title: "Spend one invite: admit a friend's email, tied to you",
  about:
    "Row `access.referrals.invite`, registered as `access/referrals:invite` (`capxul referral invite <email>`). Signed in. Not " +
    "an email, or the person's own mailbox (no +tag, Gmail dots ignored), is INVALID_INPUT. A waiting person is refused " +
    "FEATURE_NOT_AVAILABLE (the waitlist answer); an open beta-access gate lets them invite without an admission. A friend " +
    "already admitted is WRONG_STATE (already_admitted) and spends nothing; no invite left is WRONG_STATE (no_invites_left). " +
    "Otherwise it spends one invite, ties the friend to the person by invite unless a referral brought the friend already " +
    "(that earlier referral is the one then marked admitted), admits the friend `referral:<email>` (putting them on the list " +
    "with joinedVia referral) and schedules their welcome email. Answers the friend's email, `admitted` and invites left.",
  was: [
    `${CONVEX}:7`,
    `${OPS}/invite.ts:24`,
    `${OPS}/invite.ts:28`,
    `${OPS}/invite.ts:31`,
    `${OPS}/invite.ts:33`,
    `${OPS}/invite.ts:36`,
    `${OPS}/invite.ts:39`,
    `${OPS}/invite.ts:40`,
    `${OPS}/invite.ts:49`,
    `${OPS}/invite.ts:50`,
    `${OPS}/invite.ts:51`,
    `${OPS}/invite.ts:54`,
    `${OPS}/invite.ts:57`,
    `${R}/rules.ts:37`,
    `${R}/rules.ts:47`,
    `${R}/errors.ts:8`,
    `${R}/errors.ts:17`,
    `${R}/errors.ts:23`,
    `${R}/writes.ts:77`,
    `${R}/writes.ts:96`,
    `${W}/errors.ts:18`,
    `${ROWS}:189`,
    `${ROWS}:164`,
    ...ENSURE_CODE_WAS,
    ...ADMIT.was,
  ],
  concept: concept_access,
  kind: "mutation",
  who: "A signed-in person who is admitted, or to whom the beta is open.",
  input: Schema.Struct({ email: S }),
  output: Schema.Struct({ email: S, access: Schema.Literal("admitted"), invitesLeft: N }),
  errors: [...CALL_DEFECTS, error_WRONG_STATE, error_FEATURE_NOT_AVAILABLE],
  reads: [...STANDING_READS, table_referral_codes, table_referrals],
  writes: [table_referral_codes, ...ADMIT.writes],
  drives: ADMIT.drives,
  invokes: [procedure_access_authenticated_user],
  emits: [event_referral_transitioned, event_waitlist_entry_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_referrals_list = defineRpc({
  id: "access.referrals.list",
  title: "The people you referred, newest first",
  about:
    "Row `access.referrals.list`, registered as `access/referrals:list` (`capxul referral list`). Signed in; every referral " +
    "whose referrer is the person's normalized email, newest first, each with the friend's email masked (first letter and " +
    "domain), how they came, their stage and stage times. Voided referrals are listed with stage voided.",
  was: [`${CONVEX}:8`, `${OPS}/list.ts:13`, `${OPS}/list.ts:18`, `${R}/reads.ts:40`, `${R}/views.ts:33`, `${R}/views.ts:8`, `${R}/rules.ts:68`, `${ROWS}:196`, `${ROWS}:170`],
  concept: concept_access,
  kind: "query",
  who: "A signed-in person.",
  input: Schema.Struct({}),
  output: Schema.Array(
    Schema.Struct({
      email: S,
      via: Schema.Literals(["link", "invite"]),
      stage: Schema.Literals(["attributed", "admitted", "qualified", "rewarded", "voided"]),
      attributedAt: N,
      admittedAt: Schema.NullOr(N),
      qualifiedAt: Schema.NullOr(N),
    }),
  ),
  errors: CALL_DEFECTS,
  reads: [table_referrals],
  writes: [],
  drives: [],
  invokes: [procedure_access_authenticated_user],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── internal: the operator's tools ──────────────────────────────────────────────────────────

export const rpc_access_referrals_grant_invites = defineRpc({
  id: "access.referrals.grant-invites",
  title: "The operator grants a person more invites",
  about:
    "Internal mutation `access/referrals:grantInvites` (`waitlist invites grant`). Not an email is INVALID_INPUT. Makes the " +
    "person's code row if absent (without an authUserId), giving the starting invites when they are admitted, then adds the " +
    "count (truncated, at least 0) to invites left and granted, past the cap of 10. Answers the email and invites left.",
  was: [`${CONVEX}:12`, `${OPS}/grant-invites.ts:20`, `${OPS}/grant-invites.ts:27`, `${OPS}/grant-invites.ts:31`, `${OPS}/grant-invites.ts:33`, `${OPS}/grant-invites.ts:41`, `${R}/writes.ts:83`, ...ENSURE_CODE_WAS],
  concept: concept_access,
  kind: "mutation",
  who: "internal: an operator with the deployment's deploy key.",
  input: Schema.Struct({ email: S, count: N }),
  output: Schema.Struct({ email: S, invitesLeft: N }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_beta_waitlist, table_referral_codes],
  writes: [table_referral_codes],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_referrals_void = defineRpc({
  id: "access.referrals.void",
  title: "The operator takes a referral back",
  about:
    "Internal mutation `access/referrals:voidReferral` (`waitlist invites void`), by the referred email. Not an email is " +
    "INVALID_INPUT; no referral answers `voided: false`. Otherwise voids it with reason operator (referral_transitioned voided) " +
    "and answers `voided: true`, also for one voided already, which is left as it was. It earns nothing more; an admission " +
    "or invites it already gave stay.",
  was: [`${CONVEX}:14`, `${OPS}/void.ts:19`, `${OPS}/void.ts:26`, `${OPS}/void.ts:29`, `${OPS}/void.ts:31`, `${R}/writes.ts:162`],
  concept: concept_access,
  kind: "mutation",
  who: "internal: an operator with the deployment's deploy key.",
  input: Schema.Struct({ refereeEmail: S }),
  output: Schema.Struct({ voided: Schema.Boolean }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_referrals, table_referral_codes],
  writes: [table_referrals],
  drives: [machine_referral.t.to_voided],
  invokes: [],
  emits: [event_referral_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

// ── the qualify a live Safe schedules ───────────────────────────────────────────────────────

export const workflow_access_referrals_qualify = defineWorkflow({
  id: "access.referrals.qualify",
  title: "Qualify the referral that brought a person whose Safe went live",
  about:
    "Internal mutation `access/referrals:qualify`, scheduled at once by scheduleQualify from Accounts' claim whenever its answer " +
    "shows the Safe claimed (the finish of Get started). Nothing happens for a non-email, no referral, or one voided or " +
    "qualified already. A disposable mailbox (ten listed domains) voids the referral (disposable_email). Otherwise the " +
    "referral is qualified, and in the same write the referrer is rewarded: a referrer still waiting is admitted " +
    "`referral:<referee email>`, gets the welcome email scheduled, and the referral is rewarded `admission`; an admitted " +
    "referrer gets one invite while the start and rewards stay within 10, and the referral is rewarded `invites`; at the cap " +
    "it stays qualified. Timeout is Convex's mutation limit; the code sets none.",
  was: [
    `${CONVEX}:13`,
    `${OPS}/qualify.ts:31`,
    `${OPS}/qualify.ts:38`,
    `${OPS}/qualify.ts:39`,
    `${OPS}/qualify.ts:46`,
    `${OPS}/qualify.ts:50`,
    `${OPS}/qualify.ts:51`,
    `${OPS}/qualify.ts:52`,
    `${OPS}/qualify.ts:61`,
    `${OPS}/qualify.ts:62`,
    `${OPS}/qualify.ts:65`,
    `${OPS}/qualify.ts:74`,
    `${OPS}/qualify.ts:76`,
    `${OPS}/qualify.ts:77`,
    `${R}/rules.ts:50`,
    `${R}/rules.ts:63`,
    `${R}/rules.ts:74`,
    `${R}/writes.ts:136`,
    `${R}/writes.ts:146`,
    `${R}/writes.ts:162`,
    `${R}/writes.ts:200`,
    `${BACKEND}/src/accounts/claims/operations/claim.ts:31`,
    `${BACKEND}/src/accounts/claims/operations/claim.ts:39`,
    ...ENSURE_CODE_WAS,
    ...ADMIT.was,
  ],
  concept: concept_access,
  priority: "normal",
  trigger: { after: rpc_accounts_claims_claim },
  instance: { per: table_referrals },
  steps: [
    { name: "find", about: "Normalizes the email and reads the referral that brought it; none, voided or qualified ends the run (`none`)." },
    { name: "void-disposable", about: "A referee on a disposable mail domain: void the referral (disposable_email) and end (`voided`)." },
    { name: "qualify", about: "Stamps qualifiedAt (referral_transitioned qualified)." },
    {
      name: "reward-admission",
      about: "A referrer not admitted: admit them referral:<referee>, schedule access.waitlist.deliver-welcome, stamp rewardedAt (admission).",
    },
    {
      name: "reward-invite",
      about: "An admitted referrer: ensure their code row; one invite within the cap of 10 and rewardedAt (invites), or none at the cap (`qualified`).",
    },
  ],
  reads: [table_referrals, table_referral_codes, table_beta_waitlist],
  writes: [table_referrals, table_referral_codes, table_beta_waitlist],
  drives: [
    machine_referral.t.to_qualified,
    machine_referral.t.to_rewarded,
    machine_referral.t.to_voided,
    machine_referral.t.to_admitted,
    machine_waitlist_entry.t.to_admitted,
  ],
  invokes: [],
  emits: [event_referral_transitioned, event_waitlist_entry_transitioned],
  calls: [],
  chain: [],
  idempotency: "The referral's qualifiedAt and voidedAt: a second run for the same email finds it qualified or voided and changes nothing.",
  timeoutMs: 1000,
  retries: { max: 0, backoff: "none" },
});
