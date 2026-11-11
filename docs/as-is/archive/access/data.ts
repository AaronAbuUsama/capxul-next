// The old access concept's tables and the state machines that live on them, as the old code has
// them (factory, branch integration/factory). Evidence, not the target design.
//
// Tables: packages/backend/src/access/tables.ts (consentTables, sessionTables, clientTables,
// featureTables, waitlistTables, referralTables), composed in packages/backend/convex/schema.ts:54-94.
// The BetterAuth component (@convex-dev/better-auth 0.12.3, convex/convex.config.ts:6) keeps its own
// tables outside the app schema; access is the only concept that reads or writes them, through the
// component adapter. They are booked here with the id prefix `better-auth-`, and only with the columns
// Capxul code names: the component's own schema and indexes are not in the repository.
//
// Machines: nativeClientRequests.state is the one literal-union state column. The waitlist entry and
// the referral have no state column; the code derives their stage from timestamp columns and sends
// one product event per move (waitlist_entry_transitioned, referral_transitioned), so each is booked
// as a machine whose `field` names the columns that hold it. Transitions are named to_<state>; a birth
// (an insert) has no source state and is said in `about`; a write that keeps the state is not listed.

import { Schema } from "effect";
import { defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_access } from "../shared/foundation.ts";
import { event_referral_transitioned, event_waitlist_entry_transitioned } from "../shared/vocabulary.ts";

const A = "packages/backend/src/access";
const T = `${A}/tables.ts`;
const SCHEMA = "packages/backend/convex/schema.ts";

const opt = Schema.optionalKey;
const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const Strings = Schema.Array(S);

const KEPT = "Kept indefinitely: no job in the old code deletes or expires these rows.";
const COMPONENT =
  "A BetterAuth component table (@convex-dev/better-auth 0.12.3): its full columns and indexes are the component's and are " +
  "not in the repository, so only the columns Capxul code names are listed and no index is booked.";

// ── application consent and the OTP cooldown ────────────────────────────────────────────────

export const table_user_app_consents = defineTable({
  id: "user-app-consents",
  title: "A person's consent to an application",
  about:
    "One row per person and application: the scopes they consented to and when, and `revokedAt` once revoked. " +
    "`requireConsentedUser` admits only a live row (none or revoked is NOT_AUTHENTICATED). A native client accept " +
    "merges `account:read` into the row, re-granting a revoked consent for that merged scope set only " +
    "(clients/writes/consent.ts:16). Operator's probe fixtures insert, un-revoke and revoke rows directly in this " +
    "table (operator/probes/writes.ts:35, :37, :42), past Access's door. No product operation revokes a consent.",
  was: [`${T}:15`, `${SCHEMA}:54`, `${A}/sessions/guards.ts:135`, `${A}/clients/writes/consent.ts:16`, "packages/backend/src/operator/probes/writes.ts:35"],
  concept: concept_access,
  tenancy: "person",
  tenantField: "authUserId",
  fields: Schema.Struct({
    appId: S,
    authUserId: S,
    consentedAt: N,
    revokedAt: opt(N),
    scopes: Strings,
  }),
  key: ["authUserId", "appId"],
  indexes: [
    {
      name: "by_user_app",
      fields: ["authUserId", "appId"],
      for: "One person's consent to one application: requireConsentedUser (sessions/guards.ts:143), the native accept's merge (clients/writes/consent.ts:28), operator probes (operator/probes/reads.ts:26).",
    },
    { name: "by_app_user", fields: ["appId", "authUserId"], for: "None: no withIndex(\"by_app_user\") in the old code (gap)." },
    {
      name: "by_user",
      fields: ["authUserId"],
      for: "Every consent of a proof subject, deleted by removeProofSubjectAccessInTx (sessions/writes.ts:94).",
    },
    { name: "by_app", fields: ["appId"], for: "None: no withIndex(\"by_app\") in the old code (gap)." },
  ],
  retention: "Kept until an operator removes a proof subject (removeProofSubjectAccessInTx); a revoked consent stays as a row.",
});

export const table_otp_rate_limits = defineTable({
  id: "otp-rate-limits",
  title: "The OTP send cooldown, one row per email",
  about:
    "When the last sign-in code was sent to an email (lowercased by toEmail). BetterAuth's before-hook claims the row before " +
    "it rotates a code: inside the cooldown (OTP_COOLDOWN_MS, default 60 000 ms) the send is refused RATE_LIMITED with " +
    "Retry-After; otherwise `lastSentAt` moves to now, or a row is inserted. A delivery that fails gives back only its own " +
    "claim: the row returns to the earlier `lastSentAt`, or is deleted when there was none, unless a later claim already " +
    "moved it. Operator proof removal deletes a row.",
  was: [`${T}:28`, `${SCHEMA}:55`, `${A}/sessions/writes.ts:16`, `${A}/sessions/writes.ts:32`, `${A}/sessions/external/otp-delivery.ts:39`],
  concept: concept_access,
  tenancy: "person",
  tenantField: "email",
  fields: Schema.Struct({ email: S, lastSentAt: N }),
  key: ["email"],
  indexes: [
    {
      name: "by_email",
      fields: ["email"],
      for: "The cooldown row of one email: claim and release (sessions/reads.ts:85), proof removal (sessions/writes.ts:75).",
    },
  ],
  retention: "Kept indefinitely; a released claim with no earlier send deletes its row, and operator proof removal deletes one.",
});

