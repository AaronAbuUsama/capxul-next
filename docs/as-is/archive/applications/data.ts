// The old applications concept's tables and the lifecycles that live on them, as the old code has
// them (factory, branch integration/factory). Evidence, not the target design.
//
// Tables: packages/backend/src/applications/tables.ts, composed into the one schema at
// packages/backend/convex/schema.ts:53. Neither `developerApplications` nor `publishableKeys` has a
// status column: a key's state (active, grace, expired, revoked) is derived by `keyState`
// (keys/rules.ts:35) from `revokedAt` and `gracePeriodEndsMs`, and an application is archived when
// `archivedAt` is set. Both derived lifecycles are booked as machines whose `field` names the
// columns they are derived from. Transitions are named to_<state>; a birth (an insert) has no source
// state and is said in `about`.

import { Schema } from "effect";
import { defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_applications } from "../shared/foundation.ts";
import { event_app_key_transitioned } from "../shared/vocabulary.ts";

const B = "packages/backend/src/applications";

const opt = Schema.optionalKey;
const S = Schema.String;
const N = Schema.Number;

/** The bootstrap metadata every application and key row stores (`BootstrapMetadata`, model.ts:20). */
const BootstrapMetadata = {
  allowedOrigins: Schema.Array(S),
  authBaseUrl: S,
  convexUrl: S,
  siteBaseUrl: S,
  openfortPublishableKey: S,
  shieldPublishableKey: S,
};

// ── tables ──────────────────────────────────────────────────────────────────────────────────

export const table_developer_applications = defineTable({
  id: "developer-applications",
  title: "Developer applications: every application a key bootstraps through",
  about:
    "One store for every registered application. A person's own carries `ownerAuthUserId`; an Organization's carries " +
    "`ownerOrgId` and no `ownerAuthUserId` (keys/writes.ts:44), so it outlives the Member who made it, although the field " +
    "comment (tables.ts:11) says `ownerAuthUserId` is then that Member. A quickstart, the devnet seed, a host proof and the staging native client register " +
    "with no owner at all, and the operator's tenancy probe inserts a synthetic row of its own with an `ownerAuthUserId` " +
    "(operator/probes/writes.ts:15). A developer's own application made by `applications.registrations.create` carries " +
    "placeholder routing (`https://auth.capxul.local`, `pk_test_platform`, registrations/writes.ts:16); one made by a key " +
    "create carries this deployment's routing. `applicationId` is `app_` plus a ULID-shaped tail, but nothing makes it " +
    "unique: the repairs and `keys.issue` read every row with an id and refuse more than one. Tenancy is mixed: a person, " +
    "an Organization, or no owner; the book records `owner`. Rows are never deleted; the repairs archive.",
  was: [`${B}/tables.ts:8`, `${B}/model.ts:12`, `${B}/README.md:12`, "packages/backend/convex/schema.ts:53"],
  concept: concept_applications,
  tenancy: "owner",
  scope:
    "`ownerAuthUserId` (a person) or `ownerOrgId` (an Organization); an unowned row (quickstart, devnet, proof, native client) belongs to no tenant.",
  fields: Schema.Struct({
    applicationId: S,
    ownerAuthUserId: opt(S),
    ownerOrgId: opt(S),
    name: S,
    ...BootstrapMetadata,
    createdAt: N,
    updatedAt: N,
    archivedAt: opt(N),
  }),
  key: ["applicationId"],
  indexes: [
    {
      name: "by_application_id",
      fields: ["applicationId"],
      for: "One application by id: findRegistration, registrationsWithId, the observation hint, the staging native client, the repairs' pinned identity and the tenancy probe (reads.ts:44, :53, :175, :197; repairs/reads.ts:24; operator/probes/reads.ts:14).",
    },
    {
      name: "by_name",
      fields: ["name"],
      for: "Every application with a name: the unowned registration's idempotency, the proof recovery and the local native client (reads.ts:61, :213).",
      crossTenant: true,
    },
    {
      name: "by_owner_name",
      fields: ["ownerAuthUserId", "name"],
      for: "A person's applications, or one by name: registrations list and create, a person's keys, and the operator purge's owned-application check (registrations/reads.ts:8, :21; keys/reads.ts:35; reads.ts:160).",
    },
    {
      name: "by_org_name",
      fields: ["ownerOrgId", "name"],
      for: "An Organization's applications, for its keys (keys/reads.ts:30). Only the `ownerOrgId` prefix is ever queried.",
    },
  ],
  retention: "Kept indefinitely: nothing deletes an application; retireProof and recoverProof only archive.",
});

