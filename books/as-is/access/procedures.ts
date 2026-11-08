// The old access concept's door (packages/backend/src/access/index.ts): every function another
// concept, src/platform or an operator tool imports from it and runs in its own transaction, as
// the old code has it (factory, branch integration/factory). Evidence, not the target design.
//
// What counts as a procedure here:
// - The door's in-transaction functions (`...InTx`, the session and gate guards). Several are
//   Effect steps that read the caller's `Database` or `Transaction` service rather than take a ctx;
//   they run in the invoker's transaction all the same.
// - Three door functions run from an action, where there is no invoker transaction: they run
//   Access's own internal query or mutation (`requireFeatureFromAction`, `featureOnFromAction`,
//   `requireBetaAccessFromAction`). They are booked as procedures because they are the door names
//   other concepts call; each `about` says so, and the touches are those of the internal function.
// - `requireAuthenticatedUser` and `sessionUsers` take an action ctx too; from a query or mutation
//   they read the BetterAuth component inside the caller's transaction.
//
// Not booked, because they are not in-transaction functions: the door's pure rules and types
// (`e2eAuthVerdict`, `testerKindForIdentity`, `assertDevIdentityCapability`, `parseOtpValue`,
// `pickPendingOtp`, `toEpochMs`, `VerificationRow`, `Actor`, `ActorInput`, `ReadScopePrincipal`,
// `FinancialReadScope`, `TenancyCtxLike`). `e2eAuthVerdict` and `testerKindForIdentity` read the
// deployment's environment and throw ENV_MISSING on a misconfigured one; `assertDevIdentityCapability`
// throws NOT_AUTHENTICATED unless CAPXUL_DEV_IDENTITY_CAPABILITY matches (sessions/rules.ts:126,
// :142, :149). `platform/proof-controls/receipt-policy.ts` imports `e2eAuthVerdict` past the door.
//
// Doors bypassed by callers (recorded, not fixed): profiles' onboarding imports `holdAtOnboarding`
// from `#access/waitlist/guards`, accounts' claim imports `scheduleQualify` from
// `#access/referrals/writes` and `requireBetaAccessFromAction` from `#access/waitlist/guards`,
// organizations' invitations import `admitInvitedInTx` from `#access/waitlist/writes`, and
// `src/platform/session.ts` imports the session guards from `#access/sessions/guards`.

import { Schema } from "effect";
import { defineProcedure } from "../../../packages/book/src/index.ts";
import { concept_access } from "../shared/foundation.ts";
import {
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_UNKNOWN,
  event_referral_transitioned,
  event_waitlist_entry_transitioned,
} from "../shared/vocabulary.ts";
import {
  machine_referral,
  machine_waitlist_entry,
  table_beta_waitlist,
  table_better_auth_account,
  table_better_auth_session,
  table_better_auth_user,
  table_better_auth_verification,
  table_feature_flags,
  table_feature_gates,
  table_feature_syncs,
  table_native_client_contexts,
  table_native_client_grants,
  table_native_client_requests,
  table_otp_rate_limits,
  table_referral_codes,
  table_referrals,
  table_user_app_consents,
} from "./data.ts";
import {
  procedure_accounts_read_account_safe_address_in_tx,
  procedure_accounts_require_payment_account_in_tx,
} from "../accounts/procedures.ts";
import {
  procedure_organizations_read_activity_safe_address_in_tx,
  procedure_organizations_read_organization_name_in_tx,
  procedure_organizations_read_organization_party_id_in_tx,
  procedure_organizations_require_org_participant,
} from "../organizations/procedures.ts";
import { procedure_parties_party_by_id } from "../parties/procedures.ts";

const SRC = "packages/backend/src";
const A = `${SRC}/access`;
const GUARDS = `${A}/sessions/guards.ts`;
const READS = `${A}/sessions/reads.ts`;
const WRITES = `${A}/sessions/writes.ts`;

const opt = Schema.optionalKey;
const S = Schema.String;
const B = Schema.Boolean;
const U = Schema.Unknown;

const none = { drives: [], invokes: [], emits: [] } as const;