// ── native client authorization (the CLI's device flow) ─────────────────────────────────────

const NATIVE_REQUEST_STATES = ["pending", "approved", "completed", "denied", "cancelled", "expired"] as const;

export const table_native_client_contexts = defineTable({
  id: "native-client-contexts",
  title: "Native client contexts: one per application, client and resource",
  about:
    "One row per application/client/resource triple (proofHash = SHA-256 of `applicationId|clientId|resource`), created on " +
    "the first device start and shared by every person who signs that client in. A grant is live only while its context " +
    "exists and the context's `epoch` equals the grant's `contextEpoch`. No writer bumps `epoch`: it is 0 from birth, so " +
    "the epoch retirement the table's comment describes never happens. Each issued grant overwrites `currentGrantId` and " +
    "`authUserId` with the latest grantee; a revoke unsets `currentGrantId` whoever holds it. `currentGrantId` and " +
    "`expiresAt` (90 days from creation) are written and never read. The operator purge deletes a context whose " +
    "`authUserId` is the purged person, which makes every other person's grant on it refuse `grant_revoked`.",
  was: [`${T}:38`, `${SCHEMA}:91`, `${A}/clients/writes/requests.ts:42`, `${A}/clients/writes/grants.ts:60`, `${A}/clients/writes/grants.ts:106`, `${A}/clients/rules.ts:184`, `${A}/clients/writes/purges.ts:18`],
  concept: concept_access,
  tenancy: "global",
  fields: Schema.Struct({
    proofHash: S,
    epoch: N,
    createdAt: N,
    expiresAt: N,
    authUserId: opt(S),
    currentGrantId: opt(S),
  }),
  key: ["proofHash"],
  indexes: [
    { name: "by_proof", fields: ["proofHash"], for: "The context of one application/client/resource, found or created at a device start (clients/reads/store.ts:53)." },
    { name: "by_expiry", fields: ["expiresAt"], for: "None: no sweep or read uses it; contexts are never expired (gap)." },
  ],
  retention: "Never swept: the daily sweep removes grants and requests only. The operator purge of a person deletes the contexts naming them.",
});

export const table_native_client_requests = defineTable({
  id: "native-client-requests",
  title: "Native client requests: one device authorization each",
  about:
    "One row per CLI device start for one email: the hashes of its device code, user code and continuity token (the " +
    "plaintext goes back once), the context it binds, its mode (login or signup, with the signup profile as JSON), its " +
    "state and stored refusal, a `revision` every decision bumps, the 5 s poll interval and once-markers for the funnel " +
    "(`reviewedAt`, `acceptedAt`, `connectedAt`). Accept records the deciding session (`authUserId`, `sessionId`, " +
    "`sessionCreatedAt`) and, when ready, the `accountId`; delivery records `grantId` and moves `expiresAt` to the grant's " +
    "absolute expiry so the request can re-derive the grant (R1). `userCodeHash` and `continuityTokenHash` are written and " +
    "never read; `consentedAt` and `signupLockOwner` are never written. Five starts per email in ten minutes are allowed.",
  was: [`${T}:49`, `${SCHEMA}:91`, `${A}/clients/writes/requests.ts:61`, `${A}/clients/writes/grants.ts:46`, `${A}/clients/rules.ts:161`],
  concept: concept_access,
  tenancy: "person",
  tenantField: "email",
  fields: Schema.Struct({
    requestId: S,
    deviceCodeHash: S,
    userCodeHash: S,
    continuityTokenHash: S,
    contextId: S,
    contextEpoch: N,
    applicationId: S,
    clientId: S,
    resource: S,
    email: S,
    mode: Schema.Literals(["login", "signup"]),
    profileJson: opt(S),
    state: Schema.Literals(NATIVE_REQUEST_STATES),
    refusal: opt(S),
    revision: N,
    createdAt: N,
    expiresAt: N,
    pollSeconds: N,
    lastPollAt: opt(N),
    reviewedAt: opt(N),
    acceptedAt: opt(N),
    connectedAt: opt(N),
    authUserId: opt(S),
    accountId: opt(S),
    sessionId: opt(S),
    sessionCreatedAt: opt(N),
    consentedAt: opt(N),
    signupLockOwner: opt(S),
    grantId: opt(S),
  }),
  key: ["requestId"],
  indexes: [
    {
      name: "by_request",
      fields: ["requestId"],
      for: "One request by id (.unique()): review, both browser decisions, the browser read (clients/reads/store.ts:25).",
    },
    {
      name: "by_device",
      fields: ["deviceCodeHash"],
      for: "The request a presented device code names (.unique()): the CLI's poll and its cancel (clients/reads/store.ts:33).",
    },
    { name: "by_user_code", fields: ["userCodeHash"], for: "None: nothing looks a request up by its user code (gap)." },
    { name: "by_signup_owner", fields: ["signupLockOwner"], for: "None: the column is never written (gap)." },
    {
      name: "by_email_created",
      fields: ["email", "createdAt"],
      for: "The starts of one email inside the ten-minute window, for the start limit (clients/reads/store.ts:62).",
    },
    { name: "by_expiry", fields: ["expiresAt"], for: "The daily sweep's requests past retention, 100 per batch (clients/writes/sweep.ts:38)." },
  ],
  retention:
    "Deleted by the daily sweep 24 h after `expiresAt`, except a completed row whose grant still exists; a completed row's " +
    "`expiresAt` is its grant's absolute expiry (90 days). The operator purge deletes a person's rows.",
});

