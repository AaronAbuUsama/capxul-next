// Access' tables, its two state machines and each machine's one event (P7), in the target design.
//
// What access stores: who a caller can be (principals), how a person proves an email (sign-in
// codes), what a caller holds after signing in (sessions), what an assistant holds after a person
// allows it (assistant grants), and the feature flags synced from PostHog. Every judgment is a
// decision in ./decisions.ts; `was` points at the old code (/home/user/factory) or the as-is book.
//
// Gone from the old access concept: BetterAuth's component tables (decision access.own-sign-in), the
// native client contexts, requests and grants (access.no-device-flow), the devnet gate table (it is
// devnet's) and the sync-run log (access.gates), application consent (applications') and the
// waitlist and referrals (accounts').

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_access } from "../shared/foundation.ts";

const OLD = "packages/backend/src/access";
const ASIS = "books/as-is/access/data.ts";

const S = Schema.String;
const Time = Schema.DateTimeUtc;
const Null = Schema.NullOr;

// ── principals ──────────────────────────────────────────────────────────────────────────────

export const table_principals = defineTable({
  id: "principals",
  title: "Principals: every person and agent a session can name",
  about:
    "One row per caller Capxul can know: a person, known by their email, or an agent, known by its Safe. `person_id` is the " +
    "principal's id for both kinds, so a session, an assistant grant and every personal row in other concepts carry one " +
    "tenant column. A person's row is born at their first verified code, with `safe_address` computed from the email by " +
    "Companies House's pure address function (no chain call). An agent's row is born at its first signed challenge, with " +
    "the Safe it proved and the key that signed. Names, handles and images are parties', not access'. A principal is " +
    "never deleted: other concepts' rows name it.",
  was: [`${ASIS}:474`, `${OLD}/sessions/reads.ts:47`, `${OLD}/agents/reads.ts:31`],
  concept: concept_access,
  tenancy: "person",
  tenantField: "person_id",
  fields: Schema.Struct({
    person_id: S,
    kind: Schema.Literals(["person", "agent"]),
    /** A person's email, trimmed and lowercased; null for an agent. */
    email: Null(S),
    /** The Safe the principal acts with: a person's email-derived Safe, or the agent's own. */
    safe_address: S,
    /** The key an agent proved at its last sign-in; null for a person, whose signer is set up by accounts. */
    signer_address: Null(S),
    created_at: Time,
  }),
  key: ["person_id"],
  indexes: [
    {
      name: "by_email",
      fields: ["email"],
      unique: true,
      crossTenant: true,
      for: "A verified code finds the principal of its email before anyone is signed in (access.sign-in.verify-code).",
    },
    {
      name: "by_safe",
      fields: ["safe_address"],
      unique: true,
      crossTenant: true,
      for: "A signed challenge finds the agent's principal by the Safe it proves (access.sign-in.with-key).",
    },
  ],
  retention: "Kept for good: every personal row in Capxul names its principal.",
});

// ── sign-in codes ───────────────────────────────────────────────────────────────────────────

export const table_sign_in_codes = defineTable({
  id: "sign-in-codes",
  title: "Sign-in codes: the one code waiting for each email, and its cooldown",
  about:
    "One row per email that asked for a code: the hash of the six-digit code, the tries left (three), when it expires (five " +
    "minutes after it was sent) and when it was sent, which is the send cooldown (no new code within 60 seconds). A new " +
    "send replaces the code; a right code deletes the row in the transaction that opens the session. The old cooldown " +
    "table and BetterAuth's verification rows were two stores of one fact; this is one. The tenant is the email, because " +
    "no principal exists until a code is verified (decision access.tenancy-before-sign-in).",
  was: [`${ASIS}:77`, `${ASIS}:536`, `${OLD}/sessions/rules.ts:165`, `${OLD}/sessions/external/auth.ts:197`],
  concept: concept_access,
  tenancy: "person",
  tenantField: "email",
  fields: Schema.Struct({
    email: S,
    code_hash: S,
    attempts_left: Schema.Int,
    sent_at: Time,
    expires_at: Time,
  }),
  key: ["email"],
  indexes: [
    {
      name: "by_expiry",
      fields: ["expires_at"],
      crossTenant: true,
      for: "The daily sweep deletes codes that expired unused (access.sessions.sweep).",
    },
  ],
  retention: "Deleted when its code is used, or by the daily sweep once it has expired.",
});