/** Who a gate is read for (features/rules.ts:41). */
const FeatureSubject = Schema.Struct({ authUserId: opt(S), orgId: opt(S) });
/** A gate key from the catalogue (packages/protocol/src/features/catalog.ts:60-268). */
const FeatureKey = Schema.Literals([
  "payment-departments",
  "payment-agreements",
  "payroll-runs",
  "owner-safe-proposals",
  "equity",
  "bank-payouts",
  "scheduled-payments",
  "payslip-preview",
  "books",
  "beta-access",
  "production-access",
]);
const Principal = Schema.Struct({ authUserId: S, accountId: S });
const ActorKind = Schema.Literals(["account", "organization"]);
const SessionInput = Schema.Struct({ authUserId: S, email: S });

/** What every gate read touches: the devnet gate rows, or the synced PostHog copy and its last good sync. */
const GATE_READS = [table_feature_gates, table_feature_flags, table_feature_syncs];
/** The Organization a refusal names: its name, then its Party's handle (features/reads.ts:124). */
const GATE_LABEL_INVOKES = [
  procedure_organizations_read_organization_name_in_tx,
  procedure_organizations_read_organization_party_id_in_tx,
  procedure_parties_party_by_id,
];
const GATE_WAS = [
  `${A}/features/reads.ts:32`,
  `${A}/features/reads.ts:69`,
  `${A}/features/reads.ts:85`,
  `${A}/features/reads.ts:95`,
  `${A}/features/reads.ts:114`,
  `${A}/features/reads.ts:124`,
  `${A}/features/reads.ts:143`,
  `${A}/features/reads.ts:194`,
  `${A}/features/rules.ts:92`,
  `${A}/features/errors.ts:23`,
];

// ── who is signed in ────────────────────────────────────────────────────────────────────────

export const procedure_access_session_users = defineProcedure({
  id: "access.session-users",
  title: "The BetterAuth user of the caller's live session",
  about:
    "`sessionUsers.safeGetAuthUser`: the caller's Convex identity, then the BetterAuth component's `session` row its " +
    "`sessionId` claim names while `expiresAt` is in the future, then the token subject's `user` row, decoded to " +
    "{_id, email, name}. Undefined when there is no identity, the claim is not a string, or either row is missing; a user row " +
    "that does not decode throws (a defect). It reads the component as @convex-dev/better-auth's own safeGetAuthUser does, so " +
    "no entry but the auth mount loads BetterAuth (ADR-0031). It never checks the token's audience or scope: an agent " +
    "exchange token (aud convex) is a signed-in session like a browser's.",
  was: [`${READS}:35`, `${READS}:36`, `${READS}:39`, `${READS}:47`, `${READS}:52`],
  concept: concept_access,
  input: Schema.Struct({}),
  output: Schema.NullOr(Schema.Struct({ _id: S, email: S, name: opt(S) })),
  errors: [error_UNKNOWN],
  reads: [table_better_auth_session, table_better_auth_user],
  writes: [],
  ...none,
});

export const procedure_access_authenticated_user = defineProcedure({
  id: "access.authenticated-user",
  title: "The signed-in BetterAuth user",
  about:
    "The Effect step `authenticatedUser`: sessionUsers in the caller's Database; no user is `NOT_AUTHENTICATED`, and anything " +
    "the read throws is a defect (`attempt([])`). Platform's `signedIn` (src/platform/session.ts:17) is built from it, so " +
    "every row-built query and mutation that acts for a person starts here.",
  was: [`${GUARDS}:30`, `${GUARDS}:32`, `${GUARDS}:33`, `${SRC}/platform/session.ts:17`, `${A}/sessions/errors.ts:11`],
  concept: concept_access,
  input: Schema.Struct({}),
  output: Schema.Struct({ authUserId: S, user: Schema.Struct({ _id: S, email: S, name: opt(S) }) }),
  errors: [error_NOT_AUTHENTICATED, error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_access_session_users],
  emits: [],
});