export const table_native_client_grants = defineTable({
  id: "native-client-grants",
  title: "Native client grants: the CLI's re-derivable credential",
  about:
    "One row per grant a delivered request issued. It holds no credential: both native tokens are JWTs over `grantId` and " +
    "`revision` (audiences capxul-native-access and capxul-native-refresh) that can be signed again from the row. A refresh " +
    "advances `revision` and keeps the spent one valid for 60 s (`previousRevisionValidUntil`); a reuse of an older " +
    "revision, or a refresh past the renewal window, stamps `revokedAt`. There is no state column: a grant is revoked by " +
    "`revokedAt` or a missing or re-epoched context, and expired by `renewalExpiresAt` (30 days, sliding) or " +
    "`absoluteExpiresAt` (90 days), judged at each read. `revokedRevision` is written and never read.",
  was: [`${T}:97`, `${SCHEMA}:91`, `${A}/clients/writes/grants.ts:24`, `${A}/clients/writes/grants.ts:81`, `${A}/clients/writes/grants.ts:102`, `${A}/clients/rules.ts:184`, "packages/protocol/src/access/native-client-schema.ts:25"],
  concept: concept_access,
  tenancy: "person",
  tenantField: "authUserId",
  fields: Schema.Struct({
    grantId: S,
    requestId: S,
    contextId: S,
    contextEpoch: N,
    clientId: S,
    applicationId: S,
    resource: S,
    authUserId: S,
    email: S,
    accountId: S,
    revision: N,
    createdAt: N,
    renewalExpiresAt: N,
    absoluteExpiresAt: N,
    previousRevisionValidUntil: opt(N),
    revokedAt: opt(N),
    revokedRevision: opt(N),
  }),
  key: ["grantId"],
  indexes: [
    {
      name: "by_grant",
      fields: ["grantId"],
      for: "One grant by id (.unique()): rotation, revoke, the session read, R1 re-derivation (clients/reads/store.ts:42), and the request sweep's live-grant check (clients/writes/sweep.ts:44).",
    },
    { name: "by_request", fields: ["requestId"], for: "None: no withIndex(\"by_request\") on grants (gap)." },
    { name: "by_expiry", fields: ["absoluteExpiresAt"], for: "The daily sweep's grants past retention, 100 per batch (clients/writes/sweep.ts:19)." },
  ],
  retention: "Deleted by the daily sweep 24 h after `absoluteExpiresAt`; a revoked grant stays until then. The operator purge deletes a person's grants.",
});

// ── feature gates ───────────────────────────────────────────────────────────────────────────

export const table_feature_gates = defineTable({
  id: "feature-gates",
  title: "Feature gates written on a devnet",
  about:
    "The gate table (scenario oracle 06): one row per gate key and Organization, or key and person. Only a local devnet " +
    "writes it (`requireLocalDevnet`; `capxul dev gates set`). The guard reads it while the deployment's gates come from " +
    "the table (`featureSetting().source === \"table\"`: a devnet always, any other tier unless CAPXUL_FEATURE_SYNC=posthog); " +
    "with no row the catalogue default for the environment holds, and a gate with rows for both targets needs both on. " +
    "`updatedBy` is the writer's authUserId.",
  was: [`${T}:134`, `${SCHEMA}:92`, `${A}/features/reads.ts:32`, `${A}/features/writes.ts:13`, `${A}/features/rules.ts:107`],
  concept: concept_access,
  tenancy: "global",
  fields: Schema.Struct({
    key: S,
    orgId: opt(S),
    authUserId: opt(S),
    on: B,
    source: Schema.Literal("devnet"),
    updatedAt: N,
    updatedBy: S,
  }),
  key: ["key", "orgId", "authUserId"],
  indexes: [
    {
      name: "by_key_org",
      fields: ["key", "orgId"],
      for: "The gate row for one key and Organization: the guard's read and the set's upsert (features/reads.ts:38, :54).",
    },
    {
      name: "by_key_person",
      fields: ["key", "authUserId"],
      for: "The gate row for one key and person: the guard's read and setMine's upsert (features/reads.ts:45, :62).",
    },
  ],
  retention: KEPT,
});

