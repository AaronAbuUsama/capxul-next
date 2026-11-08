// Applications' data: the registered applications of a person or an Organization, their publishable
// keys, and the anonymous test keys `dev key` mints. One state machine, a publishable key's
// (active, grace, expired, revoked), with its one event, `app_key_transitioned` (P7).
//
// What is gone from the old concept (decisions in ./decisions.ts): the bootstrap metadata every
// application and key row copied (the envelope is built from the deployment's settings at bootstrap,
// applications.envelope-from-deployment), the per-key origin copies and the origin index
// (applications.origins-on-the-application), the per-key bootstrap counter
// (applications.no-bootstrap-counter), the per-IP window table (the mint counts its own rows,
// applications.quickstart-keys), the archive state only the repairs wrote (responsibilities.repairs),
// application consent (applications.no-consent) and the unowned registrations of the devnet seed,
// host proofs and the staging native client (applications.no-unowned-registrations).
//
// Times are epoch milliseconds, as organizations' are. Ids are `app_<ulid>` and `key_<ulid>`.

import { Schema } from "effect";
import { defineEvent, defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_applications } from "../shared/foundation.ts";

const OLD = "packages/backend/src/applications";
const ASIS = "books/as-is/applications/data.ts";

const S = Schema.String;
const N = Schema.Number;
const Null = Schema.NullOr;

/** Whose an application or key is. Each kind's id is the tenant column of that kind (P8). */
export const OwnerKind = Schema.Literals(["person", "organization"]);
/** `test` on devnet and staging; `live` only on a production deployment, which the target does not run yet. */
export const KeyEnvironment = Schema.Literals(["test", "live"]);
export const KeyState = Schema.Literals(["active", "grace", "expired", "revoked"]);

const OWNER_SCOPE =
  "The owner is `owner_kind` with `owner_id`: a person_id for a person's, an org_id for an Organization's. The generated " +
  "row-level security policy matches each kind to the session's person or Organization tenant.";
const KEPT = "Kept while its owner exists: nothing deletes one. A revoked or expired key stays, so `key list` shows it.";

// ── applications ────────────────────────────────────────────────────────────────────────────

export const table_applications = defineTable({
  id: "applications",
  title: "Registered applications: a person's or an Organization's web apps",
  about:
    "One row per application an owner registered: its name, unique per owner, and the web origins its keys work from. A " +
    "person's first `key create` makes the `default` one; `--app` names another. `--origin` replaces the origins; a new " +
    "application with none given gets `http://localhost:3000`. Every key of the application follows these origins at its " +
    "next bootstrap: a key copies nothing. An Organization's applications belong to it, not to the member who made them. " +
    "Replaces old `developerApplications`, which also held unowned rows, placeholder routing, vendor keys and an archive " +
    "stamp only the repairs wrote.",
  was: [`${ASIS}:35`, `${OLD}/tables.ts:8`, `${OLD}/keys/writes.ts:24`, `${OLD}/registrations/writes.ts:24`],
  concept: concept_applications,
  tenancy: "owner",
  tenantField: "owner_id",
  scope: OWNER_SCOPE,
  fields: Schema.Struct({
    owner_id: S,
    owner_kind: OwnerKind,
    application_id: S,
    /** Trimmed, 1 to 64 characters. */
    name: S,
    /** http(s) origins as `protocol//host[:port]`, no wildcard host, at least one. */
    origins: Schema.Array(S),
    created_at: N,
    updated_at: N,
  }),
  key: ["owner_id", "owner_kind", "application_id"],
  indexes: [
    {
      name: "applications-by-name",
      fields: ["owner_id", "owner_kind", "name"],
      unique: true,
      for: "`key create`: the owner's application of that name (default `default`), made once and reused by every later key.",
    },
  ],
  retention: KEPT,
});

// ── publishable keys ────────────────────────────────────────────────────────────────────────