export const procedure_access_require_auth_or_throw = defineProcedure({
  id: "access.require-auth-or-throw",
  title: "The signed-in user, from any session reader, for code that throws",
  about:
    "Generic over the reader and its context: asks the reader for the user and throws `NOT_AUTHENTICATED` when there is none; " +
    "returns the user and its branded authUserId. On the door, but no concept outside Access calls it: Access's own " +
    "requireAuthenticatedUser and actorFromSession pass it sessionUsers.",
  was: [`${GUARDS}:38`, `${A}/index.ts:20`],
  concept: concept_access,
  input: Schema.Struct({ component: U, ctx: U }),
  output: Schema.Struct({ user: U, authUserId: S }),
  errors: [error_NOT_AUTHENTICATED],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_access_session_users],
  emits: [],
});

export const procedure_access_require_authenticated_user = defineProcedure({
  id: "access.require-authenticated-user",
  title: "Require the signed-in BetterAuth user (any context)",
  about:
    "requireAuthOrThrow over sessionUsers; none is `NOT_AUTHENTICATED`. It takes a query, mutation or action ctx: Platform's " +
    "`signedInAction` (src/platform/session.ts:24) reads every signed-in action's caller with it, outside any transaction of " +
    "the invoker; Documents' `loadPaymentDocuments` calls it inside its query (documents/reads/payments.ts:83).",
  was: [`${GUARDS}:47`, `${GUARDS}:38`, `${SRC}/platform/session.ts:24`, `${SRC}/documents/reads/payments.ts:83`],
  concept: concept_access,
  input: Schema.Struct({}),
  output: Schema.Struct({ user: U, authUserId: S }),
  errors: [error_NOT_AUTHENTICATED],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_access_session_users],
  emits: [],
});

export const procedure_access_actor_from_session = defineProcedure({
  id: "access.actor-from-session",
  title: "The caller as an Account, or as an Organization they take part in",
  about:
    "Signs the caller in (requireAuthOrThrow over sessionUsers, `NOT_AUTHENTICATED`). No input or `{kind: account}` answers " +
    "`{kind: account, id: authUserId}`: the Account actor's id is the authUserId, not an Account id. `{kind: org, orgId}` " +
    "requires current participation (organizations' requireOrgParticipant, whose refusal propagates) and answers the " +
    "Organization. Parties', Requests' and Applications' key guards call it.",
  was: [`${GUARDS}:52`, `${GUARDS}:56`, `${GUARDS}:60`, `${SRC}/parties/guards.ts:25`, `${SRC}/requests/guards.ts:25`, `${SRC}/applications/keys/guards.ts:29`],
  concept: concept_access,
  input: Schema.Struct({ input: opt(Schema.Union([Schema.Struct({ kind: Schema.Literal("account") }), Schema.Struct({ kind: Schema.Literal("org"), orgId: S })])) }),
  output: Schema.Struct({ kind: Schema.Literals(["account", "org"]), id: S }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_access_session_users, procedure_organizations_require_org_participant],
  emits: [],
});

// ── what they may read ──────────────────────────────────────────────────────────────────────

export const procedure_access_can_read_scope_in_tx = defineProcedure({
  id: "access.can-read-scope-in-tx",
  title: "Whether a principal may read an actor's scope",
  about:
    "An Account scope is readable only by its own Account (`actorId === principal.accountId`); an Organization scope by a " +
    "current participant, asked through organizations' requireOrgParticipant, whose `ROLE_PERMISSION_DENIED` is absorbed as " +
    "`false`. Any other error propagates. Payments', Requests' and Documents' reads call it.",
  was: [`${GUARDS}:65`, `${GUARDS}:76`, `${SRC}/payments/reads/payments.ts:61`, `${SRC}/documents/guards.ts:68`, `${SRC}/documents/guards.ts:129`],
  concept: concept_access,
  input: Schema.Struct({ principal: Principal, actorKind: ActorKind, actorId: S }),
  output: B,
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_organizations_require_org_participant],
  emits: [],
});