export const table_feature_flags = defineTable({
  id: "feature-flags",
  title: "Synced PostHog feature flag definitions",
  about:
    "The synced copy of each catalogue flag's PostHog definition, as the local evaluator reads it: active, the target " +
    "(person, or organization when the flag aggregates by the Organization group), and conditions of ids (null names " +
    "everyone) with a rollout percentage. A rule the evaluator cannot read (a cohort, a property, a variant, another " +
    "group) is kept as `unsupported` and the gate reads off. A good sync deletes every row and inserts the run's flags; a " +
    "failed sync leaves the copy as it was.",
  was: [`${T}:146`, `${SCHEMA}:92`, `${A}/features/writes.ts:71`, `${A}/features/rules.ts:186`, `${A}/features/reads.ts:69`],
  concept: concept_access,
  tenancy: "global",
  fields: Schema.Struct({
    key: S,
    active: B,
    target: Schema.Literals(["person", "organization"]),
    conditions: Schema.Array(Schema.Struct({ ids: Schema.NullOr(Strings), rollout: N })),
    unsupported: opt(S),
    definitionHash: S,
    syncedAt: N,
  }),
  key: ["key"],
  indexes: [{ name: "by_key", fields: ["key"], for: "One flag's synced definition, read by the guard on the PostHog source (features/reads.ts:69)." }],
  retention: "Replaced as a whole by every good sync (a delete of every row, then inserts).",
});

export const table_feature_syncs = defineTable({
  id: "feature-syncs",
  title: "PostHog feature sync runs",
  about:
    "One row per sync run that reached PostHog's switch: `synced` with the definitions' SHA-256, the flag count, the PostHog " +
    "flags not in the catalogue (`ignored`) and the catalogue flags the evaluator cannot read (`unsupported`); or `failed` " +
    "with a closed reason (`posthog_unavailable`, `not_configured`). The guard reads the last `synced` run's time: a money " +
    "gate is off (`stale`) when it is older than 10 minutes. No business key: rows are found by outcome and time.",
  was: [`${T}:157`, `${SCHEMA}:92`, `${A}/features/writes.ts:71`, `${A}/features/reads.ts:85`, `${A}/features/rules.ts:83`],
  concept: concept_access,
  tenancy: "global",
  fields: Schema.Struct({
    at: N,
    outcome: Schema.Literals(["synced", "failed"]),
    definitionHash: opt(S),
    flags: N,
    ignored: Strings,
    unsupported: Strings,
    reason: opt(S),
  }),
  key: ["_id"],
  indexes: [
    { name: "by_outcome_at", fields: ["outcome", "at"], for: "The latest run with outcome `synced`, read by the guard (features/reads.ts:85, ordered desc)." },
  ],
  retention: "Kept indefinitely: the sync appends one row a minute while it runs, and nothing deletes them.",
});

// ── the beta waitlist ───────────────────────────────────────────────────────────────────────

export const table_beta_waitlist = defineTable({
  id: "beta-waitlist",
  title: "The beta waitlist: one row per normalized email",
  about:
    "Who asked for the permissioned beta (CAP-1019) and who is admitted. A row is born by the request form, a held sign-in, " +
    "`waitlist join`, or an admission of an email not on the list (operator, invitation, referral); `joinedVia` keeps how. " +
    "A second request keeps the first time and way; only the signed-in person changes a note already there. `admittedAt` " +
    "and `admittedBy` (`operator:<label>`, `invitation:<orgId>`, `referral:<email>`) are set once and never undone. " +
    "`welcomeSentAt` marks the welcome email. Where a person stands also depends on the `beta-access` gate (admitted, " +
    "open or waiting), which is not stored. The table's comment says a beta reset keeps it.",
  was: [`${T}:176`, `${SCHEMA}:93`, `${A}/waitlist/writes.ts:32`, `${A}/waitlist/writes.ts:71`, `${A}/waitlist/rules.ts:24`],
  concept: concept_access,
  tenancy: "person",
  tenantField: "email",
  fields: Schema.Struct({
    email: S,
    note: opt(S),
    joinedVia: Schema.Literals(["form", "sign-in", "invitation", "operator", "referral"]),
    requestedAt: N,
    admittedAt: opt(N),
    admittedBy: opt(S),
    welcomeSentAt: opt(N),
    updatedAt: N,
  }),
  key: ["email"],
  indexes: [
    { name: "by_email", fields: ["email"], for: "The row of one normalized email: every waitlist read and write (waitlist/reads.ts:16)." },
    {
      name: "by_admitted_requested",
      fields: ["admittedAt", "requestedAt"],
      for: "The operator's waiting list, oldest first: rows with no admittedAt (waitlist/reads.ts:52). The admitted and all lists read the whole table.",
    },
  ],
  retention: KEPT,
});