// ── sessions ────────────────────────────────────────────────────────────────────────────────

export const table_sessions = defineTable({
  id: "sessions",
  title: "Sessions: what a signed-in person or agent calls with",
  about:
    "One row per sign-in on one host (a CLI on a machine, a browser, an agent's program). The token is 32 random bytes " +
    "handed back once; only its SHA-256 is stored, and the runtime resolves every request's bearer through it before the " +
    "tenant is known, then sets the tenant for the transaction. `method` says how it was proved: an emailed code (a " +
    "person, 30 days) or a signed challenge (an agent, 24 hours, renewed by the SDK signing again). An agent's session " +
    "keeps the challenge it consumed, so a challenge opens one session at most. A session ends revoked (sign-out) or " +
    "expired (the daily sweep), and is deleted 30 days later.",
  was: [`${ASIS}:499`, `${OLD}/agents/writes.ts:10`, `${OLD}/sessions/reads.ts:39`],
  concept: concept_access,
  tenancy: "person",
  tenantField: "person_id",
  fields: Schema.Struct({
    person_id: S,
    session_id: S,
    token_hash: S,
    method: Schema.Literals(["code", "key"]),
    status: Schema.Literals(["active", "revoked", "expired"]),
    /** The agent challenge this session consumed; null for a code sign-in. */
    challenge_nonce: Null(S),
    /** The host that signed in, as its user agent says: `capxul-cli/<version>`, a browser, an agent's program. */
    client: S,
    created_at: Time,
    expires_at: Time,
    ended_at: Null(Time),
  }),
  key: ["person_id", "session_id"],
  indexes: [
    {
      name: "by_token",
      fields: ["token_hash"],
      unique: true,
      crossTenant: true,
      for: "The runtime finds the session a request's bearer names, before any tenant is set; access.sessions.current and revoke read it so.",
    },
    {
      name: "by_challenge",
      fields: ["challenge_nonce"],
      unique: true,
      crossTenant: true,
      for: "A replayed agent challenge finds its nonce already spent and is refused (access.sign-in.with-key).",
    },
    {
      name: "by_status_expiry",
      fields: ["status", "expires_at"],
      crossTenant: true,
      for: "The daily sweep finds active sessions past their expiry, and ended ones past retention (access.sessions.sweep).",
    },
  ],
  retention: "Deleted by the daily sweep 30 days after it ends.",
});

export const event_session_transitioned = defineEvent({
  id: "session_transitioned",
  about:
    "A session opened (a person or an agent signed in), was revoked (signed out) or expired. Proves the sign-in step of a " +
    "journey: `to: active` with `method` says how. Replaces the old auth_verified, auth_signed_out and the agent exchange's " +
    "implicit sessions.",
  props: Schema.Struct({
    from: Null(S),
    to: S,
    transition: S,
    session_id: S,
    person_id: S,
    method: Schema.Literals(["code", "key"]),
  }),
  was: ["packages/backend/src/access/sessions/events.ts:23", "docs/decisions/policy-pack.md#p7"],
});