export const procedure_access_require_financial_read_principal_in_tx = defineProcedure({
  id: "access.require-financial-read-principal-in-tx",
  title: "Require a signed-in reader with an Account",
  about:
    "Authenticates the caller (requireAuthenticatedUser, `NOT_AUTHENTICATED`), reports the proof to the optional callback, " +
    "then requires the person's payment Account (accounts' requirePaymentAccountInTx, which refuses a person with none). " +
    "Returns the read principal. Payments' retry preview loads its principal with it.",
  was: [`${GUARDS}:88`, `${GUARDS}:95`, `${SRC}/payments/lifecycles/reads/retries.ts:147`],
  concept: concept_access,
  input: Schema.Struct({ onAuthenticated: opt(U) }),
  output: Principal,
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_access_require_authenticated_user, procedure_accounts_require_payment_account_in_tx],
  emits: [],
});

export const procedure_access_require_financial_read_scope_in_tx = defineProcedure({
  id: "access.require-financial-read-scope-in-tx",
  title: "Require a readable financial scope",
  about:
    "The scope a read names (the principal's own Account when none is given), refused `INVALID_INPUT` (field actor: actor not " +
    "found) when canReadScopeInTx says no. It grants no spending authority. Activity's guard and Payments' Movement reads call it.",
  was: [`${GUARDS}:100`, `${GUARDS}:111`, `${A}/sessions/errors.ts:14`, `${SRC}/activity/guards.ts:31`, `${SRC}/payments/movements/reads/movements.ts:33`],
  concept: concept_access,
  input: Schema.Struct({ principal: Principal, actor: opt(U) }),
  output: Schema.Struct({ kind: ActorKind, id: S }),
  errors: [error_INVALID_INPUT],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_access_can_read_scope_in_tx],
  emits: [],
});

export const procedure_access_read_scope_safe_address_in_tx = defineProcedure({
  id: "access.read-scope-safe-address-in-tx",
  title: "The Safe of an already admitted read scope",
  about:
    "An Account scope's Safe (accounts' readAccountSafeAddressInTx) or an Organization's activity Safe (organizations' " +
    "readActivitySafeAddressInTx), or null. It grants no participation: the caller has admitted the scope already. " +
    "Activity's overlays, Requests' writers and Documents call it.",
  was: [`${READS}:75`, `${SRC}/activity/overlays/reads.ts:21`, `${SRC}/documents/reads/movements.ts:121`, `${SRC}/documents/guards.ts:95`],
  concept: concept_access,
  input: Schema.Struct({ scope: Schema.Struct({ kind: ActorKind, id: S }) }),
  output: Schema.NullOr(S),
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_accounts_read_account_safe_address_in_tx, procedure_organizations_read_activity_safe_address_in_tx],
  emits: [],
});

// ── application consent ─────────────────────────────────────────────────────────────────────

export const procedure_access_require_consented_user = defineProcedure({
  id: "access.require-consented-user",
  title: "Require the person's live consent to an application",
  about:
    "Brands the authUserId and appId (a malformed appId is `INVALID_INPUT`), reads the person's consent row for the application " +
    "and refuses `NOT_AUTHENTICATED` when it is missing or revoked; returns its scopes and time. Its only caller outside Access " +
    "is Operator's probe read (operator/probes/reads.ts:37).",
  was: [`${GUARDS}:135`, `${GUARDS}:141`, `${GUARDS}:146`, `${SRC}/operator/probes/reads.ts:37`, "packages/protocol/src/applications/model.ts:50"],
  concept: concept_access,
  input: Schema.Struct({ authUserId: S, appId: S }),
  output: Schema.Struct({ appId: S, authUserId: S, consentedAt: Schema.Number, scopes: Schema.Array(S) }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT],
  reads: [table_user_app_consents],
  writes: [],
  ...none,
});

// ── proof identities (operator fixtures only) ───────────────────────────────────────────────

export const procedure_access_read_pending_proof_otp_in_tx = defineProcedure({
  id: "access.read-pending-proof-otp-in-tx",
  title: "The pending one-time code of a proof email",
  about:
    "For an operator proof identity: normalizes the email, reads up to ten BetterAuth verification rows under " +
    "`sign-in-otp-<email>` and then `email-verification-otp-<email>`, and returns the newest unexpired code (the value before " +
    "its last `:`), or null. Operator's identity reads call it (operator/identities/reads.ts:63).",
  was: [`${READS}:103`, `${READS}:108`, `${A}/sessions/rules.ts:222`, `${SRC}/operator/identities/reads.ts:63`],
  concept: concept_access,
  input: Schema.Struct({ email: S }),
  output: Schema.NullOr(Schema.Struct({ email: S, identifier: S, otp: S, expiresAt: Schema.NullOr(Schema.Number) })),
  errors: [],
  reads: [table_better_auth_verification],
  writes: [],
  ...none,
});