export const table_publishable_keys = defineTable({
  id: "publishable-keys",
  title: "Publishable keys: the credentials an application bootstraps with",
  about:
    "One row per key an owner made. It keeps the SHA-256 of the raw key, its prefix (`cap_pk_test_` or `cap_pk_live_`) " +
    "and its last four characters, never the key: the raw key leaves the backend once, in the create or rotate answer. " +
    "`status` is the key's machine (app-key); `grace_ends_at` is set when a rotation gives it a grace window, and " +
    "`successor_key_id` names the key that replaced it. The bootstrap stamps `last_used_at` and `last_used_origin` at most " +
    "once a minute. The owner columns are the key's own, not reached through its application (P8). Replaces old " +
    "`publishableKeys`, which derived its state from timestamps and copied its application's metadata and origins.",
  was: [`${ASIS}:90`, `${OLD}/tables.ts:28`, `${OLD}/keys/rules.ts:35`, `${OLD}/bootstraps/writes.ts:22`],
  concept: concept_applications,
  tenancy: "owner",
  tenantField: "owner_id",
  scope: OWNER_SCOPE,
  fields: Schema.Struct({
    owner_id: S,
    owner_kind: OwnerKind,
    key_id: S,
    application_id: S,
    environment: KeyEnvironment,
    prefix: S,
    /** The raw key's last four characters, as `key list` shows them. */
    hint: S,
    /** `sha256:` and the hex digest of the raw key; the key has 160 random bits, so no salt is needed. */
    lookup_hash: S,
    status: KeyState,
    grace_ends_at: Null(N),
    successor_key_id: Null(S),
    revoked_at: Null(N),
    last_used_at: Null(N),
    last_used_origin: Null(S),
    created_at: N,
    updated_at: N,
  }),
  key: ["owner_id", "owner_kind", "key_id"],
  indexes: [
    {
      name: "publishable-keys-by-hash",
      fields: ["lookup_hash"],
      unique: true,
      crossTenant: true,
      for: "The bootstrap finds the key a raw value names before anyone is known (applications.bootstraps.resolve).",
    },
    {
      name: "publishable-keys-by-created",
      fields: ["owner_id", "owner_kind", "created_at", "key_id"],
      for: "`key list`: the owner's keys newest first, ties broken by the key id (a ULID), so one millisecond never reorders them.",
    },
    {
      name: "publishable-keys-by-status",
      fields: ["owner_id", "owner_kind", "status"],
      for: "`key create` and `key rotate` count the owner's keys that still resolve (active or grace) against the limit of 20.",
    },
  ],
  retention: KEPT,
});

// ── quickstart keys ─────────────────────────────────────────────────────────────────────────

export const table_quickstart_keys = defineTable({
  id: "quickstart-keys",
  title: "Quickstart keys: anonymous test keys for an app on a developer's machine",
  about:
    "One row per key `dev key` minted, with no sign-in, on a devnet or staging. Each lists one loopback origin and belongs " +
    "to nobody, so no one can list, rotate or revoke it. It keeps the key's hash, prefix and last four characters and " +
    "`minted_by`, a keyed hash of the caller's network address (never the address), which the mint counts: 15 in the last " +
    "hour per address. Replaces the old unowned `Quickstart <origin>` applications, their keys and the per-IP window " +
    "table, which kept one row per address that ever minted.",
  was: [`${ASIS}:175`, `${OLD}/quickstarts/writes.ts:44`, `${OLD}/quickstarts/rules.ts:11`, `${OLD}/tables.ts:64`],
  concept: concept_applications,
  tenancy: "global",
  scope: "Written only by the system, for no person or Organization: the mint is unauthenticated.",
  fields: Schema.Struct({
    key_id: S,
    prefix: S,
    hint: S,
    lookup_hash: S,
    /** The one origin the key works from: an http(s) origin on localhost, *.localhost, 127.0.0.1 or [::1]. */
    origin: S,
    /** HMAC-SHA-256 of the caller's address under the deployment's record key. */
    minted_by: S,
    created_at: N,
  }),
  key: ["key_id"],
  indexes: [
    {
      name: "quickstart-keys-by-hash",
      fields: ["lookup_hash"],
      unique: true,
      for: "The bootstrap finds a quickstart key a raw value names, when no owned key has that hash.",
    },
    {
      name: "quickstart-keys-by-minter",
      fields: ["minted_by", "created_at"],
      for: "The mint's quota: how many keys this address minted in the last hour, and when the oldest of them leaves it.",
    },
  ],
  retention: "Kept indefinitely: a developer's local app keeps working with its key.",
});