export const table_beta_waitlist_windows = defineTable({
  id: "beta-waitlist-windows",
  title: "The request form's per-IP window",
  about:
    "One row per client IP (the first `x-forwarded-for` entry, or `unknown`): the start of its one-hour window and how many " +
    "form requests it took. Five per window; the sixth is RATE_LIMITED until the window ends. A request after the window " +
    "starts a new one on the same row. Every request without a forwarded IP shares the `unknown` row.",
  was: [`${T}:199`, `${SCHEMA}:93`, `${A}/waitlist/writes.ts:100`, `${A}/waitlist/rules.ts:60`, `${A}/waitlist/operations/request.ts:29`],
  concept: concept_access,
  tenancy: "global",
  fields: Schema.Struct({ ip: S, windowStartMs: N, count: N }),
  key: ["ip"],
  indexes: [{ name: "by_ip", fields: ["ip"], for: "The window of one IP, claimed by every form request (waitlist/reads.ts:63)." }],
  retention: KEPT,
});

// ── referrals ───────────────────────────────────────────────────────────────────────────────

export const table_referral_codes = defineTable({
  id: "referral-codes",
  title: "Referral codes and invites, one row per person's email",
  about:
    "A person's referral code (8 characters of 23456789ABCDEFGHJKLMNPQRSTUVWXYZ, drawn again on a clash) and their invites: " +
    "`invitesLeft` to spend and `invitesGranted`, every invite ever given, which the cap of 10 counts. An admitted person " +
    "gets 3 starting invites once (`startedAt`), the first time a code read finds them admitted; a qualified referral adds " +
    "one within the cap; an operator's grant adds any count past it. `authUserId` is set when the person asked for their " +
    "link, so their referral events reach them; an operator's grant or a reward can make the row first, without it.",
  was: [`${T}:213`, `${SCHEMA}:94`, `${A}/referrals/writes.ts:38`, `${A}/referrals/rules.ts:6`, `${A}/referrals/rules.ts:74`],
  concept: concept_access,
  tenancy: "person",
  tenantField: "email",
  fields: Schema.Struct({
    email: S,
    authUserId: opt(S),
    code: S,
    invitesLeft: N,
    invitesGranted: N,
    startedAt: opt(N),
    createdAt: N,
  }),
  key: ["email"],
  indexes: [
    { name: "by_email", fields: ["email"], for: "One person's code row: show, invite, qualify, grant, and a referral's referrer (referrals/reads.ts:16)." },
    {
      name: "by_code",
      fields: ["code"],
      crossTenant: true,
      for: "The owner of a typed code, for `waitlist join --ref`, and the clash check of a fresh code (referrals/reads.ts:24).",
    },
  ],
  retention: KEPT,
});

export const table_referrals = defineTable({
  id: "referrals",
  title: "Referrals: who brought each person, and how far they came",
  about:
    "One row per referred email (the first referral wins), keyed by normalized emails so it works before the friend has an " +
    "account: the referrer, `via` (a link through `waitlist join --ref`, or an invite an admitted person spent), and the " +
    "time of each stage: attributed, admitted, qualified (their Safe went live), rewarded, or voided with a reason. Phase 1 " +
    "rewards access only. `self_referral` is a void reason no code produces.",
  was: [`${T}:229`, `${SCHEMA}:94`, `${A}/referrals/writes.ts:96`, `${A}/referrals/views.ts:8`, "packages/protocol/src/access/operations.ts:143"],
  concept: concept_access,
  tenancy: "person",
  tenantField: "refereeEmail",
  fields: Schema.Struct({
    referrerEmail: S,
    refereeEmail: S,
    via: Schema.Literals(["link", "invite"]),
    attributedAt: N,
    admittedAt: opt(N),
    qualifiedAt: opt(N),
    rewardedAt: opt(N),
    voidedAt: opt(N),
    voidReason: opt(Schema.Literals(["self_referral", "disposable_email", "operator"])),
  }),
  key: ["refereeEmail"],
  indexes: [
    {
      name: "by_referee",
      fields: ["refereeEmail"],
      for: "The referral that brought one email (.first()): attribution, admission, qualify, void, status (referrals/reads.ts:32).",
    },
    { name: "by_referrer", fields: ["referrerEmail", "attributedAt"], for: "A person's referrals, newest first: show and list (referrals/reads.ts:40)." },
  ],
  retention: KEPT,
});

// ── BetterAuth component tables ─────────────────────────────────────────────────────────────

