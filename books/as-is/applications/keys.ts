// The as-is book of the old applications concept: the keys area.
//
// Every operation registered at `applications/keys:*` (packages/backend/convex/applications/keys.ts).
// `create`, `list`, `rotate` and `revoke` implement the public rows `keys`
// (packages/protocol/src/applications/operations.ts:83). `issue`, `revokeById` and `trustsOrigin` are
// internal: run by other actions, by Access's sign-in, or by an operator with `convex run`.
// `emitTransitioned` is the telemetry action a committed create, rotate or revoke schedules.
//
// A key operation acts for the signed-in Account or for an Organization the caller belongs to. The
// actor check is Access's (`actorFromSession`) and the issue-invoices check Organizations'
// (`requireIssueInvoicesInTx`): both are invokes of those concepts' procedures.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_applications } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_UNKNOWN,
  error_WRONG_STATE,
  event_app_key_transitioned,
} from "../shared/vocabulary.ts";
import { procedure_access_actor_from_session } from "../access/procedures.ts";
import { procedure_organizations_require_issue_invoices_in_tx } from "../organizations/procedures.ts";
import {
  machine_publishable_key,
  table_developer_applications,
  table_publishable_key_origins,
  table_publishable_keys,
} from "./data.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/applications/keys.ts`;
const A = `${BACKEND}/src/applications`;
const K = `${A}/keys`;
const OPS = `${K}/operations`;
const ROWS = "packages/protocol/src/applications/operations.ts";

// ── shapes ─────────────────────────────────────────────────────────────────────────────────

/** `ActorScopeSchema` (protocol parties/schema.ts:19): the signed-in Account (default) or an Organization. */
const Actor = Schema.optionalKey(
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal("account") }),
    Schema.Struct({ kind: Schema.Literal("org"), orgId: Schema.String }),
  ]),
);

/** `Key` (operations.ts:41): a publishable key as its account sees it; never the raw key. */
const Key = Schema.Struct({
  id: Schema.String,
  applicationId: Schema.String,
  app: Schema.String,
  prefix: Schema.String,
  hint: Schema.NullOr(Schema.String),
  environment: Schema.Literals(["test", "live"]),
  allowedOrigins: Schema.Array(Schema.String),
  state: Schema.Literals(["active", "grace", "expired", "revoked"]),
  activeFromMs: Schema.Number,
  gracePeriodEndsMs: Schema.NullOr(Schema.Number),
  revokedAt: Schema.NullOr(Schema.Number),
  lastUsedAt: Schema.NullOr(Schema.Number),
});

/** `CreatedKey` (operations.ts:61): the only time the raw key leaves the backend. */
const CreatedKey = Schema.Struct({ key: Key, publishableKey: Schema.String });

// ── shared guards and errors ───────────────────────────────────────────────────────────────

/** requireKeyReader (keys/guards.ts:23): the session, then Access's actor; an Organization stamps the wide event. */
const READER_INVOKES = [procedure_access_actor_from_session];
/** requireKeyWriter (keys/guards.ts:37): the reader, and for an Organization a Member who holds issue invoices now. */
const WRITER_INVOKES = [procedure_access_actor_from_session, procedure_organizations_require_issue_invoices_in_tx];
const GUARD_WAS = [
  `${K}/guards.ts:23`,
  `${K}/guards.ts:28`,
  `${K}/guards.ts:37`,
  `${K}/guards.ts:43`,
  `${BACKEND}/src/access/sessions/guards.ts:52`,
  `${BACKEND}/src/organizations/members/reads/permissions.ts:67`,
];
/** requireOwnedKey (keys/guards.ts:51): a missing key, someone else's and an unowned one refuse alike. */
const OWNED_WAS = [`${K}/guards.ts:51`, `${K}/guards.ts:55`, `${K}/guards.ts:57`, `${K}/rules.ts:24`];

/** CALL, DEFECTS, MEMBER (operations.ts:19, :38; protocol operation.ts:54). */
const ROW_ERRORS = [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING, error_ROLE_PERMISSION_DENIED];

/** keyDeployment (keys/reads.ts:16) and deploymentConfiguration (reads.ts:126): what a key made here serves. */
const DEPLOYMENT_WAS = [`${K}/reads.ts:16`, `${A}/reads.ts:126`, `${A}/errors.ts:34`, `${A}/errors.ts:38`];

/** keyTransitioned (keys/events.ts:60): the committed change is scheduled to applications.keys.emit-transitioned. */
const EVENT_WAS = [`${K}/events.ts:60`, `${K}/events.ts:78`];

// ── public rows ────────────────────────────────────────────────────────────────────────────

