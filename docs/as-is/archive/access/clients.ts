// The as-is book of the old access concept: the clients area, native client authorization
// (AUTH A2, #2072): the CLI's device flow and the browser's continuation.
//
// Two layers, as the old code has them:
// - The store: thirteen internal functions registered at `access/clients:*`
//   (packages/backend/convex/access/clients.ts). Eleven are run by the HTTP endpoints in the same
//   request and one by the sweep, so they are rpcs; `sweepExpired` is the daily cron, a workflow.
// - The HTTP endpoints: eight BetterAuth plugin endpoints under /api/auth/native
//   (sessions/external/plugins.ts:23, :47), mounted by `createAuth` and observed as
//   access.auth.request. Each reads the configured client and reaches the store only through the
//   internal functions above, so its touches fold in theirs. None is a protocol row.
//
// A store refusal is a value (`{ok: false, reason}`) from the closed list
// CLIENT_AUTHORIZATION_REFUSALS (packages/protocol/src/access/status.ts:21); the endpoints map each
// to an OAuth error (`REFUSAL_ERROR`, clients/views/responses.ts:20) or, for the browser, to a
// refused view carrying a Capxul code (`REFUSAL_CODE`, clients/views/requests.ts:19). None of them
// is a Capxul error the caller receives, so `errors` lists only what the code throws: a defect
// (UNKNOWN) and, for an endpoint, the auth factory's configuration (ENV_MISSING).

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_access } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_UNKNOWN,
  event_native_authorization_accepted,
  event_native_authorization_connected,
  event_native_authorization_denied,
  event_native_authorization_failed,
  event_native_authorization_reviewed,
  event_native_authorization_started,
} from "../shared/vocabulary.ts";
import {
  machine_native_client_request,
  table_better_auth_jwks,
  table_better_auth_session,
  table_better_auth_user,
  table_native_client_contexts,
  table_native_client_grants,
  table_native_client_requests,
  table_user_app_consents,
} from "./data.ts";
import { procedure_accounts_read_native_ready_account_in_tx } from "../accounts/procedures.ts";
import {
  procedure_applications_hash_credential_value,
  procedure_applications_resolve_native_client_metadata,
} from "../applications/procedures.ts";
import {
  procedure_profiles_read_profile_readiness_in_tx,
  procedure_profiles_read_profile_summary_in_tx,
} from "../profiles/procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/access/clients.ts`;
const C = `${BACKEND}/src/access/clients`;
const OPS = `${C}/operations`;
const PLUGINS = `${BACKEND}/src/access/sessions/external/plugins.ts`;
const AUTH = `${BACKEND}/src/access/sessions/external/auth.ts`;
const PROTOCOL = "packages/protocol/src/access";

const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const U = Schema.Unknown;
const opt = Schema.optionalKey;

const DEFECT = [error_UNKNOWN];
/** An endpoint runs inside createAuth: its configuration (ENV_MISSING) and a defect. */
const ENDPOINT_ERRORS = [error_ENV_MISSING, error_UNKNOWN];
const ENDPOINT_WAS = [`${AUTH}:166`, `${AUTH}:167`, `${BACKEND}/convex/http.ts:74`, `${BACKEND}/src/platform/observation/routes.ts:32`];

/** A store refusal, or the poll and rate-limit answers: `{ok: false, reason}` (clients/errors.ts:9). */
const Refusal = Schema.Struct({ ok: Schema.Literal(false), reason: S, retryAfterMs: opt(N) });

/** `GrantFacts` (clients/rules.ts:58): the grant a client holds, as delivery and rotation return it. */
const GrantFacts = {
  grantId: S,
  revision: N,
  authUserId: S,
  email: S,
  accountId: S,
  clientId: S,
  applicationId: S,
  resource: S,
  grantCreatedAt: N,
  renewalExpiresAt: N,
  absoluteExpiresAt: N,
};

/** `decisionSession` (clients/rules.ts:37): the signed-in browser session a decision is made under. */
const DecisionSession = Schema.Struct({ authUserId: S, email: S, sessionId: S, createdAt: N });

/** `BrowserRequest` (clients/views/requests.ts:43): a request as the browser view is projected from it. */
const BrowserRequest = Schema.Struct({
  requestId: S,
  revision: N,
  expiresAt: N,
  createdAt: N,
  reviewedAt: Schema.NullOr(N),
  state: S,
  refusal: Schema.NullOr(S),
  email: S,
  mode: Schema.Literals(["login", "signup"]),
  profileJson: Schema.NullOr(S),
  authUserId: Schema.NullOr(S),
  accountId: Schema.NullOr(S),
  grantId: Schema.NullOr(S),
  expired: B,
  profile: Schema.NullOr(Schema.Struct({ displayName: S, handle: S, country: S })),
});

/** `ClientRequestViewSchema` (protocol access/authorization-schema.ts:86): five closed phases, too deep to transcribe. */
const ClientRequestView = U;

// ── shared touches ─────────────────────────────────────────────────────────────────────────