export const machine_session = defineMachine({
  id: "session",
  title: "Session: active, then revoked or expired",
  about:
    "sessions.status. Born active by a verified code or a signed challenge; the token is refused the moment the row leaves " +
    "active, and the runtime also refuses an active row past `expires_at` before the sweep marks it.",
  table: table_sessions,
  field: "status",
  initial: "active",
  states: [
    { id: "active", about: "Its token is accepted until `expires_at`." },
    { id: "revoked", about: "Signed out: its token is refused.", terminal: true },
    { id: "expired", about: "Its time ran out; the daily sweep recorded it.", terminal: true },
  ],
  transitions: {
    open: {
      from: [],
      to: "active",
      about: "The birth: a right code (access.sign-in.verify-code) or a proved challenge (access.sign-in.with-key).",
      emits: [event_session_transitioned],
    },
    revoke: {
      from: ["active"],
      to: "revoked",
      about: "Sign-out from the host holding the token (access.sessions.revoke).",
      emits: [event_session_transitioned],
    },
    expire: {
      from: ["active"],
      to: "expired",
      guard: "now is past expires_at.",
      about: "The daily sweep (access.sessions.sweep).",
      emits: [event_session_transitioned],
    },
  },
});

// ── assistant grants ────────────────────────────────────────────────────────────────────────

export const table_assistant_grants = defineTable({
  id: "assistant-grants",
  title: "Assistant grants: a person's OAuth grant to an MCP client",
  about:
    "One row per time a person allowed an assistant's OAuth client (an MCP client such as Claude) to act as them. Born " +
    "pending at consent with the hash of a one-time code and the PKCE challenge; the client's code exchange makes it " +
    "active with an access token (one hour) and a refresh token, each stored only as a hash. A refresh rotates both and " +
    "keeps the spent refresh token good for 60 seconds, so a lost answer can be repeated; a spent token used after that " +
    "revokes the grant. The refresh window slides 30 days from the last refresh and never passes 90 days from consent. " +
    "The client id is the one Capxul signed at registration, which carries the client's name and redirect URIs, so " +
    "there is no client table. The tokens are for one resource: the MCP server's URL.",
  was: [`${ASIS}:569`, `${ASIS}:584`, `${ASIS}:606`, `${OLD}/agents/reads.ts:19`, `${OLD}/rules.ts:14`],
  concept: concept_access,
  tenancy: "person",
  tenantField: "person_id",
  fields: Schema.Struct({
    person_id: S,
    grant_id: S,
    client_id: S,
    client_name: S,
    redirect_uri: S,
    resource: S,
    scopes: Schema.Array(S),
    status: Schema.Literals(["pending", "active", "revoked", "expired"]),
    code_hash: Null(S),
    code_challenge: S,
    access_token_hash: Null(S),
    access_expires_at: Null(Time),
    refresh_token_hash: Null(S),
    previous_refresh_hash: Null(S),
    previous_valid_until: Null(Time),
    /** While pending, when the code lapses (10 minutes); once active, the end of the sliding refresh window. */
    renews_by: Time,
    /** 90 days after consent: no refresh reaches past it. */
    expires_at: Time,
    created_at: Time,
    ended_at: Null(Time),
  }),
  key: ["person_id", "grant_id"],
  indexes: [
    {
      name: "by_code",
      fields: ["code_hash"],
      unique: true,
      crossTenant: true,
      for: "The token route finds the grant a presented code names; the client is not signed in, so no tenant is set (access.assistants.token).",
    },
    {
      name: "by_access_token",
      fields: ["access_token_hash"],
      unique: true,
      crossTenant: true,
      for: "The runtime resolves an assistant's bearer to the person and scopes it acts with; the revocation route finds it too.",
    },
    {
      name: "by_refresh_token",
      fields: ["refresh_token_hash"],
      unique: true,
      crossTenant: true,
      for: "A refresh, or a revocation by refresh token, finds its grant (access.assistants.token, access.assistants.revoke).",
    },
    {
      name: "by_previous_refresh",
      fields: ["previous_refresh_hash"],
      crossTenant: true,
      for: "A spent refresh token is recognised: repeated inside its 60 seconds, or a reuse that revokes the grant.",
    },
    {
      name: "by_status_ended",
      fields: ["status", "ended_at"],
      crossTenant: true,
      for: "The daily sweep deletes grants 30 days after they ended (access.sessions.sweep).",
    },
  ],
  retention: "Deleted by the daily sweep 30 days after it ends.",
});