// ── a publishable key's life ────────────────────────────────────────────────────────────────

export const event_app_key_transitioned = defineEvent({
  id: "app_key_transitioned",
  about:
    "A publishable key was made, rotated (its grace window began, or it stopped at once with `--grace 0`), reached the " +
    "end of its grace window, or was revoked. Carries the key, its application and whose it is; never the key, its hash, " +
    "the application's name or its origins. The name is the old event's, so the funnel keeps its history.",
  props: Schema.Struct({
    from: Null(KeyState),
    to: KeyState,
    transition: Schema.Literals(["create", "rotate", "retire", "expire", "revoke"]),
    key_id: S,
    application_id: S,
    owner_kind: OwnerKind,
    owner_id: S,
  }),
  was: [`${OLD}/keys/events.ts:60`, `${OLD}/keys/operations/emit-transitioned.ts:10`],
});

export const machine_app_key = defineMachine({
  id: "app-key",
  title: "A publishable key: active, in its grace window, expired or revoked",
  about:
    "publishable-keys.status. Born active by `key create` or as a rotation's successor. A rotation with a grace window " +
    "moves the old key to grace, and its own process (applications.keys.grace) moves it to expired when the window ends; " +
    "`--grace 0` moves it to expired at once. A revoke ends any state but revoked. Nothing returns a key to active. The " +
    "bootstrap admits an active key, and a grace key while `grace_ends_at` is still ahead, so a late timer never extends " +
    "a window. Replaces old `keyState`, derived at read time from `revokedAt` and `gracePeriodEndsMs`.",
  table: table_publishable_keys,
  field: "status",
  initial: "active",
  states: [
    { id: "active", about: "Resolves bootstraps; can be rotated or revoked." },
    { id: "grace", about: "Rotated: resolves beside its successor until `grace_ends_at`." },
    { id: "expired", about: "Its grace window has ended, or it was rotated with no window: it resolves nothing." },
    { id: "revoked", about: "Revoked by its owner: it resolves nothing, ever again.", terminal: true },
  ],
  transitions: {
    create: {
      from: [],
      to: "active",
      about: "The birth: `key create` (applications.keys.create), or the successor a rotation mints (applications.keys.rotate).",
      guard: "once its transaction commits, the owner holds at most 20 keys that still resolve (active or grace)",
      emits: [event_app_key_transitioned],
    },
    rotate: {
      from: ["active"],
      to: "grace",
      about: "`key rotate` with a grace window above zero: `grace_ends_at` is now plus the window, at most 30 days.",
      guard: "the owner has room for one more key that still resolves",
      emits: [event_app_key_transitioned],
    },
    retire: {
      from: ["active"],
      to: "expired",
      about: "`key rotate --grace 0`: the old key stops now and its successor takes over.",
      emits: [event_app_key_transitioned],
    },
    expire: {
      from: ["grace"],
      to: "expired",
      about: "The key's grace process, when its window ends (applications.keys.grace).",
      guard: "now is at or past grace_ends_at",
      emits: [event_app_key_transitioned],
    },
    revoke: {
      from: ["active", "grace", "expired"],
      to: "revoked",
      about: "`key revoke` (applications.keys.revoke). Revoking a revoked key changes nothing and sends nothing.",
      emits: [event_app_key_transitioned],
    },
  },
  was: [`${ASIS}:201`, `${OLD}/keys/rules.ts:35`, `${OLD}/keys/writes.ts:77`, `${OLD}/keys/writes.ts:84`],
});