/** The configured client: `readConfiguredNativeMetadata` then access.clients.read-metadata. */
const METADATA = {
  invokes: [procedure_applications_resolve_native_client_metadata],
  was: [`${C}/reads/endpoints.ts:33`, `${C}/reads/endpoints.ts:42`, `${OPS}/read-metadata.ts:14`, `${C}/reads/store.ts:144`],
};
/** A device-code lookup hashes the presented secret (clients/rules.ts:231 → applications' hashCredentialValue). */
const HASH = [procedure_applications_hash_credential_value];
/** BetterAuth's resolved browser session (`getSessionFromCtx`), read by the browser endpoints. */
const BROWSER_SESSION_READS = [table_better_auth_session, table_better_auth_user];
/** Signing or verifying a native JWT reads the deployment's keys (access/external.ts:34). */
const TOKEN_READS = [table_better_auth_jwks];
const TOKEN_WAS = [`${C}/external.ts:51`, `${C}/external.ts:81`, `${C}/external.ts:91`, `${BACKEND}/src/access/external.ts:34`, `${PROTOCOL}/native-client-schema.ts:243`];

/** The admission both browser decisions pass (clients/guards.ts:15). */
const ADMIT_WAS = [`${C}/guards.ts:15`, `${C}/rules.ts:122`, `${C}/rules.ts:130`, `${C}/rules.ts:140`, `${C}/rules.ts:144`, `${C}/writes/requests.ts:117`];

// ── the store: access/clients:* ────────────────────────────────────────────────────────────