export const procedure_access_read_proof_auth_user_ids_in_tx = defineProcedure({
  id: "access.read-proof-auth-user-ids-in-tx",
  title: "The BetterAuth user ids of a proof email",
  about: "Up to ten BetterAuth users with this exact email, by id. Operator's identity removal calls it (operator/identities/writes.ts:86).",
  was: [`${READS}:126`, `${READS}:127`, `${SRC}/operator/identities/writes.ts:86`],
  concept: concept_access,
  input: Schema.Struct({ email: S }),
  output: Schema.Array(S),
  errors: [],
  reads: [table_better_auth_user],
  writes: [],
  ...none,
});

export const procedure_access_read_proof_auth_user_emails_in_tx = defineProcedure({
  id: "access.read-proof-auth-user-emails-in-tx",
  title: "The email each auth user signed in with",
  about: "One BetterAuth user read per id; a user already removed has none. Operator's identity reads call it (operator/identities/reads.ts:37).",
  was: [`${READS}:138`, `${READS}:144`, `${SRC}/operator/identities/reads.ts:37`],
  concept: concept_access,
  input: Schema.Struct({ authUserIds: Schema.Array(S) }),
  output: Schema.Array(S),
  errors: [],
  reads: [table_better_auth_user],
  writes: [],
  ...none,
});

export const procedure_access_ensure_proof_auth_user_in_tx = defineProcedure({
  id: "access.ensure-proof-auth-user-in-tx",
  title: "The one BetterAuth user of a proof email, created verified",
  about:
    "Reads up to two BetterAuth users with the email: two is the defect UNKNOWN (multiple BetterAuth users); one is returned; " +
    "none creates one with the name, `emailVerified: true` and now as both times. Operator fixtures call it " +
    "(operator/fixtures/writes.ts:50, :114).",
  was: [`${WRITES}:45`, `${WRITES}:50`, `${WRITES}:56`, `${WRITES}:60`, `${A}/sessions/errors.ts:34`, `${SRC}/operator/fixtures/writes.ts:50`],
  concept: concept_access,
  input: Schema.Struct({ email: S, name: S }),
  output: S,
  errors: [error_UNKNOWN],
  reads: [table_better_auth_user],
  writes: [table_better_auth_user],
  ...none,
});

export const procedure_access_remove_proof_otp_rate_limit_in_tx = defineProcedure({
  id: "access.remove-proof-otp-rate-limit-in-tx",
  title: "Remove a proof email's OTP cooldown",
  about: "Deletes the email's otpRateLimits row; true when there was one. Operator's identity removal calls it (operator/identities/writes.ts:62, :85).",
  was: [`${WRITES}:75`, `${SRC}/operator/identities/writes.ts:62`, `${SRC}/operator/identities/writes.ts:85`],
  concept: concept_access,
  input: Schema.Struct({ email: S }),
  output: B,
  errors: [],
  reads: [table_otp_rate_limits],
  writes: [table_otp_rate_limits],
  ...none,
});

export const procedure_access_remove_proof_subject_access_in_tx = defineProcedure({
  id: "access.remove-proof-subject-access-in-tx",
  title: "Remove a proof subject's consents, sessions and sign-in accounts",
  about:
    "Deletes every application consent of the auth user, then up to 100 of its BetterAuth sessions and 100 of its BetterAuth " +
    "accounts ('the legacy bounded cleanup'); true when it removed a consent. Operator's identity removal calls it " +
    "(operator/identities/writes.ts:59, :90).",
  was: [`${WRITES}:89`, `${WRITES}:94`, `${WRITES}:99`, `${WRITES}:103`, `${SRC}/operator/identities/writes.ts:59`],
  concept: concept_access,
  input: Schema.Struct({ authUserId: S }),
  output: B,
  errors: [],
  reads: [table_user_app_consents],
  writes: [table_user_app_consents, table_better_auth_session, table_better_auth_account],
  ...none,
});