export const event_assistant_grant_transitioned = defineEvent({
  id: "assistant_grant_transitioned",
  about:
    "A person allowed an assistant (pending), its client took the tokens (active), or the grant was revoked or expired. " +
    "Proves the connect-an-assistant journey; replaces nothing in the old system, which recorded no OAuth event.",
  props: Schema.Struct({
    from: Null(S),
    to: S,
    transition: S,
    grant_id: S,
    person_id: S,
    client_name: S,
  }),
  was: ["docs/decisions/policy-pack.md#p7"],
});

export const machine_assistant_grant = defineMachine({
  id: "assistant-grant",
  title: "Assistant grant: pending, active, then revoked or expired",
  about:
    "assistant-grants.status. Its durable process (access.assistants.grant) owns the clock: it expires a code that is " +
    "never exchanged and a grant whose refresh window lapses. The token and revocation routes drive the rest.",
  table: table_assistant_grants,
  field: "status",
  initial: "pending",
  states: [
    { id: "pending", about: "The person allowed the client; its one-time code waits to be exchanged." },
    { id: "active", about: "The client holds an access token and a refresh token." },
    { id: "revoked", about: "The client revoked it, or reused a spent refresh token: every token is refused.", terminal: true },
    { id: "expired", about: "The code was never exchanged, or the refresh window lapsed.", terminal: true },
  ],
  transitions: {
    consent: {
      from: [],
      to: "pending",
      about: "The birth: the person allows the client on the consent page (access.assistants.consent).",
      emits: [event_assistant_grant_transitioned],
    },
    exchange: {
      from: ["pending"],
      to: "active",
      guard: "The code is the grant's, before renews_by; the verifier matches the PKCE challenge; same client and redirect URI.",
      about: "The client's code exchange at the token route (access.assistants.token).",
      emits: [event_assistant_grant_transitioned],
    },
    revoke: {
      from: ["pending", "active"],
      to: "revoked",
      about: "The revocation route (access.assistants.revoke), or the token route seeing a spent refresh token reused.",
      emits: [event_assistant_grant_transitioned],
    },
    expire: {
      from: ["pending", "active"],
      to: "expired",
      guard: "now is past renews_by, or past expires_at.",
      about: "The grant's own process, when its code or refresh window lapses (access.assistants.grant).",
      emits: [event_assistant_grant_transitioned],
    },
  },
});

// ── feature flags ───────────────────────────────────────────────────────────────────────────

export const table_feature_flags = defineTable({
  id: "feature-flags",
  title: "Feature flags: the gates synced from PostHog",
  about:
    "One row per gate in the catalogue (the code's list of gate keys, each with its target and per-environment default): " +
    "whether PostHog has it on, whether it targets a person or an Organization, and its rules (lists of ids, or everyone, " +
    "each with a rollout percentage). A rule the evaluator cannot read (a cohort, a property, a variant) is kept as " +
    "`unsupported` and the gate reads off. Every good sync stamps `checked_at`; a money gate reads off when the last good " +
    "sync is older than 10 minutes. Every concept that refuses FEATURE_NOT_AVAILABLE reads this table through access' one " +
    "evaluator (decision access.gates). On a devnet the flags come from devnet's gate table, through the PostHog fake.",
  was: [`${ASIS}:293`, `${ASIS}:319`, `${OLD}/features/rules.ts:84`, `${OLD}/features/reads.ts:69`],
  concept: concept_access,
  tenancy: "global",
  fields: Schema.Struct({
    key: S,
    active: Schema.Boolean,
    target: Schema.Literals(["person", "organization"]),
    rules: Schema.Array(Schema.Struct({ ids: Null(Schema.Array(S)), rollout: Schema.Int })),
    unsupported: Null(S),
    checked_at: Time,
  }),
  key: ["key"],
  indexes: [],
  retention: "Rewritten by each good sync; a flag PostHog no longer has is deleted by it.",
});
