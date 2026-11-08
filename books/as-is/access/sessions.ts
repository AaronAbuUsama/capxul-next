// The as-is book of the old access concept: the sessions area, and the BetterAuth routes the
// session factory serves.
//
// Registered at `access/sessions:*` (packages/backend/convex/access/sessions.ts): one public query
// (row `access.sessions.currentUser`, packages/protocol/src/access/operations.ts:17) and three
// internal functions the session factory runs in the same request. Nothing here is scheduled or
// cron-driven, so every one is an rpc.
//
// The BetterAuth routes. `convex/http.ts:74` mounts every route of the BetterAuth instance
// `createAuth` builds (sessions/external/auth.ts:111) under /api/auth, each observed as the one
// operation `access.auth.request` with its route and status. The routes Capxul configures or its
// clients call are booked one by one under `access.auth.<route>`: the code's own operation group
// (`CAPXUL_OPERATIONS.access.auth`), because no operation file names them. The OIDC provider's
// /oauth2/* routes are in agents.ts, beside the agent pages they serve; the native client routes are
// in clients.ts. Every other mounted route is the one rpc `access.auth.request`. A route's touches
// fold in the internal functions it runs (claimOtpSend, releaseOtpSendClaim, scopeForIssuer).
//
// Every auth route builds `createAuth` per request, which needs SITE_URL and the three
// SHIELD_* secrets (requireEnvOrThrow, ENV_MISSING) and, with CAPXUL_E2E_AUTH_ENABLED, a consistent
// reserved e2e configuration (ENV_MISSING naming the reason). Trusted origins are SITE_URL, the
// Xelmar Capxul Vercel preview family, CAPXUL_TRUSTED_ORIGINS and, per request, an origin an active
// test publishable key lists (internal query `applications.keys.trustsOrigin`).

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";
import { concept_access } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_OTP_EXPIRED,
  error_PROVIDER_ERROR,
  error_RATE_LIMITED,
  error_UNKNOWN,
  event_auth_otp_delivered,
} from "../shared/vocabulary.ts";
import { integration_mail, integration_openfort_shield } from "../shared/external.ts";
import {
  table_better_auth_account,
  table_better_auth_jwks,
  table_better_auth_session,
  table_better_auth_user,
  table_better_auth_verification,
  table_otp_rate_limits,
} from "./data.ts";
import { procedure_access_authenticated_user } from "./procedures.ts";
import { procedure_accounts_read_owned_safe_addresses_in_tx } from "../accounts/procedures.ts";
import { procedure_organizations_read_participating_safe_addresses_in_tx } from "../organizations/procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/access/sessions.ts`;
const HTTP = `${BACKEND}/convex/http.ts`;
const A = `${BACKEND}/src/access`;
const SESS = `${A}/sessions`;
const OPS = `${SESS}/operations`;
const AUTH = `${SESS}/external/auth.ts`;
const OTP = `${SESS}/external/otp-delivery.ts`;
const ROUTES = `${BACKEND}/src/platform/observation/routes.ts`;
const ROWS = "packages/protocol/src/access/operations.ts";

const S = Schema.String;
const N = Schema.Number;
const U = Schema.Unknown;
const opt = Schema.optionalKey;


/** What every auth route can fail with before it does anything: the factory's configuration, and a defect. */
const FACTORY_ERRORS = [error_ENV_MISSING, error_UNKNOWN];
const FACTORY_WAS = [
  `${AUTH}:111`,
  `${AUTH}:112`,
  `${AUTH}:113`,
  `${AUTH}:39`,
  `${AUTH}:59`,
  `${AUTH}:190`,
  `${SESS}/rules.ts:56`,
  `${SESS}/errors.ts:26`,
  `${HTTP}:74`,
  `${ROUTES}:32`,
];
/** The convex/http.ts mount: every BetterAuth route is one observed row named access.auth.request. */
const MOUNT_WAS = [`${HTTP}:74`, `${HTTP}:75`, "packages/observability/src/operations/access.ts:11"];

// ── access/sessions:* ───────────────────────────────────────────────────────────────────────