export const table_publishable_keys = defineTable({
  id: "publishable-keys",
  title: "Publishable keys: an application's bootstrap credentials",
  about:
    "One row per publishable key. It keeps the key's `sha256:` lookup hash, its prefix (`cap_pk_test_` or `cap_pk_live_`) " +
    "and its last four characters (`hint`), never the key: the raw key leaves the backend once, in the create, rotate, " +
    "issue or quickstart answer. Each key copies its application's bootstrap metadata at mint time, so a later change " +
    "to the application's origins does not reach an existing key (the repairs patch both). The state is derived, not " +
    "stored (machine publishable-key). The bootstrap rate window (`bootstrapWindowStartMs`, `bootstrapCount`) and the " +
    "last-use stamp (`lastResolvedAt`, `lastResolvedOrigin`, written at most once a minute) live on the key row, so " +
    "every bootstrap is a write to it. Owned through its application: no tenant column.",
  was: [`${B}/tables.ts:28`, `${B}/model.ts:15`, `${B}/writes.ts:46`, `${B}/bootstraps/writes.ts:22`],
  concept: concept_applications,
  tenancy: "owner",
  scope: "Through `applicationId` → developerApplications' `ownerAuthUserId` or `ownerOrgId`.",
  fields: Schema.Struct({
    keyId: S,
    applicationId: S,
    environment: Schema.Literals(["test", "live"]),
    prefix: S,
    hint: opt(S),
    lookupHash: S,
    ...BootstrapMetadata,
    createdAt: N,
    updatedAt: N,
    revokedAt: opt(N),
    gracePeriodEndsMs: opt(N),
    lastResolvedAt: opt(N),
    lastResolvedOrigin: opt(S),
    bootstrapWindowStartMs: opt(N),
    bootstrapCount: opt(N),
  }),
  key: ["keyId"],
  indexes: [
    {
      name: "by_key_id",
      fields: ["keyId"],
      for: "One key by id: the owner guard, revokeById, the bootstrap use stamp, the origin index walk, the staging native client and the repairs (reads.ts:69, :89, :201; repairs/reads.ts:30).",
    },
    {
      name: "by_lookup_hash",
      fields: ["lookupHash"],
      for: "The key a raw value names: bootstrap admission, a fixed key value at issue, extendOrigins, retireProof and the pinned native key (reads.ts:98; repairs/reads.ts:34).",
      crossTenant: true,
    },
    {
      name: "by_application_environment",
      fields: ["applicationId", "environment"],
      for: "An application's keys, of one environment or (prefix) all: the 20-key limit, key lists, the proof repairs and the local native client (reads.ts:106, :218; keys/reads.ts:49).",
    },
  ],
  retention: "Kept indefinitely: a revoked or expired key stays; nothing deletes key rows.",
});

export const table_publishable_key_origins = defineTable({
  id: "publishable-key-origins",
  title: "Publishable key origins: which key lists which origin",
  about:
    "One row per origin a key lists, normalized to `protocol//host`, so sign-in can ask \"does an active test key list " +
    "this origin?\" by index (applications.keys.trusts-origin). Written by insertKey and the repairs' patchKey " +
    "(recordKeyOrigins, writes.ts:90); a revoke deletes the key's rows (dropKeyOrigins, writes.ts:109). The table " +
    "comment says a row outlives its key's revocation, but both revoke paths delete them; the read checks the key itself " +
    "anyway. An origin dropped from a key by a repair is not removed from the index: patchKey only adds.",
  was: [`${B}/tables.ts:55`, `${B}/writes.ts:90`, `${B}/writes.ts:109`, `${B}/repairs/writes.ts:34`],
  concept: concept_applications,
  tenancy: "owner",
  scope: "Through `keyId` → publishableKeys → developerApplications' owner.",
  fields: Schema.Struct({ origin: S, keyId: S }),
  key: ["keyId", "origin"],
  indexes: [
    {
      name: "by_origin",
      fields: ["origin"],
      for: "Every key listing a browser origin, newest first, until one an accepting rule takes: sign-in's trusted-origin check (reads.ts:82).",
      crossTenant: true,
    },
    {
      name: "by_key_origin",
      fields: ["keyId", "origin"],
      for: "One key's row for an origin (insert once) and all of a key's rows (delete on revoke) (writes.ts:96, :112).",
    },
  ],
  retention: "Deleted with its key's revocation; otherwise kept.",
});

export const table_quickstart_mint_rate_limits = defineTable({
  id: "quickstart-mint-rate-limits",
  title: "Quickstart mint rate limits: one fixed window per client IP",
  about:
    "The abuse cap of the public, unauthenticated `POST /v1/client/mint-quickstart-key`: one row per client IP (the " +
    "client-most `x-forwarded-for` entry, or `unknown` for every caller without one), with the window's start and its " +
    "count; 15 mints an hour (quickstarts/rules.ts:11). A spent window is overwritten in place by the next mint; nothing " +
    "deletes a row, so the table holds one row per IP that ever minted.",
  was: [`${B}/tables.ts:64`, `${B}/quickstarts/writes.ts:17`, `${B}/quickstarts/rules.ts:45`],
  concept: concept_applications,
  tenancy: "global",
  scope: "Keyed by client IP; no person or Organization.",
  fields: Schema.Struct({ ip: S, windowStartMs: N, count: N }),
  key: ["ip"],
  indexes: [
    {
      name: "by_ip",
      fields: ["ip"],
      for: "The IP's quota window, read and written by applications.quickstarts.claim (quickstarts/reads.ts:7).",
    },
  ],
  retention: "Kept indefinitely: one row per IP that ever minted, reused when its window has passed.",
});