export const table_better_auth_user = defineTable({
  id: "better-auth-user",
  title: "BetterAuth users: the person a session signs in",
  about:
    `The component's \`user\` model. Its \`_id\` is the authUserId every app table names. BetterAuth creates a row at the first ` +
    `email-OTP sign-in; operator fixtures create one verified (ensureProofAuthUserInTx) and delete them by email. ` +
    `sessionUsers reads it to answer who is signed in; the agent exchange copies its columns (but id and image) into the ` +
    `Convex token. ${COMPONENT}`,
  was: [`${A}/sessions/reads.ts:47`, `${A}/sessions/writes.ts:45`, `${A}/sessions/writes.ts:110`, `${A}/agents/reads.ts:31`, "packages/backend/convex/convex.config.ts:6"],
  concept: concept_access,
  tenancy: "person",
  scope: "The row is the person: its `_id` is the authUserId.",
  fields: Schema.Struct({
    _id: S,
    email: S,
    name: opt(S),
    emailVerified: opt(B),
    image: opt(S),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["_id"],
  indexes: [],
});

export const table_better_auth_session = defineTable({
  id: "better-auth-session",
  title: "BetterAuth sessions",
  about:
    `The component's \`session\` model: one row per signed-in browser, CLI cookie jar or agent. sessionUsers admits the session ` +
    `a Convex token's \`sessionId\` claim names while \`expiresAt\` is in the future. The agent exchange reuses or creates one ` +
    `session per agent client with \`userAgent\` \`capxul-agent/<clientId>\` and a one-hour expiry. Sign-out deletes the row; ` +
    `operator proof removal deletes a subject's sessions (100 per call). ${COMPONENT}`,
  was: [`${A}/sessions/reads.ts:39`, `${A}/agents/writes.ts:15`, `${A}/sessions/writes.ts:99`, `${A}/clients/reads/endpoints.ts:61`],
  concept: concept_access,
  tenancy: "person",
  tenantField: "userId",
  fields: Schema.Struct({
    _id: S,
    userId: S,
    token: S,
    expiresAt: N,
    createdAt: N,
    userAgent: opt(S),
  }),
  key: ["_id"],
  indexes: [],
});

export const table_better_auth_account = defineTable({
  id: "better-auth-account",
  title: "BetterAuth accounts (sign-in methods)",
  about: `The component's \`account\` model. Capxul code names only \`userId\`: operator proof removal deletes a subject's rows (100 per call). ${COMPONENT}`,
  was: [`${A}/sessions/writes.ts:103`],
  concept: concept_access,
  tenancy: "person",
  tenantField: "userId",
  fields: Schema.Struct({ _id: S, userId: S }),
  key: ["_id"],
  indexes: [],
});

export const table_better_auth_verification = defineTable({
  id: "better-auth-verification",
  title: "BetterAuth verifications: pending one-time codes",
  about:
    `The component's \`verification\` model: emailOTP keeps each pending code under \`<type>-otp-<email>\` with \`value\` ` +
    `\`<otp>:<attempts>\` and an expiry (OTP_EXPIRY_SECONDS 300, 3 attempts). Operator proof reads pick the newest unexpired ` +
    `code. Operator proof removal deletes rows whose identifier equals the bare email, which is not the identifier emailOTP ` +
    `writes, so it removes no code. ${COMPONENT}`,
  was: [`${A}/sessions/reads.ts:103`, `${A}/sessions/rules.ts:205`, `${A}/sessions/writes.ts:110`, `${A}/sessions/external/auth.ts:197`, "packages/protocol/src/access/policy.ts:11"],
  concept: concept_access,
  tenancy: "person",
  scope: "By `identifier`, which carries the email (`sign-in-otp-<email>`, `email-verification-otp-<email>`).",
  fields: Schema.Struct({ _id: S, identifier: S, value: S, expiresAt: N }),
  key: ["_id"],
  indexes: [],
});

export const table_better_auth_jwks = defineTable({
  id: "better-auth-jwks",
  title: "BetterAuth signing keys (JWKS)",
  about:
    `The component's \`jwks\` model: the RS256 key pairs that sign every Convex JWT, native client token, OIDC access token and ` +
    `agent exchange token, served at /api/auth/convex/jwks. Capxul's signing options read the keys newest first and stamp ` +
    `\`createdAt\` on a new one; the Convex plugin rotates the keys when token generation fails ` +
    `(jwksRotateOnTokenGenerationError). ${COMPONENT}`,
  was: [`${A}/external.ts:34`, `${A}/external.ts:53`, `${A}/external.ts:64`, `${A}/sessions/external/auth.ts:141`, `${A}/sessions/external/auth.ts:171`],
  concept: concept_access,
  tenancy: "global",
  fields: Schema.Struct({ _id: S, createdAt: N, expiresAt: opt(N) }),
  key: ["_id"],
  indexes: [],
});

export const table_better_auth_oauth_application = defineTable({
  id: "better-auth-oauth-application",
  title: "OIDC provider applications (dynamically registered agent clients)",
  about:
    `The component's \`oauthApplication\` model, written by oidcProvider's dynamic client registration (POST /oauth2/register, ` +
    `allowDynamicClientRegistration). Capxul's after-hook sets \`type\` to \`public\` for a registration with ` +
    `token_endpoint_auth_method none. ${COMPONENT}`,
  was: [`${A}/agents/writes.ts:36`, `${A}/sessions/external/auth.ts:162`],
  concept: concept_access,
  tenancy: "global",
  fields: Schema.Struct({ clientId: S, type: S }),
  key: ["clientId"],
  indexes: [],
});

export const table_better_auth_oauth_access_token = defineTable({
  id: "better-auth-oauth-access-token",
  title: "OIDC provider access tokens",
  about:
    `The component's \`oauthAccessToken\` model: the access tokens oidcProvider issues to agents (one hour; refresh 90 days), ` +
    `with their user, client and space-delimited scopes. The agent exchange finds the row by \`accessToken\` and admits it ` +
    `while \`accessTokenExpiresAt\` is in the future. ${COMPONENT}`,
  was: [`${A}/agents/reads.ts:19`, `${A}/sessions/external/auth.ts:160`],
  concept: concept_access,
  tenancy: "person",
  tenantField: "userId",
  fields: Schema.Struct({
    accessToken: S,
    userId: S,
    clientId: S,
    scopes: S,
    accessTokenExpiresAt: N,
  }),
  key: ["accessToken"],
  indexes: [],
});

export const table_better_auth_oauth_consent = defineTable({
  id: "better-auth-oauth-consent",
  title: "OIDC provider consents",
  about:
    `The component's \`oauthConsent\` model, which oidcProvider writes when a person allows an agent on the consent page ` +
    `(POST /api/auth/oauth2/consent). No Capxul code names a column, so its fields are Unknown. ${COMPONENT}`,
  was: [`${A}/sessions/external/auth.ts:126`, `${A}/agents/views/pages.ts:149`],
  concept: concept_access,
  tenancy: "person",
  scope: "The component keys a consent by user and client; no Capxul code names its columns.",
  fields: Schema.Unknown,
  key: ["_id"],
  indexes: [],
});

// ── state machines ──────────────────────────────────────────────────────────────────────────

export const machine_native_client_request = defineMachine({
  id: "native-client-request",
  title: "Native client request state",
  about:
    "nativeClientRequests.state, the issuer's persisted state; the browser's five phases (otp_required, review, processing, " +
    "connected, refused) are a projection of it (clients/views/requests.ts:140). Every decision bumps `revision`. Writes that " +
    "keep the state are not listed: a signup the person accepted while setup is owed stays pending, adopted by them " +
    "(adoptSignup); a second accept of an approved row approves it again; a review stamp; a pending poll's `lastPollAt`. " +
    "The product events of the native authorization funnel are scheduled by the HTTP endpoints, not by these writes, so " +
    "no transition emits one.",
  was: [`${T}:5`, `${A}/clients/writes/requests.ts:61`, `${A}/clients/views/requests.ts:140`, "packages/protocol/src/access/status.ts:1"],
  table: table_native_client_requests,
  field: "state",
  initial: "pending",
  states: [
    {
      id: "pending",
      about: "Opened by the CLI's device start (a birth). The person has not decided, or said yes to a signup that still owes Profile or Account setup.",
    },
    { id: "approved", about: "The person said yes and is ready (complete Profile, native-ready Account); the CLI's next poll takes the grant." },
    {
      id: "completed",
      about: "The poll issued the grant. Kept until the grant's absolute expiry, so a lost response re-derives the same grant (R1).",
      terminal: true,
    },
    { id: "denied", about: "The person said no, or a signup arrived for someone already signed up (`already_signed_up`).", terminal: true },
    { id: "cancelled", about: "The CLI withdrew the request before delivery (/native/revoke with token_type_hint device_code).", terminal: true },
    { id: "expired", about: "The request window passed before delivery; recorded when a decision or a poll first finds it late.", terminal: true },
  ],
  transitions: {
    to_approved: {
      from: ["pending"],
      to: "approved",
      about: "acceptRequest when readiness holds (clients/writes/requests.ts:137, clients/operations/accept-request.ts:67).",
      guard:
        "admitDecision: not terminal, not completed, not past expiresAt, the presented revision, the request's exact email, and a session not created more than 30 s before the request.",
      emits: [],
    },
    to_completed: {
      from: ["approved"],
      to: "completed",
      about: "issueGrant on the CLI's first poll after approval (clients/writes/grants.ts:182, clients/operations/consume-request.ts:61).",
      guard: "Not inside the 5 s poll interval; the row names its person and Account.",
      emits: [],
    },
    to_denied: {
      from: ["pending", "approved"],
      to: "denied",
      about:
        "denyRequest (refusal request_denied), or acceptRequest when a signup arrives ready for a person who did not adopt it (refusal already_signed_up) (clients/writes/requests.ts:106).",
      guard: "admitDecision, as for an accept.",
      emits: [],
    },
    to_cancelled: {
      from: ["pending", "approved"],
      to: "cancelled",
      about: "cancelRequest by device code (clients/operations/cancel-request.ts:31).",
      guard: "Refused for a terminal or completed request.",
      emits: [],
    },
    to_expired: {
      from: ["pending", "approved"],
      to: "expired",
      about: "expireRequest, from a decision's admission or the CLI's poll (clients/guards.ts:26, clients/operations/consume-request.ts:29).",
      guard: "now > expiresAt and the row is not completed.",
      emits: [],
    },
  },
});

export const machine_waitlist_entry = defineMachine({
  id: "waitlist-entry",
  title: "Beta waitlist entry: requested or admitted",
  about:
    "No state column: an entry is admitted when `admittedAt` is set (waitlist/rules.ts:24). The birth of a row sends " +
    "waitlist_entry_transitioned `joined` with how it came and whether a live referral brought it (waitlist/writes.ts:57); " +
    "an admission of an email not on the list inserts it (joined) and admits it in the same write (admitted). Where a " +
    "person stands for the guard (admitted, open, waiting) also reads the `beta-access` gate, which is not stored.",
  was: [`${A}/waitlist/writes.ts:32`, `${A}/waitlist/writes.ts:71`, `${A}/referrals/events.ts:20`],
  table: table_beta_waitlist,
  field: "admittedAt",
  initial: "requested",
  states: [
    { id: "requested", about: "On the list, not admitted: a form request, a held sign-in, `waitlist join`, or the joined half of an admission." },
    { id: "admitted", about: "Admitted by an operator, an Organization's invitation or a referral; `admittedAt` and `admittedBy` are never undone.", terminal: true },
  ],
  transitions: {
    to_admitted: {
      from: ["requested"],
      to: "admitted",
      about:
        "admitInTx (waitlist/writes.ts:71): the operator's admit, an invitation (admitInvitedInTx), a referral invite, or a waiting referrer's reward in qualify.",
      guard: "An entry already admitted is left as it is and reported `admitted: false`, so the welcome goes once.",
      emits: [event_waitlist_entry_transitioned],
    },
  },
});

export const machine_referral = defineMachine({
  id: "referral",
  title: "Referral stage",
  about:
    "No state column: the stage is the last of four timestamps set (`stageOf`, referrals/views.ts:8: voided, rewarded, " +
    "qualified, admitted, else attributed). Each move schedules referral_transitioned as the referrer's person when their code " +
    "row names one, else as the `referrals` system job. The birth (attributeInTx, referrals/writes.ts:96) sends `attributed`. " +
    "The protocol names the stages REFERRAL_STAGES.",
  was: [`${A}/referrals/views.ts:8`, `${A}/referrals/writes.ts:96`, `${A}/referrals/events.ts:41`, "packages/protocol/src/access/operations.ts:143"],
  table: table_referrals,
  field: "admittedAt | qualifiedAt | rewardedAt | voidedAt",
  initial: "attributed",
  states: [
    { id: "attributed", about: "Tied to the referrer by a link (`waitlist join --ref`) or an invite; the first referral of an email wins." },
    { id: "admitted", about: "The waitlist admitted the referred person." },
    { id: "qualified", about: "The referred person's Safe went live; with the cap reached, no reward follows." },
    { id: "rewarded", about: "The referrer got one more invite, or, still waiting, their own admission." },
    { id: "voided", about: "Taken back by an operator, or for a throwaway mailbox at qualify; it earns nothing more. An admission it gave stays.", terminal: true },
  ],
  transitions: {
    to_admitted: {
      from: ["attributed"],
      to: "admitted",
      about: "markReferralAdmittedInTx, called by every waitlist admission (referrals/writes.ts:124, waitlist/writes.ts:90).",
      guard: "Not admitted already and not voided.",
      emits: [event_referral_transitioned],
    },
    to_qualified: {
      from: ["attributed", "admitted"],
      to: "qualified",
      about: "markQualifiedInTx in qualify when the referred person's Safe goes live (referrals/writes.ts:136); an open beta-access gate lets a person claim without an admission.",
      guard: "Not voided, not qualified already, and not a disposable mailbox.",
      emits: [event_referral_transitioned],
    },
    to_rewarded: {
      from: ["qualified"],
      to: "rewarded",
      about: "markRewardedInTx in the same qualify write (referrals/writes.ts:146), with reward_kind admission or invites.",
      guard: "A referrer already admitted is rewarded only while the start and rewards stay within the cap of 10.",
      emits: [event_referral_transitioned],
    },
    to_voided: {
      from: ["attributed", "admitted", "qualified", "rewarded"],
      to: "voided",
      about: "voidReferralInTx: the operator's void (reason operator), or qualify finding a disposable mailbox (reason disposable_email) (referrals/writes.ts:162).",
      guard: "Not voided already.",
      emits: [event_referral_transitioned],
    },
  },
});
