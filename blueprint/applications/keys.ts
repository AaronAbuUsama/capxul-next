// Applications' keys area: an owner's publishable keys, made, listed, rotated and revoked. The owner is
// the caller's own account (`{ kind: "person" }`) or an Organization (`{ kind: "organization", orgId }`,
// `--org`). Reading an Organization's keys needs a current Seat there; changing them needs that Seat's
// Safe to wear the Organization's Invoicing hat now, named by its deployment (organizations) and worn
// on chain (indexing's hat wearers). Nothing here is signed and no money moves. The old `registrations`
// area has no rpc of its own: an application is made or updated by the key create that names it
// (decision applications.registrations-in-keys).

import { Schema } from "effect";
import { budget, defineRpc } from "../../packages/blueprint-engine/src/index.ts";
import { concept_applications } from "../shared/foundation.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import { KeyEnvironment, KeyState, machine_app_key, table_applications, table_publishable_keys } from "./data.ts";

const OLD = "packages/backend/src/applications/keys";
const ASIS = "docs/as-is/archive/applications/keys.ts";
const PROTOCOL = "packages/protocol/src/applications/operations.ts";

const S = Schema.String;
const N = Schema.Number;
const Null = Schema.NullOr;

// ── wire shapes ─────────────────────────────────────────────────────────────────────────────

/** Whose keys: the caller's own, or an Organization's (`--org`). */
export const Owner = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("person") }),
  Schema.Struct({ kind: Schema.Literal("organization"), orgId: S }),
]);

/** A key as its owner sees it: never the raw key or its hash. */
export const Key = Schema.Struct({
  id: S,
  applicationId: S,
  /** The application's name. */
  app: S,
  prefix: S,
  hint: S,
  environment: KeyEnvironment,
  /** The application's origins now: every key of an application works from the same ones. */
  origins: Schema.Array(S),
  state: KeyState,
  createdAt: N,
  graceEndsAt: Null(N),
  revokedAt: Null(N),
  lastUsedAt: Null(N),
});

/** A key just made: the only time the raw key leaves the backend. */
export const CreatedKey = Schema.Struct({ key: Key, publishableKey: S });

// ── who may call ────────────────────────────────────────────────────────────────────────────

/** The owner's tables a key rpc reads, and the Seat a reader of an Organization's keys must hold. */
const READER = [table_applications, table_publishable_keys, table_org_members] as const;
/** A writer of an Organization's keys also wears its Invoicing hat now. */
const WRITER = [...READER, table_org_deployments, table_hat_wearers] as const;

const WHO_READ =
  "A signed-in person (or an agent), for their own keys; for an Organization, any member (a current Seat). Anyone else " +
  "naming that Organization is ROLE_PERMISSION_DENIED.";
const WHO_WRITE =
  "A signed-in person (or an agent), for their own keys; for an Organization, a member whose Safe wears its Invoicing " +
  "hat now. Any other member, or an outsider, is ROLE_PERMISSION_DENIED.";

const GUARD_WAS = [`${OLD}/guards.ts:23`, `${OLD}/guards.ts:37`, "packages/backend/src/organizations/members/reads/permissions.ts:67"];
/** A key named by id must be the owner's: missing, someone else's and a quickstart key all refuse alike. */
const OWNED_WAS = [`${OLD}/guards.ts:51`, `${OLD}/rules.ts:24`];

// ── reads ───────────────────────────────────────────────────────────────────────────────────