export const rpc_applications_keys_create = defineRpc({
  id: "applications.keys.create",
  title: "Make a publishable key for the caller's account",
  about:
    "Row `applications.keys.create`, registered as the public mutation `applications/keys:create`. The writer guard " +
    "(Access's actor; for an Organization, Organizations' issue-invoices check, ROLE_PERMISSION_DENIED). The app name " +
    "defaults to `default` (1..64 characters); an empty `allowedOrigins` refuses INVALID_INPUT, given origins must be " +
    "http(s) without a wildcard. The deployment must declare itself: OPENFORT_PUBLISHABLE_KEY, SHIELD_PUBLISHABLE_KEY " +
    "and CONVEX_SITE_URL (ENV_MISSING) and a CONVEX_CLOUD_URL that resolves to a known tier (INVALID_INPUT " +
    "`CONVEX_CLOUD_URL`). The account may hold at most 20 keys still `active` or `grace` across its applications " +
    "(WRONG_STATE `20-live-keys`). The named application is created with this deployment's routing and " +
    "`http://localhost:3000` when no origins are given, or has its origins replaced when given. A key is minted " +
    "(`live` on production, `test` everywhere else) with the application's origins, its origins indexed, and " +
    "`app_key_transitioned` (`created`) scheduled in the same transaction. Answers the key view and the raw key, once.",
  was: [
    `${CONVEX}:3`,
    `${OPS}/create.ts:16`,
    `${OPS}/create.ts:21`,
    `${OPS}/create.ts:30`,
    `${OPS}/create.ts:45`,
    `${K}/rules.ts:15`,
    `${K}/rules.ts:18`,
    `${K}/rules.ts:45`,
    `${K}/errors.ts:11`,
    `${K}/errors.ts:47`,
    `${K}/writes.ts:24`,
    `${K}/writes.ts:61`,
    `${A}/writes.ts:46`,
    `${A}/writes.ts:90`,
    `${ROWS}:89`,
    ...GUARD_WAS,
    ...DEPLOYMENT_WAS,
    ...EVENT_WAS,
  ],
  concept: concept_applications,
  kind: "mutation",
  who: "A signed-in person for their own Account, or a Member of the Organization who holds issue invoices now.",
  input: Schema.Struct({
    actor: Actor,
    app: Schema.optionalKey(Schema.String),
    allowedOrigins: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  output: CreatedKey,
  errors: [...ROW_ERRORS, error_WRONG_STATE],
  reads: [table_developer_applications, table_publishable_keys, table_publishable_key_origins],
  writes: [table_developer_applications, table_publishable_keys, table_publishable_key_origins],
  drives: [],
  invokes: WRITER_INVOKES,
  emits: [event_app_key_transitioned],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_applications_keys_list = defineRpc({
  id: "applications.keys.list",
  title: "The account's publishable keys, newest first",
  about:
    "Row `applications.keys.list`, registered as the public query `applications/keys:list`. The reader guard: any " +
    "Member lists an Organization's keys. Reads the account's active applications (by `ownerOrgId`, or by " +
    "`ownerAuthUserId` without an `ownerOrgId`), then every key of each, revoked ones included, sorted by `createdAt`, " +
    "then storage insertion time, then key id, newest first, in one page with no cursor. Each key's state is " +
    "derived at the query's `wallTime()`; a key of an archived application is not listed.",
  was: [`${CONVEX}:6`, `${OPS}/list.ts:12`, `${K}/reads.ts:25`, `${K}/reads.ts:43`, `${K}/reads.ts:61`, `${K}/views.ts:20`, `${ROWS}:100`, ...GUARD_WAS],
  concept: concept_applications,
  kind: "query",
  who: "A signed-in person for their own Account, or any Member of the Organization.",
  input: Schema.Struct({ actor: Actor }),
  output: Schema.Struct({ items: Schema.Array(Key), nextCursor: Schema.Null }),
  errors: ROW_ERRORS,
  reads: [table_developer_applications, table_publishable_keys],
  writes: [],
  drives: [],
  invokes: READER_INVOKES,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_applications_keys_rotate = defineRpc({
  id: "applications.keys.rotate",
  title: "Make a successor key and keep the old one working for a grace window",
  about:
    "Row `applications.keys.rotate`, registered as the public mutation `applications/keys:rotate`. The writer guard; " +
    "`graceMs` must be a non-negative safe integer (INVALID_INPUT); the key must be the account's (else NOT_AUTHENTICATED, " +
    "an empty id INVALID_INPUT) and `active` (revoked: INVALID_INPUT `key is revoked`; grace or expired: WRONG_STATE). " +
    "With a grace window above zero the account needs room for one more live key (WRONG_STATE). The deployment must " +
    "declare itself as for create. The old key gets `gracePeriodEndsMs = now + graceMs`; the successor is minted for " +
    "the application with the application's current origins, not the old key's; `app_key_transitioned` (`rotated`, " +
    "naming the successor) is scheduled. Answers the successor raw, once, and the retired key's view.",
  was: [
    `${CONVEX}:9`,
    `${OPS}/rotate.ts:14`,
    `${OPS}/rotate.ts:18`,
    `${OPS}/rotate.ts:21`,
    `${OPS}/rotate.ts:24`,
    `${OPS}/rotate.ts:35`,
    `${OPS}/rotate.ts:38`,
    `${K}/rules.ts:54`,
    `${K}/rules.ts:60`,
    `${K}/errors.ts:8`,
    `${K}/errors.ts:22`,
    `${K}/errors.ts:29`,
    `${K}/writes.ts:77`,
    `${ROWS}:110`,
    ...GUARD_WAS,
    ...OWNED_WAS,
    ...DEPLOYMENT_WAS,
    ...EVENT_WAS,
  ],
  concept: concept_applications,
  kind: "mutation",
  who: "A signed-in person for their own Account, or a Member of the Organization who holds issue invoices now.",
  input: Schema.Struct({ actor: Actor, keyId: Schema.String, graceMs: Schema.Number }),
  output: Schema.Struct({ active: CreatedKey, retired: Key }),
  errors: [...ROW_ERRORS, error_WRONG_STATE],
  reads: [table_developer_applications, table_publishable_keys, table_publishable_key_origins],
  writes: [table_publishable_keys, table_publishable_key_origins],
  drives: [machine_publishable_key.t.to_grace],
  invokes: WRITER_INVOKES,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_applications_keys_revoke = defineRpc({
  id: "applications.keys.revoke",
  title: "Stop a key resolving",
  about:
    "Row `applications.keys.revoke`, registered as the public mutation `applications/keys:revoke`. The writer guard and " +
    "the owned-key check (a missing or foreign key is NOT_AUTHENTICATED). Any key that is not yet revoked, whatever its " +
    "state, gets `revokedAt` and loses its origin index rows, and `app_key_transitioned` (`revoked`) is scheduled. A " +
    "revoked key is answered unchanged and reports nothing. Answers the key view.",
  was: [`${CONVEX}:7`, `${OPS}/revoke.ts:12`, `${OPS}/revoke.ts:18`, `${OPS}/revoke.ts:20`, `${K}/writes.ts:84`, `${A}/writes.ts:109`, `${ROWS}:117`, ...GUARD_WAS, ...OWNED_WAS, ...EVENT_WAS],
  concept: concept_applications,
  kind: "mutation",
  who: "A signed-in person for their own Account, or a Member of the Organization who holds issue invoices now.",
  input: Schema.Struct({ actor: Actor, keyId: Schema.String }),
  output: Key,
  errors: ROW_ERRORS,
  reads: [table_developer_applications, table_publishable_keys, table_publishable_key_origins],
  writes: [table_publishable_keys, table_publishable_key_origins],
  drives: [machine_publishable_key.t.to_revoked],
  invokes: WRITER_INVOKES,
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── internal ───────────────────────────────────────────────────────────────────────────────

export const rpc_applications_keys_revoke_by_id = defineRpc({
  id: "applications.keys.revoke-by-id",
  title: "Revoke one key by id, whoever owns it",
  about:
    "The internal mutation `applications/keys:revokeById`, for a key whose raw value nobody holds. An unknown id answers " +
    "`found: false` and changes nothing; a revoked key is answered `alreadyRevoked: true` (with `revoked: true`); any " +
    "other key is revoked and its origin index rows deleted. It schedules no `app_key_transitioned` and checks no owner.",
  was: [`${CONVEX}:8`, `${OPS}/revoke-by-id.ts:15`, `${OPS}/revoke-by-id.ts:22`, `${K}/writes.ts:84`],
  concept: concept_applications,
  kind: "mutation",
  who: "internal: an operator with `convex run` (README.md:134).",
  input: Schema.Struct({ keyId: Schema.String }),
  output: Schema.Struct({
    keyId: Schema.String,
    found: Schema.Boolean,
    applicationId: Schema.optionalKey(Schema.String),
    revoked: Schema.Boolean,
    alreadyRevoked: Schema.Boolean,
  }),
  errors: [error_UNKNOWN],
  reads: [table_publishable_keys, table_publishable_key_origins],
  writes: [table_publishable_keys, table_publishable_key_origins],
  drives: [machine_publishable_key.t.to_revoked],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_applications_keys_issue = defineRpc({
  id: "applications.keys.issue",
  title: "Issue a key for an unowned application",
  about:
    "The internal mutation `applications/keys:issue` (quickstart, devnet, host proof). The application id must name " +
    "exactly one stored row (WRONG_STATE `application-missing` or `application-ambiguous`) that is not archived " +
    "(WRONG_STATE `application-archived`). It does not check that the application is unowned. A fixed `publishableKey` " +
    "already stored for the same application and environment and not revoked is returned as it is, its origins indexed " +
    "again; one naming another application or revoked refuses INVALID_INPUT; an empty one INVALID_INPUT. Otherwise a key " +
    "is inserted with the given metadata, not the application's. Returns the key id and the raw key. No event.",
  was: [`${CONVEX}:5`, `${OPS}/issue.ts:17`, `${OPS}/issue.ts:31`, `${K}/errors.ts:33`, `${K}/errors.ts:40`, `${A}/writes.ts:46`, `${A}/writes.ts:51`, `${A}/errors.ts:30`],
  concept: concept_applications,
  kind: "mutation",
  who:
    "internal: run by applications.quickstarts.mint (`issueTestKey`, quickstarts/writes.ts:57), operator.fixtures.seed " +
    "(`issueDevnetKey`, operator/fixtures/writes.ts:150) and operator scripts with `convex run`.",
  input: Schema.Struct({
    applicationId: Schema.String,
    environment: Schema.Literals(["test", "live"]),
    allowedOrigins: Schema.Array(Schema.String),
    authBaseUrl: Schema.String,
    convexUrl: Schema.String,
    siteBaseUrl: Schema.String,
    openfortPublishableKey: Schema.String,
    shieldPublishableKey: Schema.String,
    publishableKey: Schema.optionalKey(Schema.String),
  }),
  output: Schema.Struct({ keyId: Schema.String, publishableKey: Schema.String }),
  errors: [error_WRONG_STATE, error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_developer_applications, table_publishable_keys, table_publishable_key_origins],
  writes: [table_publishable_keys, table_publishable_key_origins],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_applications_keys_trusts_origin = defineRpc({
  id: "applications.keys.trusts-origin",
  title: "Whether an active test key lists a browser origin",
  about:
    "The internal query `applications/keys:trustsOrigin`, sign-in's question for an origin its fixed list does not " +
    "name. An origin that does not parse answers false. Walks the origin index newest first and answers true at the " +
    "first key that is `test`, still resolves (active or grace), lists the origin, and is served over https or on " +
    "loopback. A `live` key never makes sign-in trust its origins (CAP-985).",
  was: [`${CONVEX}:10`, `${OPS}/trusts-origin.ts:16`, `${K}/rules.ts:71`, `${A}/reads.ts:82`, `${BACKEND}/src/access/sessions/external/auth.ts:63`],
  concept: concept_applications,
  kind: "query",
  who: "internal: Access's BetterAuth trusted-origins callback (access/sessions/external/auth.ts:63), on every auth request from an untrusted origin.",
  input: Schema.Struct({ origin: Schema.String }),
  output: Schema.Boolean,
  errors: [error_UNKNOWN],
  reads: [table_publishable_key_origins, table_publishable_keys],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_applications_keys_emit_transitioned = defineRpc({
  id: "applications.keys.emit-transitioned",
  title: "Post one committed key change as app_key_transitioned",
  about:
    "Telemetry plumbing: the internal action `applications/keys:emitTransitioned`, scheduled by keyTransitioned " +
    "(`scheduleTelemetryEmit`) from the create, rotate or revoke transaction, so a delivery failure never rolls back or " +
    "repeats the write. Attributes the event to the person who made the change and, for an Organization's key, the " +
    "Organization (taken from the scheduled args, not re-read), annotates the wide event with the key id and " +
    "transition, and posts `app_key_transitioned` (`key_id`, `application_id`, `transition`, `owner_kind`, " +
    "`organization_id`, `occurred_at`) to PostHog, awaited. Only ids and kinds travel: never the key, its name or its " +
    "origins. Reads and writes no table.",
  was: [`${CONVEX}:4`, `${OPS}/emit-transitioned.ts:10`, `${K}/events.ts:40`, `${K}/events.ts:87`, `${K}/events.ts:120`],
  concept: concept_applications,
  kind: "action",
  who: "internal: scheduled by applications.keys.create, rotate and revoke in the transaction that wrote the key.",
  input: Schema.Struct({
    transition: Schema.Literals(["created", "rotated", "revoked"]),
    keyId: Schema.String,
    applicationId: Schema.String,
    authUserId: Schema.String,
    organizationId: Schema.optionalKey(Schema.String),
    occurredAt: Schema.Number,
    /** `observationContextValidator`: the client's observation hint. */
    observationContext: Schema.optionalKey(Schema.Unknown),
  }),
  output: Schema.Void,
  errors: [error_UNKNOWN],
  reads: [],
  writes: [],
  drives: [],
  invokes: [],
  emits: [event_app_key_transitioned],
  calls: [],
  chain: [],
  spans: [],
});
