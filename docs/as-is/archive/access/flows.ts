// The as-is Core SDK flows of the old access concept: every public method of `client.auth`,
// `client.auth.clientRequests` and `client.currentUser` (packages/sdk/src/access/) that composes more
// than one call or does local work. Methods that forward one call are listed in the comment at the
// end of this file, with the rpc each forwards.
//
// The auth methods run through the identity actor (packages/sdk/src/access/identity/), the single
// state machine that carries a person from signed out to a claimed Account. A public method asks the
// actor; the actor refuses an event its current state does not admit (WRONG_STATE) and runs the port
// work in a slot, each port call under an `identity.port.<name>` span. The auth client port is a
// BetterAuth adapter over fetch (browser or Node, cookie jar or bearer store) or, for a host holding
// an agent's OAuth token, the OAuth bearer client, whose session read is the agent exchange.
//
// Paths in `was` are relative to the old repository root (/home/user/factory).

import { Schema } from "effect";
import { defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import {
  error_CANCELLED,
  error_INVALID_INPUT,
  error_NETWORK_ERROR,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_RATE_LIMITED,
  error_SUPERSEDED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  rpc_access_auth_get_session,
  rpc_access_auth_send_verification_otp,
  rpc_access_auth_sign_in_email_otp,
  rpc_access_auth_sign_out,
} from "./sessions.ts";
import { rpc_access_clients_native_request_view } from "./clients.ts";
import { rpc_profiles_details_get } from "../profiles/details.ts";
import { rpc_accounts_safes_load_by_auth_user_id, rpc_accounts_safes_provision } from "../accounts/safes.ts";
import { rpc_accounts_claims_claim } from "../accounts/claims.ts";
import { rpc_accounts_summaries_me } from "../accounts/summaries.ts";
import { rpc_accounts_balances_read } from "../accounts/balances.ts";
import { rpc_organizations_workspaces_list } from "../organizations/workspaces.ts";

const SDK = "packages/sdk/src/access";
const ID = `${SDK}/identity`;
const WIRE = `${SDK}/auth-client/better-auth-wire.ts`;
const NODE = `${SDK}/auth-client/better-auth-node.ts`;
const ASSEMBLE = "packages/sdk/src/platform/client/assemble.ts";

const S = Schema.String;
const N = Schema.Number;
const U = Schema.Unknown;
const opt = Schema.optionalKey;

/** `AuthMethodOptions` = `InvocationControls` (auth.ts:39): a signal, time limits and correlation ids, not data. */
const Options = opt(
  Schema.Struct({
    signal: opt(U),
    timeoutMs: opt(N),
    deadlineMs: opt(N),
    correlation_id: opt(S),
    journey_id: opt(S),
  }),
);

/** `AuthSession` (packages/protocol/src/access/model.ts): the provider session the SDK keeps. */
const Session = Schema.Struct({ authUserId: S, email: S, token: S, expiresAt: N });

/** How a BetterAuth fetch fails (better-auth-wire.ts:153, :161): aborted, unreachable, or a status the adapter does not read. */
const FETCH_ERRORS = [error_CANCELLED, error_NETWORK_ERROR, error_PROVIDER_ERROR];

/** The auth cache is the host's storage: a failure is PROVIDER_ERROR, provider auth-cache, mode unknown (session-programs.ts:259). */
const CACHE_WAS = `${SDK}/session-programs.ts:259`;

// ── client.auth ────────────────────────────────────────────────────────────────────────────

const SEND_OTP_STEP = {
  name: "send-otp",
  rpc: rpc_access_auth_send_verification_otp,
  about:
    "The actor's RequestOtp work: POST with `type: sign-in`. 429 is RATE_LIMITED with the backend's retryAfterMs; INVALID_EMAIL or VALIDATION_ERROR is INVALID_INPUT; another status PROVIDER_ERROR.",
} as const;

export const flow_client_auth_sign_in = defineFlow({
  id: "client.auth.sign-in",
  title: "Ask for a one-time sign-in code",
  about:
    "client.auth.signIn: an aborted signal is CANCELLED before anything runs. It brands the email (INVALID_INPUT), resets a " +
    "faulted actor first, then asks the actor for RequestOtp, which only restoring, signed_out, otp_pending and faulted admit " +
    "(otherwise WRONG_STATE). The actor sends the code request and, once it is taken, moves to otp_pending with the time from " +
    "the clock. The answer is a tracking value, not a session: `sessionId` is 16 random hex characters and `expiresAt` is now " +
    "plus otpTtlMs (default 300 000 ms). There is no client-side cooldown.",
  was: [
    `${SDK}/auth.ts:105`,
    `${SDK}/otp-programs.ts:139`,
    `${SDK}/otp-programs.ts:157`,
    `${SDK}/otp-programs.ts:161`,
    `${SDK}/otp-programs.ts:163`,
    `${SDK}/otp-programs.ts:165`,
    `${SDK}/otp-programs.ts:88`,
    `${ID}/spec.ts:86`,
    `${ID}/transition.ts:31`,
    `${ID}/private-transition.ts:24`,
    `${WIRE}:124`,
    `${WIRE}:152`,
  ],
  component: component_core_sdk,
  sdk: "client.auth.signIn",
  input: Schema.Struct({ input: Schema.Struct({ email: S }), options: Options }),
  output: Schema.Struct({ sessionId: S, expiresAt: N }),
  steps: [
    { name: "admit", local: "build", about: "Refuses an aborted signal (CANCELLED) and brands the email (INVALID_INPUT)." },
    { name: "reset", local: "cache", about: "A faulted actor is reset first; any other state decision is the actor's." },
    { name: "request", local: "build", about: "Asks the actor for RequestOtp; a state that does not admit it is WRONG_STATE." },
    SEND_OTP_STEP,
    { name: "tracking", local: "build", about: "Mints the tracking value: 16 random hex characters and now plus the OTP lifetime." },
  ],
  errors: [error_CANCELLED, error_INVALID_INPUT, error_WRONG_STATE, error_RATE_LIMITED, error_NETWORK_ERROR, error_PROVIDER_ERROR],
  calls: [],
  spans: ["identity.port.auth-client.send-otp", "identity.port.clock.now"],
});

const VERIFY_STEPS = [
  {
    name: "verify",
    rpc: rpc_access_auth_sign_in_email_otp,
    about:
      "The actor's VerifyOtp work. OTP_EXPIRED stays; INVALID_OTP is INVALID_INPUT; TOO_MANY_ATTEMPTS is RATE_LIMITED; another refusal is a provider status failure.",
  },
  {
    name: "session-read",
    rpc: rpc_access_auth_get_session,
    about: "The Node adapter with a bearer session store only: it reads the session again (disableCookieCache) and saves it.",
  },
  {
    name: "profile",
    rpc: rpc_profiles_details_get,
    about: "sessionProfile: the person's Profile by authUserId; `onboarded` makes the session profileComplete.",
  },
  { name: "cache", local: "cache", about: "Writes the verified session to the auth cache; a cache failure is PROVIDER_ERROR (auth-cache)." },
  {
    name: "after-verify",
    local: "build",
    about: "Resets the signer for the fresh session; unless account setup is explicit, kicks provisioning, detached: the method does not wait for it.",
  },
  {
    name: "provision-load",
    rpc: rpc_accounts_safes_load_by_auth_user_id,
    about: "Detached account lane (EnsureAccount), only for a complete Profile with the Account unknown: the person's Safe row, if any.",
  },
  { name: "provision", rpc: rpc_accounts_safes_provision, about: "Detached: provisions the Safe from the verified email when none exists." },
  {
    name: "claim",
    rpc: rpc_accounts_claims_claim,
    about: "Detached: only when the client requires a deployed Account and holds a signer, the signer's address claims the Safe.",
  },
] as const;

export const flow_client_auth_verify_otp = defineFlow({
  id: "client.auth.verify-otp",
  title: "Sign in with the code: verify, load the profile, keep the session",
  about:
    "client.auth.verifyOtp: an aborted signal is CANCELLED. A code that is not six digits is INVALID_INPUT (otp). The email is " +
    "branded only when the actor is otp_pending or faulted with a resumable entry; a faulted actor resumes its OTP entry first. " +
    "The actor then admits VerifyOtp only from otp_pending (WRONG_STATE otherwise); its work verifies the code, records the " +
    "provider session, loads the Profile and settles authenticated (profileComplete from `onboarded`). No session held after " +
    "it is NOT_AUTHENTICATED. The verified session is cached; then the client's afterVerifyOtp resets the signer and, unless " +
    "account setup is `explicit`, starts provisioning without waiting for it; a throw there replaces the result with its " +
    "error (UNKNOWN for a non-Capxul one). The `signer` input is accepted and not used.",
  was: [
    `${SDK}/auth.ts:118`,
    `${SDK}/auth.ts:133`,
    `${SDK}/otp-programs.ts:28`,
    `${SDK}/otp-programs.ts:36`,
    `${SDK}/otp-programs.ts:46`,
    `${SDK}/otp-programs.ts:58`,
    `${SDK}/otp-programs.ts:66`,
    `${SDK}/otp-programs.ts:72`,
    `${SDK}/otp-programs.ts:76`,
    `${ID}/spec.ts:102`,
    `${ID}/account-lane.ts:82`,
    `${ID}/account-lane.ts:101`,
    `${SDK}/auth-client/better-auth-node-session.ts:57`,
    `${NODE}:120`,
    `${ASSEMBLE}:97`,
    "packages/sdk/src/accounts/account.ts:167",
    "packages/sdk/src/accounts/account-lane.ts:124",
  ],
  component: component_core_sdk,
  sdk: "client.auth.verifyOtp",
  input: Schema.Struct({ input: Schema.Struct({ email: S, code: S, signer: opt(U) }), options: Options }),
  output: Session,
  steps: [
    { name: "admit", local: "build", about: "Refuses an aborted signal (CANCELLED), a code that is not six digits, and an email that does not brand (INVALID_INPUT)." },
    { name: "resume", local: "cache", about: "A faulted actor with a resumable entry resumes it (ResumeOtpEntry) before the retry." },
    ...VERIFY_STEPS,
  ],
  errors: [
    error_CANCELLED,
    error_INVALID_INPUT,
    error_WRONG_STATE,
    error_RATE_LIMITED,
    error_NOT_AUTHENTICATED,
    error_NETWORK_ERROR,
    error_PROVIDER_ERROR,
    error_PROVIDER_RESPONSE_INVALID,
  ],
  calls: [],
  spans: ["identity.port.auth-client.verify-otp", "identity.port.identity.load-by-auth-user-id", "identity.port.clock.now"],
});

export const flow_client_auth_get_session = defineFlow({
  id: "client.auth.get-session",
  title: "The current session: from the cache, or read from BetterAuth",
  about:
    "client.auth.getSession: an aborted signal is CANCELLED. Cache first: an unreadable cache is PROVIDER_ERROR (auth-cache), " +
    "except while restoring, when it falls through. A faulted actor answers its failure. Mid-OTP with nothing cached answers " +
    "null. A cached session is answered as it is when the actor already holds one; while signed out or restoring it is " +
    "trusted into the actor without a network call. Otherwise the actor's ReadSession reads the session and the Profile; a " +
    "read a later one superseded settles with the winner's outcome (30 s when the caller set no limit). A read that finds the " +
    "session gone while authenticated signs out and fails NOT_AUTHENTICATED. Answers the held session, or null. With the " +
    "OAuth bearer client the read is the agent exchange, cached until 30 s before expiry.",
  was: [
    `${SDK}/auth.ts:165`,
    `${SDK}/session-programs.ts:174`,
    `${SDK}/session-programs.ts:183`,
    `${SDK}/session-programs.ts:194`,
    `${SDK}/session-programs.ts:206`,
    `${SDK}/session-programs.ts:216`,
    `${SDK}/session-programs.ts:98`,
    `${SDK}/session-programs.ts:89`,
    `${ID}/spec.ts:135`,
    `${ID}/account-lane.ts:82`,
    `${ID}/private-transition.ts:41`,
    `${SDK}/auth-client/oauth-bearer.ts:1`,
    CACHE_WAS,
  ],
  component: component_core_sdk,
  sdk: "client.auth.getSession",
  input: Schema.Struct({ options: Options }),
  output: Schema.NullOr(Session),
  steps: [
    { name: "admit", local: "build", about: "Refuses an aborted signal (CANCELLED)." },
    { name: "cache", local: "cache", about: "Reads the cached session; a hit the actor can hold is answered, or trusted into a signed-out or restoring actor." },
    {
      name: "read",
      rpc: rpc_access_auth_get_session,
      about: "The actor's ReadSession work: the provider session, or null; a non-OK status is a provider status failure.",
    },
    { name: "profile", rpc: rpc_profiles_details_get, about: "sessionProfile for a session that exists: profileComplete from the Profile's `onboarded`." },
    { name: "sign-out", rpc: rpc_access_auth_sign_out, about: "Only when an authenticated actor's read answers NOT_AUTHENTICATED: SignOut, then the method fails." },
  ],
  errors: [error_CANCELLED, error_NOT_AUTHENTICATED, error_SUPERSEDED, ...FETCH_ERRORS],
  calls: [],
  spans: ["identity.port.auth-client.get-session", "identity.port.identity.load-by-auth-user-id", "identity.port.auth-client.sign-out"],
});

export const flow_client_auth_sign_out = defineFlow({
  id: "client.auth.sign-out",
  title: "Sign out: end the backend session and clear the local cache",
  about:
    "client.auth.signOut: an aborted signal is CANCELLED. A restoring actor is first settled through getSession; a signed-out " +
    "actor with a cached session takes it in. A faulted actor may still hold a live backend session (CAP-190): it posts " +
    "sign-out directly, once more on failure unless cancelled, and counts a session read that finds no session as revoked; " +
    "then it resets the actor, clears the cache, and fails with backendSessionMayBeActive when the revoke is unconfirmed. " +
    "Otherwise the actor's SignOut (from authenticated, otp_* or faulted; signed_out is WRONG_STATE) posts sign-out, and the " +
    "cache is cleared whatever the wire answered: session, then JWT. A cache failure wins over the wire's error.",
  was: [
    `${SDK}/auth.ts:151`,
    `${SDK}/session-programs.ts:294`,
    `${SDK}/session-programs.ts:304`,
    `${SDK}/session-programs.ts:312`,
    `${SDK}/session-programs.ts:327`,
    `${SDK}/session-programs.ts:337`,
    `${SDK}/session-programs.ts:350`,
    `${SDK}/session-programs.ts:269`,
    `${SDK}/sign-out-revoke.ts:21`,
    `${SDK}/sign-out-revoke.ts:48`,
    `${ID}/spec.ts:167`,
    `${NODE}:197`,
    CACHE_WAS,
  ],
  component: component_core_sdk,
  sdk: "client.auth.signOut",
  input: Schema.Struct({ options: Options }),
  output: Schema.Void,
  steps: [
    { name: "admit", local: "build", about: "Refuses an aborted signal (CANCELLED)." },
    { name: "settle", rpc: rpc_access_auth_get_session, about: "A restoring actor only: settles the restore window through getSession first." },
    { name: "restore", local: "cache", about: "A signed-out actor with a cached session takes it in, so the sign-out can reach the backend." },
    {
      name: "sign-out",
      rpc: rpc_access_auth_sign_out,
      about: "The actor's SignOut work, or from faulted a direct revoke tried twice; a non-OK status is a provider status failure.",
    },
    { name: "confirm", rpc: rpc_access_auth_get_session, about: "From faulted, after a failed revoke: a read that finds no session counts as revoked." },
    { name: "clear-cache", local: "cache", about: "Clears the cached session, then the cached Convex JWT, whatever the wire answered." },
  ],
  errors: [error_CANCELLED, error_WRONG_STATE, ...FETCH_ERRORS],
  calls: [],
  spans: ["identity.port.auth-client.sign-out", "identity.port.auth-client.get-session"],
});

export const flow_client_auth_can_send_otp = defineFlow({
  id: "client.auth.can-send-otp",
  title: "Whether a code may be sent now: always yes",
  about:
    "client.auth.canSendOtp: an aborted signal is CANCELLED; the email is branded (INVALID_INPUT). The BetterAuth adapters " +
    "make no request and answer `{allowed: true, cooldownMs: 0}`: the cooldown is enforced only by the backend's send route. " +
    "An auth client failure that is not a Capxul error is PROVIDER_ERROR (auth-client, mode unknown).",
  was: [`${SDK}/auth.ts:92`, `${SDK}/otp-programs.ts:105`, `${WIRE}:112`],
  component: component_core_sdk,
  sdk: "client.auth.canSendOtp",
  input: Schema.Struct({ input: Schema.Struct({ email: S }), options: Options }),
  output: Schema.Struct({ allowed: Schema.Boolean, cooldownMs: N }),
  steps: [
    { name: "admit", local: "build", about: "Refuses an aborted signal (CANCELLED) and brands the email (INVALID_INPUT)." },
    { name: "allow", local: "build", about: "The auth client answers allowed with no cooldown, without a network call." },
  ],
  errors: [error_CANCELLED, error_INVALID_INPUT, error_PROVIDER_ERROR],
  calls: [],
  spans: [],
});

export const flow_client_auth_resume_otp = defineFlow({
  id: "client.auth.resume-otp",
  title: "Resume a pending code entry after a restart",
  about:
    "client.auth.resumeOtp: an aborted signal is CANCELLED; the email is branded (INVALID_INPUT). Asks the actor for " +
    "RestoreOtpEntry with the email and when the code was asked for, which only a signed-out actor admits (WRONG_STATE " +
    "otherwise). No network call; it grants no authentication: only a verify can.",
  was: [`${SDK}/auth.ts:83`, `${SDK}/otp-programs.ts:173`, `${ID}/transition.ts:42`, `${ID}/spec.ts:23`],
  component: component_core_sdk,
  sdk: "client.auth.resumeOtp",
  input: Schema.Struct({ input: Schema.Struct({ email: S, requestedAt: N }), options: Options }),
  output: Schema.Void,
  steps: [
    { name: "admit", local: "build", about: "Refuses an aborted signal (CANCELLED) and brands the email (INVALID_INPUT)." },
    { name: "restore", local: "cache", about: "RestoreOtpEntry: the actor moves to otp_pending with the given email and time." },
  ],
  errors: [error_CANCELLED, error_INVALID_INPUT, error_WRONG_STATE],
  calls: [],
  spans: [],
});

// ── client.auth.clientRequests (the browser side of the native device flow) ─────────────────

const VIEW_STEP = {
  name: "view",
  rpc: rpc_access_clients_native_request_view,
  about:
    "GET /api/auth/native/request with credentials. A refused view is a value; 401 is NOT_AUTHENTICATED, 404 or a final invalid_request INVALID_INPUT (requestId), 429 RATE_LIMITED, 5xx PROVIDER_ERROR (upstream-down).",
} as const;
const PHASE_STEP = {
  name: "phase",
  local: "build",
  about: "Only an otp_required or review view may continue; any other phase is WRONG_STATE.",
} as const;
const CLIENT_REQUEST_ERRORS = [
  error_CANCELLED,
  error_NOT_AUTHENTICATED,
  error_INVALID_INPUT,
  error_RATE_LIMITED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_NETWORK_ERROR,
  error_WRONG_STATE,
];

export const flow_client_auth_client_requests_send_otp = defineFlow({
  id: "client.auth.client-requests.send-otp",
  title: "Send the sign-in code for a CLI's device request",
  about:
    "client.auth.clientRequests.sendOtp: reads the request's browser view and, when its phase is otp_required or review, runs " +
    "client.auth.signIn with the view's email (the whole sign-in flow). A view that does not decode is PROVIDER_RESPONSE_INVALID; " +
    "a failed fetch is NETWORK_ERROR. Answers nothing.",
  was: [`${SDK}/client-requests.ts:189`, `${SDK}/client-requests.ts:118`, `${SDK}/client-requests.ts:72`, `${SDK}/client-requests.ts:53`, `${ASSEMBLE}:106`],
  component: component_core_sdk,
  sdk: "client.auth.clientRequests.sendOtp",
  input: Schema.Struct({ input: Schema.Struct({ requestId: S }), options: Options }),
  output: Schema.Void,
  steps: [
    VIEW_STEP,
    PHASE_STEP,
    { name: "request", local: "build", about: "client.auth.signIn's admission and RequestOtp, with the view's email." },
    SEND_OTP_STEP,
  ],
  errors: CLIENT_REQUEST_ERRORS,
  calls: [],
  spans: ["identity.port.auth-client.send-otp", "identity.port.clock.now"],
});

export const flow_client_auth_client_requests_verify_otp = defineFlow({
  id: "client.auth.client-requests.verify-otp",
  title: "Verify the sign-in code for a CLI's device request",
  about:
    "client.auth.clientRequests.verifyOtp: reads the request's browser view and, when its phase is otp_required or review, runs " +
    "client.auth.verifyOtp with the view's email and the code (the whole verify flow, its detached provisioning included). " +
    "Answers nothing; the browser reads the view again to review the request.",
  was: [`${SDK}/client-requests.ts:206`, `${SDK}/client-requests.ts:118`, `${SDK}/client-requests.ts:72`, `${ASSEMBLE}:106`],
  component: component_core_sdk,
  sdk: "client.auth.clientRequests.verifyOtp",
  input: Schema.Struct({ input: Schema.Struct({ requestId: S, code: S }), options: Options }),
  output: Schema.Void,
  steps: [VIEW_STEP, PHASE_STEP, { name: "admit", local: "build", about: "client.auth.verifyOtp's admission, with the view's email." }, ...VERIFY_STEPS],
  errors: CLIENT_REQUEST_ERRORS,
  calls: [],
  spans: ["identity.port.auth-client.verify-otp", "identity.port.identity.load-by-auth-user-id"],
});

// ── client.currentUser ──────────────────────────────────────────────────────────────────────

export const flow_client_current_user_get = defineFlow({
  id: "client.current-user.get",
  title: "The signed-in person, their Account and their Organizations",
  about:
    "client.currentUser.get: an aborted signal is CANCELLED (operation currentUser.get). It reads the person's summary first, " +
    "then in parallel their Account balance, their Safe row and their Organizations. A failed summary, Safe read or " +
    "Organization list fails the method; a failed Account read fails it too, except SMART_ACCOUNT_MISSING, which answers " +
    "`personalAccount: null` (the post-OTP, pre-provision window, #1030). `handle` and `paymentLink` are always null. Each " +
    "call carries the cached Convex JWT, which the transport takes from /api/auth/convex/token.",
  was: [`${SDK}/current-user.ts:31`, `${SDK}/current-user.ts:39`, `${SDK}/current-user.ts:42`, `${SDK}/current-user.ts:56`, `${ASSEMBLE}:198`],
  component: component_core_sdk,
  sdk: "client.currentUser.get",
  input: Schema.Struct({ options: opt(Schema.Struct({ signal: opt(U) })) }),
  output: Schema.Struct({
    user: Schema.Struct({
      id: S,
      email: S,
      displayName: Schema.NullOr(S),
      handle: Schema.Null,
      paymentLink: Schema.Null,
    }),
    personalAccount: Schema.NullOr(Schema.Struct({ id: S, address: Schema.NullOr(S) })),
    /** `OrganizationAccess` each (packages/sdk/src/organizations), too deep to transcribe. */
    organizations: Schema.Array(U),
  }),
  steps: [
    { name: "admit", local: "build", about: "Refuses an aborted signal (CANCELLED)." },
    { name: "me", rpc: rpc_accounts_summaries_me, about: "client.me.get: the person's id, email and display name; a failure ends the method." },
    { name: "account", rpc: rpc_accounts_balances_read, about: "client.accounts.read, in parallel: SMART_ACCOUNT_MISSING answers no Account; any other failure ends the method." },
    { name: "safe", rpc: rpc_accounts_safes_load_by_auth_user_id, about: "client.smartAccount.loadCurrent, in parallel: the Safe's address for the Account." },
    { name: "organizations", rpc: rpc_organizations_workspaces_list, about: "client.orgs(), in parallel: the first page of the person's Organizations." },
  ],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
});

// ── Methods that forward one call: no flow; the operation names the rpc ─────────────────────
//
// client.auth.clientRequests.read     → access.clients.native-request-view; a refused view on a refusal status is a value
//                                       (client-requests.ts:188).
// client.auth.clientRequests.accept   → access.clients.native-request-accept (client-requests.ts:223).
// client.auth.clientRequests.cancel   → access.clients.native-request-deny: the SDK's cancel is the browser's deny
//                                       (client-requests.ts:225).
// client.features.list                → access.features.list (features.ts:61).
// client._internal.gates.set          → access.features.set (features.ts:76; mounted by platform/client/internal-surface.ts:36).
// client._internal.gates.setMine      → access.features.set-mine (features.ts:89).
// client.waitlist.status              → access.waitlist.status (waitlist.ts:38).
// client.waitlist.join                → access.waitlist.join (waitlist.ts:47).
// client.referral.show                → access.referrals.show (referrals.ts:39).
// client.referral.invite              → access.referrals.invite (referrals.ts:48).
// client.referral.list                → access.referrals.list (referrals.ts:61).
//
// Not booked here, because no client method mounts them: the auth client ports themselves (the BetterAuth browser and
// Node adapters, and `oauthBearerAuthClient`, whose getConvexJwt and getSession post the agent's access token and the
// exchange secret to access.agents.exchange with a 15 s limit), `reuseConvexJwt` (the transport's Convex token cache over
// access.auth.convex-token), and the identity actor's account and organization lanes, which client.account and
// client.onboarding drive.