export const procedure_access_remove_proof_auth_email_in_tx = defineProcedure({
  id: "access.remove-proof-auth-email-in-tx",
  title: "Remove a proof email's verifications and BetterAuth users",
  about:
    "Deletes up to 100 BetterAuth verification rows whose identifier is the bare email, then up to 10 users with the email. " +
    "emailOTP writes its codes under `<type>-otp-<email>`, so the first delete matches none of them. Operator's identity removal " +
    "calls it (operator/identities/writes.ts:63, :92).",
  was: [`${WRITES}:110`, `${WRITES}:111`, `${WRITES}:118`, `${READS}:107`, `${SRC}/operator/identities/writes.ts:63`],
  concept: concept_access,
  input: Schema.Struct({ email: S }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [table_better_auth_verification, table_better_auth_user],
  ...none,
});

export const procedure_access_remove_native_client_rows_in_tx = defineProcedure({
  id: "access.remove-native-client-rows-in-tx",
  title: "Remove every native client grant, request and context of some people",
  about:
    "The operator purge of a person (#2319): reads every row of the three native client tables (no index names the auth user; " +
    "the code says to add one before the tables reach the per-transaction read limit) and deletes those whose `authUserId` is " +
    "one of the given. A context is shared by every person of its application, client and resource and carries the latest " +
    "grantee, so purging that person deletes the context and retires everyone's grants on it. Returns the count per table. " +
    "Operator's identity removal calls it (operator/identities/writes.ts:57).",
  was: [`${A}/clients/writes/purges.ts:8`, `${A}/clients/writes/purges.ts:15`, `${A}/clients/writes/purges.ts:25`, `${A}/clients/writes/grants.ts:60`, `${SRC}/operator/identities/writes.ts:57`],
  concept: concept_access,
  input: Schema.Struct({ authUserIds: Schema.Array(S) }),
  output: Schema.Struct({ nativeClientGrants: Schema.Number, nativeClientRequests: Schema.Number, nativeClientContexts: Schema.Number }),
  errors: [],
  reads: [table_native_client_grants, table_native_client_requests, table_native_client_contexts],
  writes: [table_native_client_grants, table_native_client_requests, table_native_client_contexts],
  ...none,
});

// ── feature gates ───────────────────────────────────────────────────────────────────────────

export const procedure_access_require_feature = defineProcedure({
  id: "access.require-feature",
  title: "Require a feature gate to be on",
  about:
    "The feature guard (scenario oracle 06), in the caller's Database: decides one gate for the subject (ceiling AND gate; the " +
    "devnet gate rows, or the synced PostHog flag and, for a money gate, a good sync in the last 10 minutes), records " +
    "`feature_<key>` on the wide event, and refuses `FEATURE_NOT_AVAILABLE` (details.feature, details.reason gate, environment " +
    "or stale) when it is off. Only a refusal for an Organization reads its name and its Party's handle. GATED_OPERATIONS " +
    "lists the operations meant to check each gate; Activity's annotation save, Payroll's groups and Payments' intent prepares " +
    "and Books rows call it.",
  was: [`${A}/features/guards.ts:121`, `${A}/features/guards.ts:107`, `${A}/features/guards.ts:115`, `${A}/features/guards.ts:30`, ...GATE_WAS],
  concept: concept_access,
  input: Schema.Struct({ key: FeatureKey, subject: FeatureSubject }),
  output: Schema.Void,
  errors: [error_FEATURE_NOT_AVAILABLE],
  reads: GATE_READS,
  writes: [],
  drives: [],
  invokes: GATE_LABEL_INVOKES,
  emits: [],
});

export const procedure_access_require_feature_from_action = defineProcedure({
  id: "access.require-feature-from-action",
  title: "Require a feature gate to be on, from an action",
  about:
    "requireFeature for an action, which has no database of its own: it runs Access's internal query `access.features.check` " +
    "(featureCheckInTx, in that query's own read transaction, not the invoker's), records the decision on the wide event and " +
    "refuses `FEATURE_NOT_AVAILABLE` when the gate is off. Booked as a procedure because it is the door function other concepts " +
    "call; it is not an in-transaction function. Payroll's agreement actions and Payments' due-schedule send call it.",
  was: [`${A}/features/guards.ts:152`, `${A}/features/guards.ts:137`, `${A}/features/operations/check.ts:14`, `${SRC}/payroll/agreements/operations/offer.ts:199`, `${SRC}/payments/schedules/operations/send-due.ts:20`, ...GATE_WAS],
  concept: concept_access,
  input: Schema.Struct({ key: FeatureKey, subject: FeatureSubject }),
  output: Schema.Void,
  errors: [error_FEATURE_NOT_AVAILABLE],
  reads: GATE_READS,
  writes: [],
  drives: [],
  invokes: GATE_LABEL_INVOKES,
  emits: [],
});

export const procedure_access_feature_on_from_action = defineProcedure({
  id: "access.feature-on-from-action",
  title: "Whether a feature gate is on, from an action",
  about:
    "The same read as requireFeatureFromAction (the internal query `access.features.check`, recorded on the wide event) for a " +
    "gate that only adds something: it answers the boolean and refuses nothing. Payroll's collect preview reads " +
    "`payslip-preview` with it (payroll/agreements/operations/preview-collect.ts:18). Not an in-transaction function.",
  was: [`${A}/features/guards.ts:160`, `${A}/features/guards.ts:137`, `${SRC}/payroll/agreements/operations/preview-collect.ts:18`, ...GATE_WAS],
  concept: concept_access,
  input: Schema.Struct({ key: FeatureKey, subject: FeatureSubject }),
  output: B,
  errors: [],
  reads: GATE_READS,
  writes: [],
  drives: [],
  invokes: GATE_LABEL_INVOKES,
  emits: [],
});

// ── the beta waitlist ───────────────────────────────────────────────────────────────────────

const STANDING_WAS = [`${A}/waitlist/reads.ts:37`, `${A}/waitlist/rules.ts:24`, `${A}/waitlist/guards.ts:29`, `${A}/waitlist/guards.ts:38`, `${A}/waitlist/errors.ts:18`];

export const procedure_access_require_beta_access = defineProcedure({
  id: "access.require-beta-access",
  title: "Require a beta admission or an open beta-access gate",
  about:
    "The waitlist guard (CAP-1019), in the caller's Database: reads the person's waitlist row by normalized email and the " +
    "`beta-access` gate for the person; admitted, or the gate on (open), passes. A waiting person is refused " +
    "`FEATURE_NOT_AVAILABLE` (details.feature beta-access, waitlist waiting, next `capxul waitlist status`). Records " +
    "`feature_beta_access` on the wide event. Organizations' setup begin calls it (organizations/setups/operations/begin.ts:14). " +
    "It does not put the waiting person on the list.",
  was: [`${A}/waitlist/guards.ts:50`, ...STANDING_WAS, `${SRC}/organizations/setups/operations/begin.ts:14`, ...GATE_WAS],
  concept: concept_access,
  input: SessionInput,
  output: Schema.Void,
  errors: [error_FEATURE_NOT_AVAILABLE],
  reads: [table_beta_waitlist, ...GATE_READS],
  writes: [],
  ...none,
});

export const procedure_access_require_beta_access_from_action = defineProcedure({
  id: "access.require-beta-access-from-action",
  title: "Require beta access from an action, putting a held person on the list",
  about:
    "requireBetaAccess for an action: runs Access's internal mutation `access.waitlist.hold` (its own transaction, not the " +
    "invoker's), which reads where the person stands and, when they are waiting with no row, records a `sign-in` request " +
    "(waitlist_entry_transitioned joined). Then records the standing on the wide event and refuses `FEATURE_NOT_AVAILABLE` when " +
    "waiting. Accounts' claim and faucet mint call it (accounts/claims/operations/claim.ts:37, accounts/grants/operations/faucet-mint.ts:23). " +
    "Not an in-transaction function.",
  was: [`${A}/waitlist/guards.ts:80`, `${A}/waitlist/operations/hold.ts:24`, `${A}/waitlist/operations/hold.ts:27`, ...STANDING_WAS, `${A}/waitlist/writes.ts:32`, `${SRC}/accounts/claims/operations/claim.ts:37`],
  concept: concept_access,
  input: SessionInput,
  output: Schema.Void,
  errors: [error_FEATURE_NOT_AVAILABLE, error_UNKNOWN],
  reads: [table_beta_waitlist, table_referrals, ...GATE_READS],
  writes: [table_beta_waitlist],
  drives: [],
  invokes: [],
  emits: [event_waitlist_entry_transitioned],
});

export const procedure_access_hold_at_onboarding = defineProcedure({
  id: "access.hold-at-onboarding",
  title: "Hold a person at their first onboarding while the beta holds them",
  about:
    "At a person's first completed onboarding, in the caller's transaction: when they are waiting (not admitted, beta-access " +
    "off), records a `sign-in` request if they have no row (waitlist_entry_transitioned joined) and schedules " +
    "`access.waitlist.deliverOnTheList` at once; answers true so the caller sends no account-ready email. Profiles' onboarding " +
    "complete calls it (profiles/onboardings/operations/complete.ts:46).",
  was: [`${A}/waitlist/guards.ts:97`, `${A}/waitlist/guards.ts:106`, `${A}/waitlist/guards.ts:112`, ...STANDING_WAS, `${A}/waitlist/writes.ts:32`, `${SRC}/profiles/onboardings/operations/complete.ts:46`],
  concept: concept_access,
  input: Schema.Struct({ session: SessionInput, displayName: S }),
  output: B,
  errors: [error_UNKNOWN],
  reads: [table_beta_waitlist, table_referrals, ...GATE_READS],
  writes: [table_beta_waitlist],
  drives: [],
  invokes: [],
  emits: [event_waitlist_entry_transitioned],
});

export const procedure_access_admit_invited_in_tx = defineProcedure({
  id: "access.admit-invited-in-tx",
  title: "Admit the person an Organization's invitation invites",
  about:
    "Normalizes the email (not an email: nothing happens) and admits it `invitation:<orgId>`, putting it on the list first when it " +
    "is not there; the invitation email is the welcome, so none is sent. The admission marks the referral that brought the " +
    "person admitted. Organizations' invitation offers call it (organizations/invitations/writes/offers.ts:80).",
  was: [`${A}/waitlist/writes.ts:114`, `${A}/waitlist/writes.ts:71`, `${A}/waitlist/writes.ts:32`, `${A}/referrals/writes.ts:124`, `${SRC}/organizations/invitations/writes/offers.ts:80`],
  concept: concept_access,
  input: Schema.Struct({ email: S, orgId: S, now: Schema.Number }),
  output: Schema.Void,
  errors: [error_UNKNOWN],
  reads: [table_beta_waitlist, table_referrals, table_referral_codes],
  writes: [table_beta_waitlist, table_referrals],
  drives: [machine_waitlist_entry.t.to_admitted, machine_referral.t.to_admitted],
  invokes: [],
  emits: [event_waitlist_entry_transitioned, event_referral_transitioned],
});

// ── referrals ───────────────────────────────────────────────────────────────────────────────

export const procedure_access_schedule_qualify = defineProcedure({
  id: "access.schedule-qualify",
  title: "Schedule the qualify of the referral that brought a person",
  about:
    "Schedules `access.referrals.qualify` for the email at once; a scheduler that refuses is logged with the marker " +
    "[CAPXUL_REFERRAL_QUALIFY_UNSCHEDULED] and never fails the caller. Accounts' claim calls it from its action, outside any " +
    "transaction, whenever the answer shows the Safe claimed (accounts/claims/operations/claim.ts:31, :39).",
  was: [`${A}/referrals/writes.ts:200`, `${A}/referrals/writes.ts:192`, `${SRC}/accounts/claims/operations/claim.ts:31`],
  concept: concept_access,
  input: Schema.Struct({ email: S }),
  output: Schema.Void,
  errors: [],
  reads: [],
  writes: [],
  ...none,
});