export const rpc_access_sessions_current_user = defineRpc({
  id: "access.sessions.current-user",
  title: "The signed-in person's root identity",
  about:
    "Row `access.sessions.currentUser`, registered as `access/sessions:currentUser`. `signedIn` (the BetterAuth user of the " +
    "caller's live session, through sessionUsers) and nothing else: it reads no app row, consent or Account. Answers the " +
    "user's id, email and name (null when BetterAuth has none). No session is NOT_AUTHENTICATED.",
  was: [`${CONVEX}:3`, `${OPS}/current-user.ts:8`, `${ROWS}:17`, `${ROWS}:11`, `${BACKEND}/src/platform/session.ts:17`],
  concept: concept_access,
  kind: "query",
  who: "A signed-in person (any BetterAuth session, including an agent exchange token's).",
  input: Schema.Struct({}),
  output: Schema.Struct({ id: S, email: S, name: Schema.NullOr(S) }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_access_authenticated_user],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_sessions_claim_otp_send = defineRpc({
  id: "access.sessions.claim-otp-send",
  title: "Claim an email's OTP send cooldown",
  about:
    "Internal mutation `access/sessions:claimOtpSend`, run by the OTP send route before BetterAuth rotates a code. Inside the " +
    "cooldown it answers `claimed: false` with the last send time; otherwise it moves the row's `lastSentAt` to `now` (or " +
    "inserts one) and answers the claim with the time it replaced. The caller passes `now` and the cooldown.",
  was: [`${CONVEX}:6`, `${OPS}/claim-otp-send.ts:13`, `${OPS}/claim-otp-send.ts:23`, `${OPS}/claim-otp-send.ts:30`, `${SESS}/reads.ts:85`, `${SESS}/writes.ts:16`, `${SESS}/rules.ts:165`],
  concept: concept_access,
  kind: "mutation",
  who: "internal: the BetterAuth OTP send route's before-hook, or its send callback for a direct send.",
  input: Schema.Struct({ email: S, now: N, cooldownMs: N }),
  output: Schema.Struct({ claimed: Schema.Boolean, claimedAt: Schema.NullOr(N), previousLastSentAt: Schema.NullOr(N) }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_otp_rate_limits],
  writes: [table_otp_rate_limits],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_sessions_release_otp_send_claim = defineRpc({
  id: "access.sessions.release-otp-send-claim",
  title: "Give back a failed delivery's OTP cooldown claim",
  about:
    "Internal mutation `access/sessions:releaseOtpSendClaim`. Only when the row still holds this claim's time: restores the " +
    "earlier send time, or deletes the row when the claim created it. A later claim that already moved the row keeps it. " +
    "Its caller reports a failure of this release to PostHog and keeps the send's outcome.",
  was: [`${CONVEX}:7`, `${OPS}/release-otp-send-claim.ts:15`, `${OPS}/release-otp-send-claim.ts:26`, `${OPS}/release-otp-send-claim.ts:29`, `${SESS}/writes.ts:32`, `${OTP}:119`],
  concept: concept_access,
  kind: "mutation",
  who: "internal: the OTP send route, when delivery failed or the send never used its claim.",
  input: Schema.Struct({ email: S, claimedAt: N, previousLastSentAt: Schema.NullOr(N) }),
  output: Schema.Null,
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_otp_rate_limits],
  writes: [table_otp_rate_limits],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_sessions_scope_for_issuer = defineRpc({
  id: "access.sessions.scope-for-issuer",
  title: "The indexer read scope signed into a Convex JWT",
  about:
    "Internal query `access/sessions:scopeForIssuer`, run by the Convex plugin's payload hook whenever it signs a Convex JWT. " +
    "The person's own Safes (accounts' readOwnedSafeAddressesInTx) and the Safes of the Organizations they take part in " +
    "(organizations' readParticipatingSafeAddressesInTx) on Base Sepolia (84532) only, lowercased, deduplicated and sorted, as " +
    "`{authUserId, safes}`. It grants no command authority. The indexer trusts the signed `safes` claim until the token expires " +
    "and never asks again, so a removed member keeps reading for the rest of that token (CAP-596).",
  was: [`${CONVEX}:8`, `${OPS}/scope-for-issuer.ts:9`, `${SESS}/reads.ts:64`, `${SESS}/reads.ts:68`, `${SESS}/reads.ts:69`, `${AUTH}:176`, `${A}/README.md:271`],
  concept: concept_access,
  kind: "query",
  who: "internal: the BetterAuth Convex plugin's JWT payload hook (sessions/external/auth.ts:176).",
  input: Schema.Struct({ authUserId: S }),
  output: Schema.Struct({ authUserId: S, safes: Schema.Array(S) }),
  errors: [error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_accounts_read_owned_safe_addresses_in_tx, procedure_organizations_read_participating_safe_addresses_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── BetterAuth routes (/api/auth/*) ─────────────────────────────────────────────────────────

export const rpc_access_auth_send_verification_otp = defineRpc({
  id: "access.auth.send-verification-otp",
  title: "Send a one-time sign-in code (POST /api/auth/email-otp/send-verification-otp)",
  about:
    "BetterAuth's emailOTP route (6 digits, 300 s, 3 attempts, sendVerificationOnSignUp) with Capxul's callbacks. For a " +
    "`sign-in` send the before-hook claims the email's cooldown (claimOtpSend; inside OTP_COOLDOWN_MS, default 60 s, it answers " +
    "429 RATE_LIMITED with details.retryAfterMs and Retry-After) before BetterAuth stores and rotates the code; another type " +
    "claims inside the send callback. `generateOTP` gives a reserved @e2e.capxul.test address the fixed CAPXUL_E2E_OTP when " +
    "e2e auth is enabled, and such a sign-in sends no mail except on a devnet. The callback sends the code through the mail " +
    "owner (sendMail; on a devnet it lands in Operator's mail sink); a failed send releases its own claim, reports the " +
    "failure to PostHog (auth.sendVerificationOTP) and throws the PROVIDER_ERROR, which BetterAuth answers 500. A send that " +
    "went schedules auth_otp_delivered (duration, email, domain, Resend id). The after-hook sets Cache-Control no-store and " +
    "releases a claim the send never used. A code send no claim covered is the defect UNKNOWN.",
  was: [
    `${AUTH}:197`,
    `${AUTH}:121`,
    `${OTP}:114`,
    `${OTP}:153`,
    `${OTP}:81`,
    `${OTP}:93`,
    `${OTP}:137`,
    `${OTP}:177`,
    `${OTP}:179`,
    `${OTP}:191`,
    `${OTP}:194`,
    `${OTP}:201`,
    `${OTP}:208`,
    `${OTP}:159`,
    `${SESS}/events.ts:23`,
    `${SESS}/events.ts:44`,
    `${SESS}/errors.ts:17`,
    `${SESS}/errors.ts:43`,
    "packages/protocol/src/access/policy.ts:9",
    `${BACKEND}/src/integrations/mail/service.ts:147`,
    ...FACTORY_WAS,
    ...MOUNT_WAS,
  ],
  concept: concept_access,
  kind: "action",
  who: "Anyone: no session is needed. The SDK sends `type: sign-in`; the agent login page and the CLI do the same.",
  input: Schema.Struct({ email: S, type: S }),
  /** BetterAuth's body; the SDK reads only the status and, on 429, details.retryAfterMs. */
  output: U,
  errors: [error_RATE_LIMITED, error_PROVIDER_ERROR, ...FACTORY_ERRORS],
  reads: [table_otp_rate_limits, table_better_auth_verification],
  writes: [table_otp_rate_limits, table_better_auth_verification],
  drives: [],
  invokes: [],
  emits: [event_auth_otp_delivered],
  calls: [integration_mail.c.sendMail],
  chain: [],
  spans: [],
});

export const rpc_access_auth_sign_in_email_otp = defineRpc({
  id: "access.auth.sign-in-email-otp",
  title: "Sign in with a one-time code (POST /api/auth/sign-in/email-otp)",
  about:
    "BetterAuth's emailOTP sign-in, unchanged by Capxul: checks the code against the stored verification (3 attempts, then " +
    "TOO_MANY_ATTEMPTS), creates the user on a first sign-in, creates a session and answers `{token, user}` with the session " +
    "cookies; the bearer plugin also hands the session token back in a header. BetterAuth refuses with its own codes " +
    "(OTP_EXPIRED, INVALID_OTP, TOO_MANY_ATTEMPTS): only OTP_EXPIRED is a Capxul code, and the SDK maps the others " +
    "(auth-client/better-auth-node-session.ts:57). The response is Cache-Control no-store. No Capxul code records the sign-in.",
  was: [`${AUTH}:197`, `${AUTH}:184`, `${OTP}:164`, "packages/sdk/src/access/auth-client/better-auth-node-session.ts:57", ...FACTORY_WAS, ...MOUNT_WAS],
  concept: concept_access,
  kind: "action",
  who: "Anyone holding the code sent to the email.",
  input: Schema.Struct({ email: S, otp: S }),
  output: Schema.Struct({ token: S, user: U }),
  errors: [error_OTP_EXPIRED, ...FACTORY_ERRORS],
  reads: [table_better_auth_verification, table_better_auth_user],
  writes: [table_better_auth_verification, table_better_auth_user, table_better_auth_session],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_auth_get_session = defineRpc({
  id: "access.auth.get-session",
  title: "Read the session (GET /api/auth/get-session)",
  about:
    "BetterAuth's session read: `{session, user}` for the cookie or bearer session, or null. Capxul strips the Convex plugin's " +
    "token from it (`withoutSessionReadToken`) and disables the jwt plugin's header, so a signed-in read signs no JWT: no " +
    "`set-auth-jwt` header and no `convex_jwt` cookie (CAP-585). Cache-Control is no-store, so a browser does not queue " +
    "concurrent reads of one URL behind one writer. The Node SDK adds `disableCookieCache=true` when it keeps a bearer session.",
  was: [`${AUTH}:82`, `${AUTH}:96`, `${AUTH}:141`, `${AUTH}:168`, `${SESS}/rules.ts:183`, `${OTP}:164`, ...FACTORY_WAS, ...MOUNT_WAS],
  concept: concept_access,
  kind: "action",
  who: "Anyone; the answer is null without a live session.",
  input: Schema.Struct({ disableCookieCache: opt(Schema.Boolean) }),
  output: Schema.NullOr(Schema.Struct({ session: U, user: U })),
  errors: FACTORY_ERRORS,
  reads: [table_better_auth_session, table_better_auth_user],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_auth_convex_token = defineRpc({
  id: "access.auth.convex-token",
  title: "Mint a Convex JWT for the session (GET /api/auth/convex/token)",
  about:
    "The @convex-dev/better-auth Convex plugin's token route: for a live session it signs an RS256 JWT (aud convex, the session " +
    "id as `sessionId`) with the user's fields but `id` and `image`, plus `authUserId` and the indexer `safes` that " +
    "access.sessions.scopeForIssuer reads for this person at issue time. It reads the signing keys newest first and rotates " +
    "them when signing fails (jwksRotateOnTokenGenerationError). Every client takes its Convex token here; Convex verifies it " +
    "against the served JWKS. No session is BetterAuth's 401, which the SDK reads as NOT_AUTHENTICATED " +
    "(auth-client/better-auth-wire.ts:216). Cache-Control no-store.",
  was: [`${AUTH}:168`, `${AUTH}:171`, `${AUTH}:173`, `${AUTH}:176`, `${A}/external.ts:34`, `${BACKEND}/src/platform/auth-config.ts:11`, "packages/sdk/src/access/auth-client/port.ts:64", ...FACTORY_WAS, ...MOUNT_WAS],
  concept: concept_access,
  kind: "action",
  who: "A signed-in session (cookie or bearer).",
  input: Schema.Struct({}),
  output: Schema.Struct({ token: S }),
  errors: FACTORY_ERRORS,
  reads: [table_better_auth_session, table_better_auth_user, table_better_auth_jwks],
  writes: [table_better_auth_jwks],
  drives: [],
  invokes: [procedure_accounts_read_owned_safe_addresses_in_tx, procedure_organizations_read_participating_safe_addresses_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_auth_convex_jwks = defineRpc({
  id: "access.auth.convex-jwks",
  title: "The signing keys Convex verifies with (GET /api/auth/convex/jwks)",
  about:
    "The Convex plugin's JWKS, which replaces the jwt plugin's (so /api/auth/jwks is a 404). The only cacheable auth response: " +
    "Cache-Control public, max-age=300, so Convex fetches it at most once in 300 s (CAP-597). Every token Capxul signs, " +
    "native and agent tokens included, verifies against these keys.",
  was: [`${SESS}/rules.ts:175`, `${SESS}/rules.ts:183`, `${A}/agents/views/discovery.ts:49`, `${BACKEND}/src/platform/auth-config.ts:1`, ...FACTORY_WAS, ...MOUNT_WAS],
  concept: concept_access,
  kind: "action",
  who: "Anyone, Convex's token verifier first.",
  input: Schema.Struct({}),
  output: Schema.Struct({ keys: Schema.Array(U) }),
  errors: FACTORY_ERRORS,
  reads: [table_better_auth_jwks],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_auth_sign_out = defineRpc({
  id: "access.auth.sign-out",
  title: "Sign out (POST /api/auth/sign-out)",
  about:
    "BetterAuth's sign-out: deletes the session and answers cookies that expire at once. Capxul adds only Cache-Control " +
    "no-store. The Node SDK sends `{}` with the auth origin.",
  was: [`${OTP}:164`, "packages/sdk/src/access/auth-client/better-auth-node.ts:206", ...FACTORY_WAS, ...MOUNT_WAS],
  concept: concept_access,
  kind: "action",
  who: "The holder of a session cookie or bearer.",
  input: Schema.Struct({}),
  output: U,
  errors: FACTORY_ERRORS,
  reads: [table_better_auth_session],
  writes: [table_better_auth_session],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_auth_encryption_session = defineRpc({
  id: "access.auth.encryption-session",
  title: "Open an Openfort Shield encryption session (POST /api/auth/encryption-session)",
  about:
    "The @openfort/better-auth plugin's route for a signed-in session: it asks Openfort Shield for an encryption session " +
    "through Capxul's fetch shim (POST shield.openfort.io/project/encryption-session with SHIELD_PUBLISHABLE_KEY, " +
    "SHIELD_SECRET_KEY and the encryption share; 15 s, 64 KiB), which masks every secret in a failure, reports it to PostHog " +
    "(auth.createEncryptionSession) and rejects with PROVIDER_ERROR or PROVIDER_RESPONSE_INVALID. The plugin answers the " +
    "session id, or its own fixed failure: neither Shield code reaches the caller. No session is BetterAuth's own 401. The " +
    "browser's embedded signer uses it.",
  was: [`${AUTH}:185`, `${AUTH}:73`, `${BACKEND}/src/integrations/openfort/betterAuthClient.ts:36`, `${BACKEND}/src/integrations/openfort/betterAuthClient.ts:61`, `${ROUTES}:52`, ...FACTORY_WAS, ...MOUNT_WAS],
  concept: concept_access,
  kind: "action",
  who: "A signed-in session.",
  input: Schema.Struct({}),
  output: Schema.Struct({ session: S }),
  errors: FACTORY_ERRORS,
  reads: [table_better_auth_session, table_better_auth_user],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_openfort_shield.c.createEncryptionSession],
  chain: [],
  spans: ["auth.createEncryptionSession"],
});

export const rpc_access_auth_request = defineRpc({
  id: "access.auth.request",
  title: "Every other route BetterAuth mounts under /api/auth",
  about:
    "The routes `createAuth` mounts that no Capxul code configures or calls, observed as the one operation access.auth.request: " +
    "/ok, /error, /account-info, /callback/:id, /change-email, /change-password, /delete-user, /delete-user/callback, " +
    "/email-otp/change-email, /email-otp/check-verification-otp, /email-otp/request-email-change, " +
    "/email-otp/request-password-reset, /email-otp/reset-password, /email-otp/verify-email, /forget-password/email-otp, " +
    "/get-access-token, /link-social, /list-accounts, /list-sessions, /refresh-token, /request-password-reset, " +
    "/reset-password, /reset-password/:token, /revoke-other-sessions, /revoke-session, /revoke-sessions, " +
    "/send-verification-email, /sign-in/email, /sign-in/social, /sign-up/email, /unlink-account, /update-session, " +
    "/update-user, /verify-email, /verify-password, /convex/latest-jwks, /convex/rotate-keys and " +
    "/convex/.well-known/openid-configuration. Each is BetterAuth's own behaviour against the component tables; Capxul adds " +
    "Cache-Control no-store and, for an email-verification code send, the OTP cooldown.",
  was: [`${ROUTES}:32`, ...FACTORY_WAS, ...MOUNT_WAS],
  concept: concept_access,
  kind: "action",
  who: "Whoever BetterAuth admits for the route; most need a session.",
  input: U,
  output: U,
  errors: FACTORY_ERRORS,
  reads: [table_better_auth_user, table_better_auth_session, table_better_auth_account, table_better_auth_verification, table_better_auth_jwks],
  writes: [table_better_auth_user, table_better_auth_session, table_better_auth_account, table_better_auth_verification, table_better_auth_jwks],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