// ── machines ────────────────────────────────────────────────────────────────────────────────

export const machine_publishable_key = defineMachine({
  id: "publishable-key",
  title: "Publishable key state (derived)",
  about:
    "No column holds it: `keyState` (keys/rules.ts:35) derives it from `revokedAt` and `gracePeriodEndsMs` at read time, " +
    "and the key view puts it on the wire (`Key.state`). A key is born `active` by insertKey (writes.ts:46) from " +
    "keys.create, keys.issue, quickstarts.mint, the devnet seed and ensureNativeClient. `expired` is reached by the " +
    "clock, never by a write. Bootstrap admission (`keyActiveAt`, rules.ts:93) resolves a key while `now <= " +
    "gracePeriodEndsMs`; the native client check (reads.ts:250) wants `gracePeriodEndsMs > now`, so the two disagree for " +
    "one millisecond. A rotation with `graceMs: 0` sets `gracePeriodEndsMs` to now, so the retired key is `grace` for " +
    "that millisecond and `expired` after. Nothing returns a key to `active`.",
  was: [`${B}/keys/rules.ts:35`, `${B}/rules.ts:93`, "packages/protocol/src/applications/operations.ts:53", `${B}/writes.ts:46`],
  table: table_publishable_keys,
  field: "revokedAt, gracePeriodEndsMs (derived by keyState)",
  initial: "active",
  states: [
    { id: "active", about: "Not revoked and no grace window: it resolves bootstraps and can be rotated." },
    { id: "grace", about: "Rotated: it keeps resolving beside its successor until `gracePeriodEndsMs`." },
    { id: "expired", about: "Its grace window has passed: it no longer resolves (bootstrap answers `expired`)." },
    { id: "revoked", about: "`revokedAt` is set: it never resolves again, and its origin index rows are gone.", terminal: true },
  ],
  transitions: {
    to_grace: {
      from: ["active"],
      to: "grace",
      about:
        "applications.keys.rotate's beginGrace (keys/writes.ts:77) stamps `gracePeriodEndsMs = now + graceMs`, then mints the successor. Its `app_key_transitioned` (`rotated`) names the successor key, not this one (rotate.ts:38).",
      guard: "requireRotatable (keys/rules.ts:60): a revoked key refuses INVALID_INPUT, a grace or expired one WRONG_STATE.",
      emits: [event_app_key_transitioned],
    },
    to_expired: {
      from: ["grace"],
      to: "expired",
      about: "No write: the clock passes `gracePeriodEndsMs` (keys/rules.ts:41).",
      emits: [],
    },
    to_revoked: {
      from: ["active", "grace", "expired"],
      to: "revoked",
      about:
        "keys.revoke and revokeById (revokeKey, keys/writes.ts:84); the proof repairs (patchKey with `revokedAt`, repairs/writes.ts:34). Only the public revoke schedules `app_key_transitioned` (`revoked`), and only for a key not already revoked (revoke.ts:20).",
      guard: "An already revoked key is returned unchanged (keys/writes.ts:86); a repair revokes only a test key of a proof application with no other live key.",
      emits: [event_app_key_transitioned],
    },
  },
});

export const machine_developer_application = defineMachine({
  id: "developer-application",
  title: "Developer application archive (derived)",
  about:
    "No status column: an application is archived when `archivedAt` is set. Born active by registrations.create, " +
    "registrations.register, a key create's ensureApplication, ensureNativeClient and the tenancy probe. Only the " +
    "disposable host-proof repairs archive one, and nothing un-archives. An archived application is never reused by " +
    "register (registrations/rules.ts:16) and owns no keys in key reads (keys/rules.ts:28).",
  was: [`${B}/tables.ts:22`, `${B}/repairs/operations/retire-proof.ts:88`, `${B}/repairs/operations/recover-proof.ts:99`],
  table: table_developer_applications,
  field: "archivedAt (derived)",
  initial: "active",
  states: [
    { id: "active", about: "`archivedAt` unset: listed, reusable and able to hold keys." },
    { id: "archived", about: "`archivedAt` set by a proof repair, with the proof's origin removed.", terminal: true },
  ],
  transitions: {
    to_archived: {
      from: ["active"],
      to: "archived",
      about: "applications.repairs.retire-proof (retire-proof.ts:88) and recover-proof (recover-proof.ts:99), through patchRegistration (repairs/writes.ts:27).",
      guard: "Only a `Host observability proof ` application whose recorded key, name and origin match and that has no other live key.",
      emits: [],
    },
  },
});