export const rpc_applications_keys_list = defineRpc({
  id: "applications.keys.list",
  title: "The owner's publishable keys, newest first",
  about:
    "One page of the owner's keys, revoked and expired ones included, newest first by `publishable-keys-by-created` " +
    "(ties broken by key id, so keys made in one millisecond keep their order), each joined to its application for its " +
    "name and origins. `limit` is 1 to 100 (25 when absent); `after` is the opaque cursor the last page returned, bound " +
    "to this owner: one from another owner, or forged, is INVALID_INPUT. A key's `state` is its stored status, except " +
    "that a grace key past `grace_ends_at` reads as expired before its process records it. Never the raw key, never " +
    "its hash. Replaces the old one-page read that sorted every key in memory.",
  concept: concept_applications,
  kind: "query",
  who: WHO_READ,
  input: Schema.Struct({ owner: Owner, limit: Schema.optionalKey(Schema.Int), after: Schema.optionalKey(S) }),
  output: Schema.Struct({ items: Schema.Array(Key), next: Null(S) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [table_applications, table_publishable_keys, table_org_members],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
  was: [`${ASIS}:153`, `${OLD}/operations/list.ts:12`, `${OLD}/reads.ts:43`, `${PROTOCOL}:100`, ...GUARD_WAS],
});

// ── writes ──────────────────────────────────────────────────────────────────────────────────

export const rpc_applications_keys_create = defineRpc({
  id: "applications.keys.create",
  title: "Make a publishable key, and the application it names if new",
  about:
    "The application is `app` (default `default`), trimmed to 1 to 64 characters; each given origin must be an http(s) " +
    "origin with no wildcard host, kept as `protocol//host[:port]`; an empty list, a wildcard or a bad name is " +
    "INVALID_INPUT. The owner may hold at most 20 keys that still resolve (active or grace): the 21st is WRONG_STATE, " +
    "and revoking one makes room. In one transaction it makes the application if the owner has none of that name " +
    "(origins as given, else `http://localhost:3000`) or replaces its origins when some are given, then mints a key " +
    "(`test` on devnet and staging, `live` on production) with 160 random bits, storing only its hash, prefix and last " +
    "four characters, and drives `create`. An Organization's key and application are the Organization's, never the " +
    "member's who made them. Answers the key and the raw key, this once.",
  concept: concept_applications,
  kind: "mutation",
  who: WHO_WRITE,
  input: Schema.Struct({
    owner: Owner,
    app: Schema.optionalKey(S),
    origins: Schema.optionalKey(Schema.Array(S)),
  }),
  output: CreatedKey,
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [...WRITER],
  writes: [table_applications, table_publishable_keys],
  drives: [machine_app_key.t.create],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${ASIS}:99`, `${OLD}/operations/create.ts:16`, `${OLD}/rules.ts:45`, `${OLD}/writes.ts:24`, `${PROTOCOL}:89`, ...GUARD_WAS],
});

export const rpc_applications_keys_rotate = defineRpc({
  id: "applications.keys.rotate",
  title: "Make a successor key; the old one works on for its grace window",
  about:
    "`graceMs` is 0 to 30 days; a negative one is INVALID_INPUT. The key, named by id, must be the owner's: a missing " +
    "one, someone else's and a quickstart key all refuse NOT_AUTHENTICATED and change nothing. A revoked key is " +
    "INVALID_INPUT; one already in its grace window, or expired, is WRONG_STATE, so one key cannot multiply. With a " +
    "window above zero the owner needs room for one more key that still resolves (WRONG_STATE at the limit); with 0 the " +
    "old key stops now, so the count does not grow. In one transaction it mints the successor for the same application " +
    "and environment (`create`), and drives the old key's `rotate` (`grace_ends_at` now plus the window) or, with 0, " +
    "`retire`, naming its successor. The old key's grace process (applications.keys.grace) starts from `rotate`. " +
    "Answers the successor with its raw key, once, and the retired key.",
  concept: concept_applications,
  kind: "mutation",
  who: WHO_WRITE,
  input: Schema.Struct({ owner: Owner, keyId: S, graceMs: Schema.Int }),
  output: Schema.Struct({ active: CreatedKey, retired: Key }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE],
  reads: [...WRITER],
  writes: [table_publishable_keys],
  drives: [machine_app_key.t.create, machine_app_key.t.rotate, machine_app_key.t.retire],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${ASIS}:179`, `${OLD}/operations/rotate.ts:14`, `${OLD}/rules.ts:54`, `${OLD}/rules.ts:60`, `${OLD}/writes.ts:77`, `${PROTOCOL}:110`, ...GUARD_WAS, ...OWNED_WAS],
});

export const rpc_applications_keys_revoke = defineRpc({
  id: "applications.keys.revoke",
  title: "Stop a key resolving, for good",
  about:
    "The key, named by id, must be the owner's: a missing one, someone else's and a quickstart key all refuse " +
    "NOT_AUTHENTICATED, as if no one were signed in, so a refusal confirms nothing and the key stays live. Any key not " +
    "yet revoked (active, grace or expired) is revoked (`revoke`, `revoked_at` now); one already revoked is answered as " +
    "it is and nothing is written or sent. A key in its grace window ends its grace process, which this rpc signals. " +
    "Apps using it stop at their next bootstrap: the origin token an app holds lasts at most five minutes. Answers the " +
    "key's id and state.",
  concept: concept_applications,
  kind: "mutation",
  who: WHO_WRITE,
  input: Schema.Struct({ owner: Owner, keyId: S }),
  output: Schema.Struct({ id: S, state: Schema.Literal("revoked") }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [...WRITER],
  writes: [table_publishable_keys],
  drives: [machine_app_key.t.revoke],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
  was: [`${ASIS}:226`, `${OLD}/operations/revoke.ts:12`, `${OLD}/writes.ts:84`, `${PROTOCOL}:117`, ...GUARD_WAS, ...OWNED_WAS],
});