export const rpc_access_clients_start_request = defineRpc({
  id: "access.clients.start-request",
  title: "Open a device request for one client and email",
  about:
    "Internal mutation `access/clients:startRequest`. Lowercases the email; five starts for it inside ten minutes answer " +
    "`rate_limited` with how long until the oldest ages out. Otherwise finds or creates the one context of the " +
    "application/client/resource (epoch 0, 90-day expiry) and inserts a `pending` request at revision 0 with fresh secrets: " +
    "a 43-character device code and continuity token and an XXXX-XXXX user code, of which only SHA-256 hashes are stored and " +
    "the plaintext is answered once; the request lives the asked wait, clamped to ten minutes, and polls every 5 s. A context " +
    "it just inserted that does not read back is the defect UNKNOWN.",
  was: [
    `${CONVEX}:14`,
    `${OPS}/start-request.ts:12`,
    `${OPS}/start-request.ts:29`,
    `${C}/rules.ts:161`,
    `${C}/rules.ts:175`,
    `${C}/reads/store.ts:62`,
    `${C}/writes/requests.ts:42`,
    `${C}/writes/requests.ts:61`,
    `${C}/writes/secrets.ts:27`,
    `${C}/writes/secrets.ts:60`,
    `${C}/writes/secrets.ts:65`,
    `${C}/rules.ts:236`,
    `${C}/errors.ts:47`,
  ],
  concept: concept_access,
  kind: "mutation",
  who: "internal: POST /api/auth/native/device/code.",
  input: Schema.Struct({
    applicationId: S,
    clientId: S,
    resource: S,
    email: S,
    mode: Schema.Literals(["login", "signup"]),
    now: N,
    waitMs: opt(N),
    profileJson: opt(S),
  }),
  output: Schema.Union([
    Schema.Struct({
      ok: Schema.Literal(true),
      requestId: S,
      deviceCode: S,
      userCode: S,
      continuityToken: S,
      expiresAt: N,
      pollSeconds: N,
      revision: N,
    }),
    Refusal,
  ]),
  errors: DEFECT,
  reads: [table_native_client_requests, table_native_client_contexts],
  writes: [table_native_client_requests, table_native_client_contexts],
  drives: [],
  invokes: HASH,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_clients_mark_reviewed = defineRpc({
  id: "access.clients.mark-reviewed",
  title: "Mark the first time the person saw a request",
  about:
    "Internal mutation `access/clients:markReviewed`. An unknown request is `invalid_request`; a terminal one its terminal " +
    "refusal. A pending request not reviewed yet gets `reviewedAt` and answers `first: true`, so the browser view emits " +
    "native_authorization_reviewed once however often it re-reads; anything else answers `first: false`.",
  was: [`${CONVEX}:8`, `${OPS}/mark-reviewed.ts:13`, `${OPS}/mark-reviewed.ts:24`, `${C}/writes/requests.ts:102`, `${C}/reads/store.ts:25`],
  concept: concept_access,
  kind: "mutation",
  who: "internal: GET /api/auth/native/request, when the view it projects is the review.",
  input: Schema.Struct({ requestId: S, now: N }),
  output: Schema.Union([Schema.Struct({ ok: Schema.Literal(true), first: B }), Refusal]),
  errors: DEFECT,
  reads: [table_native_client_requests],
  writes: [table_native_client_requests],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_clients_accept_request = defineRpc({
  id: "access.clients.accept-request",
  title: "The person says yes to a request",
  about:
    "Internal mutation `access/clients:acceptRequest`. admitDecision first: unknown or delivered is `invalid_request`, terminal " +
    "its refusal, late is recorded `expired`, a stale revision `invalid_request`, another email `identity_mismatch`, a session " +
    "created more than 30 s before the request `fresh_session_required`. Then readiness through the owners (profiles' " +
    "readProfileReadinessInTx; for a complete Profile, accounts' readNativeReadyAccountInTx on the asked chain). A signup " +
    "arriving ready for a person who did not adopt it is ended `denied` (`already_signed_up`). A signup that still owes " +
    "setup stays pending, adopted by this session, and records consent (state `setup`, setupState new or resumable). A login " +
    "not ready is refused `signup_required` or `setup_required` and the row stays open. A ready person is `approved` with " +
    "their Account, and the application consent merges `account:read` (re-granting a revoked consent). The first accept " +
    "stamps `acceptedAt` and answers `firstAcceptance`.",
  was: [
    `${CONVEX}:4`,
    `${OPS}/accept-request.ts:20`,
    `${OPS}/accept-request.ts:37`,
    `${OPS}/accept-request.ts:45`,
    `${OPS}/accept-request.ts:52`,
    `${OPS}/accept-request.ts:65`,
    `${OPS}/accept-request.ts:67`,
    `${C}/reads/store.ts:134`,
    `${C}/rules.ts:98`,
    `${C}/rules.ts:156`,
    `${C}/writes/requests.ts:106`,
    `${C}/writes/requests.ts:124`,
    `${C}/writes/requests.ts:137`,
    `${C}/writes/consent.ts:16`,
    ...ADMIT_WAS,
  ],
  concept: concept_access,
  kind: "mutation",
  who: "internal: POST /api/auth/native/request/accept, with the browser's BetterAuth session.",
  input: Schema.Struct({ requestId: S, revision: N, now: N, chainId: N, session: DecisionSession }),
  output: Schema.Union([
    Schema.Struct({
      ok: Schema.Literal(true),
      state: Schema.Literal("setup"),
      revision: N,
      authUserId: S,
      setupState: Schema.Literals(["new", "resumable"]),
      firstAcceptance: B,
    }),
    Schema.Struct({ ok: Schema.Literal(true), state: Schema.Literal("approved"), revision: N, authUserId: S, accountId: S, firstAcceptance: B }),
    Refusal,
  ]),
  errors: DEFECT,
  reads: [table_native_client_requests, table_user_app_consents],
  writes: [table_native_client_requests, table_user_app_consents],
  drives: [machine_native_client_request.t.to_approved, machine_native_client_request.t.to_denied, machine_native_client_request.t.to_expired],
  invokes: [procedure_profiles_read_profile_readiness_in_tx, procedure_accounts_read_native_ready_account_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_clients_deny_request = defineRpc({
  id: "access.clients.deny-request",
  title: "The person says no to a request",
  about:
    "Internal mutation `access/clients:denyRequest`: the same admission as an accept (exact email, fresh session, current " +
    "revision; a late request is recorded expired), then ends the request `denied` with refusal `request_denied` and the next " +
    "revision. An approved request can still be denied.",
  was: [`${CONVEX}:7`, `${OPS}/deny-request.ts:12`, `${OPS}/deny-request.ts:27`, `${C}/writes/requests.ts:106`, ...ADMIT_WAS],
  concept: concept_access,
  kind: "mutation",
  who: "internal: POST /api/auth/native/request/deny, with the browser's BetterAuth session.",
  input: Schema.Struct({ requestId: S, revision: N, now: N, session: DecisionSession }),
  output: Schema.Union([Schema.Struct({ ok: Schema.Literal(true), revision: N }), Refusal]),
  errors: DEFECT,
  reads: [table_native_client_requests],
  writes: [table_native_client_requests],
  drives: [machine_native_client_request.t.to_denied, machine_native_client_request.t.to_expired],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_clients_cancel_request = defineRpc({
  id: "access.clients.cancel-request",
  title: "The CLI withdraws a request not delivered yet",
  about:
    "Internal mutation `access/clients:cancelRequest`, by device code. Unknown is `invalid_request`; terminal its refusal; a " +
    "completed request `invalid_request` (cancelling it would end R1 re-derivation; the remedy is revoking the grant). " +
    "Otherwise ends it `cancelled`. It takes `now` and does not use it: a late request is cancelled, not expired.",
  was: [`${CONVEX}:5`, `${OPS}/cancel-request.ts:19`, `${OPS}/cancel-request.ts:24`, `${OPS}/cancel-request.ts:31`, `${C}/reads/store.ts:33`, `${C}/rules.ts:122`, `${C}/rules.ts:130`],
  concept: concept_access,
  kind: "mutation",
  who: "internal: POST /api/auth/native/revoke with token_type_hint device_code.",
  input: Schema.Struct({ deviceCode: S, now: N }),
  output: Schema.Union([Schema.Struct({ ok: Schema.Literal(true) }), Refusal]),
  errors: DEFECT,
  reads: [table_native_client_requests],
  writes: [table_native_client_requests],
  drives: [machine_native_client_request.t.to_cancelled],
  invokes: HASH,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_clients_consume_request = defineRpc({
  id: "access.clients.consume-request",
  title: "The CLI's poll: pending, too fast, or the grant",
  about:
    "Internal mutation `access/clients:consumeRequest`, by device code. Unknown is `invalid_request`; terminal its refusal; late " +
    "(not completed) is recorded `expired`. A completed request re-derives its grant (R1) while the grant lives: a revoked, " +
    "retired or lapsed grant refuses `grant_revoked` or `grant_expired`. A pending request answers `slow_down` inside the 5 s " +
    "interval, else stamps `lastPollAt` and answers `authorization_pending`. An approved request outside the interval issues " +
    "the grant once: revision 1, renewal 30 days, absolute 90 days; the request becomes `completed` with `grantId`, " +
    "`connectedAt` and `expiresAt` moved to the absolute expiry; the context's `currentGrantId` and `authUserId` become this " +
    "grant's (`firstDelivery: true`). A completed request whose grant was swept answers `invalid_request`.",
  was: [
    `${CONVEX}:6`,
    `${OPS}/consume-request.ts:18`,
    `${OPS}/consume-request.ts:29`,
    `${OPS}/consume-request.ts:34`,
    `${OPS}/consume-request.ts:48`,
    `${OPS}/consume-request.ts:55`,
    `${OPS}/consume-request.ts:61`,
    `${C}/rules.ts:168`,
    `${C}/rules.ts:184`,
    `${C}/writes/requests.ts:157`,
    `${C}/writes/grants.ts:24`,
    `${C}/writes/secrets.ts:31`,
    `${PROTOCOL}/native-client-schema.ts:25`,
  ],
  concept: concept_access,
  kind: "mutation",
  who: "internal: POST /api/auth/native/token with the device_code grant.",
  input: Schema.Struct({ deviceCode: S, now: N }),
  output: Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), firstDelivery: B, mode: Schema.Literals(["login", "signup"]), ...GrantFacts }),
    Refusal,
  ]),
  errors: DEFECT,
  reads: [table_native_client_requests, table_native_client_grants, table_native_client_contexts],
  writes: [table_native_client_requests, table_native_client_grants, table_native_client_contexts],
  drives: [machine_native_client_request.t.to_expired, machine_native_client_request.t.to_completed],
  invokes: HASH,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_clients_rotate_grant = defineRpc({
  id: "access.clients.rotate-grant",
  title: "Advance a grant's refresh revision",
  about:
    "Internal mutation `access/clients:rotateGrant`. Unknown is `invalid_request`. A dead grant refuses (`grant_revoked` when " +
    "revoked or its context is gone or re-epoched, `grant_expired` past renewal or absolute expiry); an expiry first seen here " +
    "is recorded as a revocation. The presented revision: one this grant never issued is forged (`invalid_request`, nothing " +
    "revoked); the current one advances the revision and renewal (min of 30 days and absolute) and keeps the spent one valid " +
    "60 s; the previous one inside those 60 s re-answers the current grant unchanged; an older one, or the previous one after " +
    "60 s, revokes the family (`refresh_reused`).",
  was: [`${CONVEX}:13`, `${OPS}/rotate-grant.ts:17`, `${OPS}/rotate-grant.ts:31`, `${OPS}/rotate-grant.ts:37`, `${OPS}/rotate-grant.ts:46`, `${C}/rules.ts:184`, `${C}/rules.ts:217`, `${C}/rules.ts:225`, `${C}/rules.ts:22`, `${C}/writes/grants.ts:81`, `${C}/writes/grants.ts:102`],
  concept: concept_access,
  kind: "mutation",
  who: "internal: POST /api/auth/native/token with the refresh_token grant, after the refresh JWT verified.",
  input: Schema.Struct({ grantId: S, presentedRevision: N, now: N }),
  output: Schema.Union([Schema.Struct({ ok: Schema.Literal(true), ...GrantFacts }), Refusal]),
  errors: DEFECT,
  reads: [table_native_client_grants, table_native_client_contexts],
  writes: [table_native_client_grants],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_clients_revoke_grant = defineRpc({
  id: "access.clients.revoke-grant",
  title: "Revoke a grant",
  about:
    "Internal mutation `access/clients:revokeGrant`. Unknown is `invalid_request`; already revoked answers `revoked: false`. " +
    "Otherwise stamps `revokedAt` and `revokedRevision` and unsets the context's `currentGrantId`, whichever grant it named.",
  was: [`${CONVEX}:12`, `${OPS}/revoke-grant.ts:12`, `${OPS}/revoke-grant.ts:21`, `${C}/writes/grants.ts:102`, `${C}/writes/grants.ts:106`],
  concept: concept_access,
  kind: "mutation",
  who: "internal: POST /api/auth/native/revoke with an access or refresh token.",
  input: Schema.Struct({ grantId: S, now: N }),
  output: Schema.Union([Schema.Struct({ ok: Schema.Literal(true), revoked: B }), Refusal]),
  errors: DEFECT,
  reads: [table_native_client_grants],
  writes: [table_native_client_grants, table_native_client_contexts],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_clients_read_grant = defineRpc({
  id: "access.clients.read-grant",
  title: "A grant as /native/session reports it",
  about:
    "Internal query `access/clients:readGrant`: the grant with `revoked` (revokedAt, or its context missing or re-epoched) and " +
    "`expired` (past renewal or absolute expiry) already judged against `now`, or null.",
  was: [`${CONVEX}:9`, `${OPS}/read-grant.ts:9`, `${C}/reads/store.ts:73`],
  concept: concept_access,
  kind: "query",
  who: "internal: POST /api/auth/native/session.",
  input: Schema.Struct({ grantId: S, now: N }),
  output: Schema.NullOr(
    Schema.Struct({
      grantId: S,
      revision: N,
      authUserId: S,
      email: S,
      accountId: S,
      clientId: S,
      applicationId: S,
      resource: S,
      revoked: B,
      expired: B,
      renewalExpiresAt: N,
      absoluteExpiresAt: N,
    }),
  ),
  errors: DEFECT,
  reads: [table_native_client_grants, table_native_client_contexts],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_clients_read_request = defineRpc({
  id: "access.clients.read-request",
  title: "A request as the browser views it",
  about:
    "Internal query `access/clients:readRequest`: the request's browser fields, `expired` judged against `now` (never for a " +
    "completed request), and, once the request names a person, their Profile summary (display name, handle, country) from " +
    "profiles' readProfileSummaryInTx; or null.",
  was: [`${CONVEX}:11`, `${OPS}/read-request.ts:9`, `${C}/reads/store.ts:96`, `${C}/reads/store.ts:124`],
  concept: concept_access,
  kind: "query",
  who: "internal: the browser endpoints (view, accept, deny).",
  input: Schema.Struct({ requestId: S, now: N }),
  output: Schema.NullOr(BrowserRequest),
  errors: DEFECT,
  reads: [table_native_client_requests],
  writes: [],
  drives: [],
  invokes: [procedure_profiles_read_profile_summary_in_tx],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_clients_read_metadata = defineRpc({
  id: "access.clients.read-metadata",
  title: "This deployment's registered native client",
  about:
    "Internal query `access/clients:readMetadata`: applications' resolveNativeClientMetadata for the environment, as " +
    "`{ok: true, metadata}`; a deployment with no registered client (ENV_MISSING there) answers `{ok: false}`. Effect's " +
    "orElseSucceed turns every other failure into `{ok: false}` as well, though the code's comment says it fails the read.",
  was: [`${CONVEX}:10`, `${OPS}/read-metadata.ts:14`, `${OPS}/read-metadata.ts:22`, `${C}/reads/store.ts:144`],
  concept: concept_access,
  kind: "query",
  who: "internal: every native endpoint, through readConfiguredNativeMetadata.",
  input: Schema.Struct({ environment: S, now: N }),
  /** `NativeClientMetadataSchema` (protocol access/native-client-schema.ts:203), too deep to transcribe. */
  output: Schema.Union([Schema.Struct({ ok: Schema.Literal(true), metadata: U }), Schema.Struct({ ok: Schema.Literal(false) })]),
  errors: [],
  reads: [],
  writes: [],
  drives: [],
  invokes: [procedure_applications_resolve_native_client_metadata],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_clients_sweep_expired_batch = defineRpc({
  id: "access.clients.sweep-expired-batch",
  title: "One sweep batch: grants, then requests, past retention",
  about:
    "Internal mutation `access/clients:sweepExpiredBatch`. Cutoff = now - retention. Deletes up to `limit` grants whose " +
    "absolute expiry is before it, then up to `limit` requests whose `expiresAt` is before it, keeping a completed request " +
    "whose grant still exists. Answers the counts it read (a kept request counts). Contexts are never swept.",
  was: [`${CONVEX}:16`, `${OPS}/sweep-expired-batch.ts:10`, `${C}/writes/sweep.ts:13`, `${C}/writes/sweep.ts:32`],
  concept: concept_access,
  kind: "mutation",
  who: "internal: the daily sweep (access.clients.sweep-expired).",
  input: Schema.Struct({ now: N, retentionMs: N, limit: N }),
  output: Schema.Struct({ grants: N, requests: N }),
  errors: DEFECT,
  reads: [table_native_client_grants, table_native_client_requests],
  writes: [table_native_client_grants, table_native_client_requests],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const workflow_access_clients_sweep_expired = defineWorkflow({
  id: "access.clients.sweep-expired",
  title: "Sweep expired native client authorizations, daily",
  about:
    "Internal action `access/clients:sweepExpired`, the cron job `sweep expired native client authorizations` at 01:00 UTC " +
    "every day. It runs as the system job sweep_expired_native_client_authorizations and calls the batch once: 100 grants and " +
    "100 requests at most, 24 h past expiry. A backlog larger than one batch waits a day per batch. Timeout is Convex's action " +
    "limit; the code sets none.",
  was: [`${CONVEX}:15`, `${OPS}/sweep-expired.ts:14`, `${OPS}/sweep-expired.ts:16`, `${OPS}/sweep-expired.ts:28`, `${OPS}/sweep-expired.ts:39`, `${BACKEND}/src/platform/jobs.ts:68`, `${BACKEND}/convex/crons.ts:8`],
  concept: concept_access,
  priority: "low",
  trigger: { cron: "0 1 * * *" },
  instance: "singleton",
  steps: [
    { name: "attribute", about: "Records the run as the system job sweep_expired_native_client_authorizations." },
    { name: "sweep", about: "Runs access.clients.sweep-expired-batch with now, a 24 h retention and a limit of 100; answers its counts." },
  ],
  reads: [table_native_client_grants, table_native_client_requests],
  writes: [table_native_client_grants, table_native_client_requests],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  idempotency: "A deleted row is not read again; a second run deletes what the first left past the cutoff.",
  timeoutMs: 600000,
  retries: { max: 0, backoff: "none" },
});

// ── the native endpoints (/api/auth/native/*) ───────────────────────────────────────────────

export const rpc_access_clients_native_metadata = defineRpc({
  id: "access.clients.native-metadata",
  title: "The registered native client (GET /api/auth/native/metadata)",
  about:
    "BetterAuth endpoint of the `capxul-native-issuer` plugin. Reads this deployment's environment from its URL " +
    "(resolveCapxulEnv; `unknown` fails closed) and its registered client; answers the metadata (protocol " +
    "capxul.client-authorization v1: configuration, scopes, grant types and the endpoint URLs) or 503 `server_error`.",
  was: [`${OPS}/native-metadata.ts:7`, `${PLUGINS}:28`, `${C}/views/responses.ts:55`, ...METADATA.was, ...ENDPOINT_WAS],
  concept: concept_access,
  kind: "action",
  who: "Anyone: the CLI before it starts a device request.",
  input: Schema.Struct({}),
  output: U,
  errors: ENDPOINT_ERRORS,
  reads: [],
  writes: [],
  drives: [],
  invokes: METADATA.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_clients_native_device_code = defineRpc({
  id: "access.clients.native-device-code",
  title: "Start a device request (POST /api/auth/native/device/code)",
  about:
    "The CLI opens a device request. 503 without a registered client; 400 `invalid_request` for a body " +
    "ClientAuthorizationStartSchema refuses (client capxul-cli, email, intent login or signup with a profile, waitMs). Runs " +
    "access.clients.start-request (the resource is `<issuer>/api/auth/native`; a signup's profile is stored as JSON; the " +
    "body's `continuityToken` is accepted and ignored). A refusal schedules native_authorization_failed and answers 429 " +
    "`slow_down` with retry_after for `rate_limited`, else 400 with the OAuth error. Success schedules " +
    "native_authorization_started (mode) and answers requestId, device_code, user_code, continuityToken, verification_uri " +
    "(`<verificationOrigin>/connect`), expires_in and interval. Events are sent as the native_authorization_issuer system " +
    "actor with the client's sanitized trace context.",
  was: [`${OPS}/native-device-code.ts:17`, `${OPS}/native-device-code.ts:25`, `${OPS}/native-device-code.ts:37`, `${OPS}/native-device-code.ts:58`, `${PLUGINS}:31`, `${C}/events.ts:43`, `${C}/events.ts:50`, `${PROTOCOL}/authorization-schema.ts:59`, `${PROTOCOL}/native-client-schema.ts:191`, ...METADATA.was, ...ENDPOINT_WAS],
  concept: concept_access,
  kind: "action",
  who: "Anyone, signed out: the CLI's device start for one email.",
  input: Schema.Struct({ clientId: Schema.Literal("capxul-cli"), email: S, intent: U, waitMs: N, continuityToken: opt(S) }),
  output: Schema.Struct({ requestId: S, device_code: S, user_code: S, continuityToken: S, verification_uri: S, expires_in: N, interval: N }),
  errors: ENDPOINT_ERRORS,
  reads: [table_native_client_requests, table_native_client_contexts],
  writes: [table_native_client_requests, table_native_client_contexts],
  drives: [],
  invokes: [...METADATA.invokes, ...HASH],
  emits: [event_native_authorization_started, event_native_authorization_failed],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_clients_native_token = defineRpc({
  id: "access.clients.native-token",
  title: "Poll for the grant, or refresh it (POST /api/auth/native/token)",
  about:
    "503 without a registered client. `grant_type` device_code: decodes the body, runs access.clients.consume-request; " +
    "`authorization_pending` and `slow_down` answer 400 retryable (slow_down with retry_after 5) and send no event; any other " +
    "refusal schedules native_authorization_failed and answers 400 with its OAuth error. `refresh_token`: verifies the refresh " +
    "JWT against the deployment's keys (aud capxul-native-refresh; an unverifiable token is 400 `invalid_grant`), then runs " +
    "access.clients.rotate-grant. Either way the grant is signed afresh: an access JWT (aud capxul-native-access, one hour, " +
    "capped at renewal) and a refresh JWT to the renewal expiry, both with sub, grantId, revision, accountId, applicationId, " +
    "resource and scope account:read. Neither audience is `convex`, so the platform refuses both. Only the first delivery " +
    "schedules native_authorization_connected. Another grant type is 400 `invalid_request`.",
  was: [`${OPS}/native-token.ts:31`, `${OPS}/native-token.ts:54`, `${OPS}/native-token.ts:81`, `${OPS}/native-token.ts:90`, `${OPS}/native-token.ts:106`, `${PLUGINS}:34`, `${C}/views/responses.ts:62`, `${C}/views/responses.ts:77`, `${C}/events.ts:50`, `${C}/events.ts:115`, ...TOKEN_WAS, ...METADATA.was, ...ENDPOINT_WAS],
  concept: concept_access,
  kind: "action",
  who: "The CLI holding a device code or a refresh token.",
  input: Schema.Struct({ client_id: Schema.Literal("capxul-cli"), grant_type: S, device_code: opt(S), refresh_token: opt(S) }),
  /** `NativeTokenResponseSchema` (protocol access/authorization-schema.ts:159). */
  output: Schema.Struct({
    client_id: S,
    applicationId: S,
    resource: S,
    token_type: Schema.Literal("Bearer"),
    access_token: S,
    refresh_token: S,
    scope: Schema.Literal("account:read"),
    expires_in: N,
    grantId: S,
    authUserId: S,
    email: S,
    accountId: S,
    issuedAt: N,
    grantCreatedAt: N,
    accessExpiresAt: N,
    renewalExpiresAt: N,
    absoluteExpiresAt: N,
    revision: N,
  }),
  errors: ENDPOINT_ERRORS,
  reads: [table_native_client_requests, table_native_client_grants, table_native_client_contexts, ...TOKEN_READS],
  writes: [table_native_client_requests, table_native_client_grants, table_native_client_contexts],
  drives: [machine_native_client_request.t.to_expired, machine_native_client_request.t.to_completed],
  invokes: [...METADATA.invokes, ...HASH],
  emits: [event_native_authorization_failed, event_native_authorization_connected],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_clients_native_revoke = defineRpc({
  id: "access.clients.native-revoke",
  title: "Cancel a request or revoke a grant (POST /api/auth/native/revoke)",
  about:
    "RFC 7009: answers 200 whatever the token. With token_type_hint `device_code` it runs access.clients.cancel-request and " +
    "answers `{revoked: ok, unconfirmed: !ok}`. Otherwise it finds the grant a refresh token, or failing that an access " +
    "token, names (verified against the deployment's keys); none is `{revoked: false, unconfirmed: true}`; then " +
    "access.clients.revoke-grant. 503 without a registered client; 400 for a body it does not admit.",
  was: [`${OPS}/native-revoke.ts:17`, `${OPS}/native-revoke.ts:25`, `${OPS}/native-revoke.ts:33`, `${OPS}/native-revoke.ts:35`, `${PLUGINS}:37`, ...TOKEN_WAS, ...METADATA.was, ...ENDPOINT_WAS],
  concept: concept_access,
  kind: "action",
  who: "The CLI holding a device code, an access token or a refresh token.",
  input: Schema.Struct({ client_id: Schema.Literal("capxul-cli"), token: S, token_type_hint: opt(Schema.Literals(["access_token", "refresh_token", "device_code"])) }),
  output: Schema.Struct({ revoked: B, unconfirmed: B }),
  errors: ENDPOINT_ERRORS,
  reads: [table_native_client_requests, table_native_client_grants, ...TOKEN_READS],
  writes: [table_native_client_requests, table_native_client_grants, table_native_client_contexts],
  drives: [machine_native_client_request.t.to_cancelled],
  invokes: [...METADATA.invokes, ...HASH],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_clients_native_session = defineRpc({
  id: "access.clients.native-session",
  title: "Whether an access token's grant is live (POST /api/auth/native/session)",
  about:
    "Verifies the access JWT (aud capxul-native-access) against the deployment's keys; an unverifiable token answers " +
    "`{active: false}`. Then access.clients.read-grant: missing, revoked or expired answers `{active: false, grantId}`; a live " +
    "grant answers its person, Account, application, resource, scope account:read and expiries. 503 without a registered " +
    "client; 400 for a body it does not admit.",
  was: [`${OPS}/native-session.ts:16`, `${OPS}/native-session.ts:23`, `${OPS}/native-session.ts:31`, `${PLUGINS}:40`, ...TOKEN_WAS, ...METADATA.was, ...ENDPOINT_WAS],
  concept: concept_access,
  kind: "action",
  who: "A client holding a native access token.",
  input: Schema.Struct({ client_id: Schema.Literal("capxul-cli"), token: S }),
  output: Schema.Struct({
    active: B,
    grantId: opt(S),
    revision: opt(N),
    authUserId: opt(S),
    email: opt(S),
    accountId: opt(S),
    applicationId: opt(S),
    resource: opt(S),
    scope: opt(S),
    renewalExpiresAt: opt(N),
    absoluteExpiresAt: opt(N),
  }),
  errors: ENDPOINT_ERRORS,
  reads: [table_native_client_grants, table_native_client_contexts, ...TOKEN_READS],
  writes: [],
  drives: [],
  invokes: METADATA.invokes,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_clients_native_request_view = defineRpc({
  id: "access.clients.native-request-view",
  title: "A request as the browser sees it (GET /api/auth/native/request)",
  about:
    "BetterAuth endpoint of the `capxul-native-browser` plugin. Needs `requestId` (400) of a known request (404). Reads the " +
    "browser's BetterAuth session and projects one of five phases: refused (a stored refusal, expired, denied, cancelled), " +
    "connected (completed, with the Profile summary) or processing (delivery pending, or an approved or adopted signup's " +
    "account setup), review (a session for the request's exact email; setupState new, resumable or not_required), else " +
    "otp_required with resendAt 60 s after the request opened. A review not marked yet runs access.clients.mark-reviewed and, " +
    "the first time, schedules native_authorization_reviewed as the signed-in person (or the continuation system actor). " +
    "It does not check registered-client metadata.",
  was: [`${OPS}/native-request-view.ts:17`, `${OPS}/native-request-view.ts:24`, `${OPS}/native-request-view.ts:27`, `${OPS}/native-request-view.ts:32`, `${PLUGINS}:52`, `${C}/views/requests.ts:140`, `${C}/reads/endpoints.ts:82`, `${C}/events.ts:73`, ...ENDPOINT_WAS],
  concept: concept_access,
  kind: "action",
  who: "Any browser holding the requestId; the phase depends on its BetterAuth session.",
  input: Schema.Struct({ requestId: S }),
  output: ClientRequestView,
  errors: ENDPOINT_ERRORS,
  reads: [table_native_client_requests, ...BROWSER_SESSION_READS],
  writes: [table_native_client_requests],
  drives: [],
  invokes: [procedure_profiles_read_profile_summary_in_tx],
  emits: [event_native_authorization_reviewed],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_clients_native_request_accept = defineRpc({
  id: "access.clients.native-request-accept",
  title: "The browser says yes (POST /api/auth/native/request/accept)",
  about:
    "Decodes `{requestId, revision}` (400), reads the request (404) and the browser session (none: 401 with the otp_required " +
    "view). Runs access.clients.accept-request on Base Sepolia. A refusal schedules native_authorization_failed and answers " +
    "the refused view (403 for identity_mismatch or fresh_session_required, which the view reports as identity_mismatch; " +
    "400 otherwise). The first acceptance schedules native_authorization_accepted (setup_state new, resumable or " +
    "not_required). A signup that still owes setup answers the processing view (step profile or account); otherwise the " +
    "request is read again and projected.",
  was: [`${OPS}/native-request-accept.ts:18`, `${OPS}/native-request-accept.ts:26`, `${OPS}/native-request-accept.ts:28`, `${OPS}/native-request-accept.ts:45`, `${OPS}/native-request-accept.ts:56`, `${PLUGINS}:55`, `${C}/views/responses.ts:45`, `${C}/views/requests.ts:109`, `${C}/events.ts:61`, `${C}/events.ts:88`, ...ENDPOINT_WAS],
  concept: concept_access,
  kind: "action",
  who: "A browser signed in with BetterAuth as the request's exact email, in a session not older than the request.",
  input: Schema.Struct({ requestId: S, revision: N }),
  output: ClientRequestView,
  errors: ENDPOINT_ERRORS,
  reads: [table_native_client_requests, table_user_app_consents, ...BROWSER_SESSION_READS],
  writes: [table_native_client_requests, table_user_app_consents],
  drives: [machine_native_client_request.t.to_approved, machine_native_client_request.t.to_denied, machine_native_client_request.t.to_expired],
  invokes: [procedure_profiles_read_profile_readiness_in_tx, procedure_accounts_read_native_ready_account_in_tx, procedure_profiles_read_profile_summary_in_tx],
  emits: [event_native_authorization_failed, event_native_authorization_accepted],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_clients_native_request_deny = defineRpc({
  id: "access.clients.native-request-deny",
  title: "The browser says no (POST /api/auth/native/request/deny)",
  about:
    "The same checks as an accept (400, 404, 401 without a session), then access.clients.deny-request. A refusal schedules " +
    "native_authorization_failed and answers the refused view; a denial schedules native_authorization_denied and answers the " +
    "request read again. The SDK's clientRequests.cancel posts here.",
  was: [`${OPS}/native-request-deny.ts:18`, `${OPS}/native-request-deny.ts:28`, `${OPS}/native-request-deny.ts:41`, `${PLUGINS}:58`, `${C}/events.ts:61`, `${C}/events.ts:99`, "packages/sdk/src/access/client-requests.ts:225", ...ENDPOINT_WAS],
  concept: concept_access,
  kind: "action",
  who: "A browser signed in with BetterAuth as the request's exact email, in a session not older than the request.",
  input: Schema.Struct({ requestId: S, revision: N }),
  output: ClientRequestView,
  errors: ENDPOINT_ERRORS,
  reads: [table_native_client_requests, ...BROWSER_SESSION_READS],
  writes: [table_native_client_requests],
  drives: [machine_native_client_request.t.to_denied, machine_native_client_request.t.to_expired],
  invokes: [procedure_profiles_read_profile_summary_in_tx],
  emits: [event_native_authorization_failed, event_native_authorization_denied],
  calls: [],
  chain: [],
  spans: [],
});
