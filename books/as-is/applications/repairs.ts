// The as-is book of the old applications concept: the repairs area.
//
// Every operation registered at `applications/repairs:*` (packages/backend/convex/applications/
// repairs.ts:1): operator-only internal mutations run with `convex run`, by hand or from
// packages/backend/scripts/. None is scheduled, so every one is an rpc. The disposable-proof repairs
// answer a mismatch as an outcome (`updated: false` and a reason), not an error.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_applications } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_UNKNOWN } from "../shared/vocabulary.ts";
import {
  machine_developer_application,
  machine_publishable_key,
  table_developer_applications,
  table_publishable_key_origins,
  table_publishable_keys,
} from "./data.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/applications/repairs.ts`;
const A = `${BACKEND}/src/applications`;
const RP = `${A}/repairs`;
const OPS = `${RP}/operations`;

const WHO = "internal: an operator with `convex run` (README.md:101); no session, no caller check.";

/** patchKey (repairs/writes.ts:34): new origins join the origin index, a revoked key leaves it. */
const PATCH_KEY_WAS = [`${RP}/writes.ts:34`, `${A}/writes.ts:90`, `${A}/writes.ts:109`];

/** requireStagingDeployment (repairs/guards.ts:11) and the pinned identity read (repairs/reads.ts:21). */
const STAGING_WAS = [
  `${RP}/guards.ts:11`,
  `${RP}/errors.ts:7`,
  `${RP}/reads.ts:21`,
  `${RP}/rules.ts:33`,
  `${RP}/rules.ts:40`,
  `${RP}/rules.ts:92`,
  `${RP}/rules.ts:103`,
  `${A}/model.ts:34`,
  `${A}/model.ts:46`,
];

/** The proof repairs' outcome (retire-proof.ts, recover-proof.ts). */
const ProofOutcome = Schema.Struct({
  updated: Schema.Boolean,
  reason: Schema.Literals([
    "cleaned",
    "already-clean",
    "not-found",
    "application-mismatch",
    "origin-mismatch",
    "ambiguous-applications",
    "application-has-other-active-keys",
  ]),
  keyId: Schema.optionalKey(Schema.String),
  applicationId: Schema.optionalKey(Schema.String),
  keyCount: Schema.optionalKey(Schema.Number),
  revoked: Schema.Boolean,
  applicationArchived: Schema.Boolean,
});

export const rpc_applications_repairs_backfill_metadata = defineRpc({
  id: "applications.repairs.backfill-metadata",
  title: "Bring every application and key to this deployment's vendor keys",
  about:
    "The internal mutation `applications/repairs:backfillMetadata`. Reads the whole `developerApplications` and " +
    "`publishableKeys` tables in one transaction (`.collect()`, no paging) and patches each row whose vendor keys differ " +
    "from the given ones, and whose site URL is empty (derived from `…/api/auth`, else the given one). It overwrites the " +
    "vendor keys of every row, owned, archived or revoked, with no environment check. Returns how many rows of each it " +
    "patched; a second run patches none. Run by scripts/backfill-bootstrap-metadata.ts:40.",
  was: [
    `${CONVEX}:4`,
    `${OPS}/backfill-metadata.ts:17`,
    `${OPS}/backfill-metadata.ts:30`,
    `${OPS}/backfill-metadata.ts:37`,
    `${RP}/reads.ts:41`,
    `${RP}/reads.ts:43`,
    `${RP}/rules.ts:121`,
    `${RP}/writes.ts:27`,
    `${BACKEND}/scripts/backfill-bootstrap-metadata.ts:40`,
  ],
  concept: concept_applications,
  kind: "mutation",
  who: WHO,
  input: Schema.Struct({
    siteBaseUrl: Schema.String,
    openfortPublishableKey: Schema.String,
    shieldPublishableKey: Schema.String,
  }),
  output: Schema.Struct({ developerApplications: Schema.Number, publishableKeys: Schema.Number }),
  errors: [error_UNKNOWN],
  reads: [table_developer_applications, table_publishable_keys],
  writes: [table_developer_applications, table_publishable_keys],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_applications_repairs_ensure_native_client = defineRpc({
  id: "applications.repairs.ensure-native-client",
  title: "Register the staging CLI's pinned application and key if missing",
  about:
    "The internal mutation `applications/repairs:ensureNativeClient`. On the exact staging deployment only (tier " +
    "`staging` and CONVEX_CLOUD_URL `https://convex.staging.capxul.com`, else INVALID_INPUT). Reads the pinned " +
    "application, the pinned key and whichever key holds the pinned value (`.unique()` on each index), and refuses " +
    "INVALID_INPUT when a stored one is not exactly the pinned identity with the current staging routing and the given " +
    "vendor keys, or the pinned value belongs to another key. Then inserts the application `Capxul Web (staging)` with " +
    "its fixed id and the key with its fixed id and the raw key value written in the code (model.ts:46), whichever is " +
    "missing. Answers the ids and whether it created either.",
  was: [`${CONVEX}:5`, `${OPS}/ensure-native-client.ts:23`, `${OPS}/ensure-native-client.ts:35`, `${OPS}/ensure-native-client.ts:52`, `${OPS}/ensure-native-client.ts:54`, `${RP}/errors.ts:10`, `${RP}/writes.ts:46`, ...STAGING_WAS],
  concept: concept_applications,
  kind: "mutation",
  who: WHO,
  input: Schema.Struct({ openfortPublishableKey: Schema.String, shieldPublishableKey: Schema.String }),
  output: Schema.Struct({ applicationId: Schema.String, keyId: Schema.String, created: Schema.Boolean }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_developer_applications, table_publishable_keys, table_publishable_key_origins],
  writes: [table_developer_applications, table_publishable_keys, table_publishable_key_origins],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_applications_repairs_extend_origins = defineRpc({
  id: "applications.repairs.extend-origins",
  title: "Add origins to a live key and its application",
  about:
    "The internal mutation `applications/repairs:extendOrigins`. Finds the key by the raw value's hash; a missing or " +
    "revoked key answers `not-found`. The origins must be http(s) (INVALID_INPUT); a key that already allows every one " +
    "answers `already-present` without touching the application, even when its origins drifted. Otherwise the key's " +
    "origins are merged and indexed, and its application's merged when they change. It works on an expired key too. " +
    "Run by scripts/patch-reference-bootstrap-origin.ts:57.",
  was: [
    `${CONVEX}:6`,
    `${OPS}/extend-origins.ts:18`,
    `${OPS}/extend-origins.ts:25`,
    `${OPS}/extend-origins.ts:31`,
    `${OPS}/extend-origins.ts:41`,
    `${OPS}/extend-origins.ts:45`,
    `${RP}/rules.ts:22`,
    `${A}/rules.ts:60`,
    `${BACKEND}/scripts/patch-reference-bootstrap-origin.ts:57`,
    ...PATCH_KEY_WAS,
  ],
  concept: concept_applications,
  kind: "mutation",
  who: WHO,
  input: Schema.Struct({ publishableKey: Schema.String, origins: Schema.Array(Schema.String) }),
  output: Schema.Struct({
    updated: Schema.Boolean,
    reason: Schema.optionalKey(Schema.Literals(["not-found", "already-present"])),
    keyId: Schema.optionalKey(Schema.String),
    allowedOrigins: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_publishable_keys, table_developer_applications, table_publishable_key_origins],
  writes: [table_publishable_keys, table_developer_applications, table_publishable_key_origins],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_applications_repairs_migrate_native_routing = defineRpc({
  id: "applications.repairs.migrate-native-routing",
  title: "Move the staging CLI's pinned rows to the current routing",
  about:
    "The internal mutation `applications/repairs:migrateNativeRouting`. On the exact staging deployment only " +
    "(INVALID_INPUT). Both pinned rows must exist and be exactly the pinned identity with the same vendor keys " +
    "(INVALID_INPUT `native client identity conflicts`). Already on the current routing answers `migrated: false`; " +
    "rows on one of three approved prior routings written in the code (rules.ts:51) are moved together to the current " +
    "one, origins included; any other routing refuses INVALID_INPUT. The new origin is indexed; the old one stays in " +
    "the origin index.",
  was: [`${CONVEX}:7`, `${OPS}/migrate-native-routing.ts:28`, `${OPS}/migrate-native-routing.ts:39`, `${OPS}/migrate-native-routing.ts:52`, `${OPS}/migrate-native-routing.ts:55`, `${OPS}/migrate-native-routing.ts:60`, `${RP}/rules.ts:51`, `${RP}/rules.ts:79`, `${RP}/errors.ts:19`, `${RP}/errors.ts:22`, ...STAGING_WAS, ...PATCH_KEY_WAS],
  concept: concept_applications,
  kind: "mutation",
  who: WHO,
  input: Schema.Struct({}),
  output: Schema.Struct({ applicationId: Schema.String, keyId: Schema.String, migrated: Schema.Boolean }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_developer_applications, table_publishable_keys, table_publishable_key_origins],
  writes: [table_developer_applications, table_publishable_keys, table_publishable_key_origins],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_applications_repairs_recover_proof = defineRpc({
  id: "applications.repairs.recover-proof",
  title: "Retire a disposable host-proof application whose key was lost",
  about:
    "The internal mutation `applications/repairs:recoverProof`. The name must match the recoverable proof pattern " +
    "(`Host observability proof <8 hex> <uuid>`), name exactly one application whose id names exactly one row, with no " +
    "live key and at most one unrevoked test key, and the origin must be on the application and that key; otherwise " +
    "it answers the reason and changes nothing. It revokes every test key and removes the origin from each, archives " +
    "the application and removes the origin from it. A second run answers `already-clean`. An origin that is not " +
    "http(s) throws INVALID_INPUT rather than answering a reason. Run by the publishable-key scripts.",
  was: [`${CONVEX}:8`, `${OPS}/recover-proof.ts:37`, `${OPS}/recover-proof.ts:44`, `${OPS}/recover-proof.ts:55`, `${OPS}/recover-proof.ts:59`, `${OPS}/recover-proof.ts:86`, `${OPS}/recover-proof.ts:99`, `${RP}/rules.ts:18`, ...PATCH_KEY_WAS],
  concept: concept_applications,
  kind: "mutation",
  who: WHO,
  input: Schema.Struct({ expectedApplicationName: Schema.String, origin: Schema.String }),
  output: ProofOutcome,
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_developer_applications, table_publishable_keys, table_publishable_key_origins],
  writes: [table_developer_applications, table_publishable_keys, table_publishable_key_origins],
  drives: [machine_publishable_key.t.to_revoked, machine_developer_application.t.to_archived],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_applications_repairs_retire_proof = defineRpc({
  id: "applications.repairs.retire-proof",
  title: "Retire a disposable host-proof application by its key",
  about:
    "The internal mutation `applications/repairs:retireProof`. The key found by the raw value's hash, its id, its " +
    "application's id and name (prefix `Host observability proof `) must be exactly the recorded ones and the key " +
    "`test`; the origin must be on both (unless both are already retired); no other key of the application may be " +
    "unrevoked. Anything else answers the reason and changes nothing. It revokes the key, archives the application and " +
    "removes the origin from both. A second run answers `already-clean`. An empty key or a non-http(s) origin throws " +
    "INVALID_INPUT.",
  was: [`${CONVEX}:9`, `${OPS}/retire-proof.ts:20`, `${OPS}/retire-proof.ts:33`, `${OPS}/retire-proof.ts:49`, `${OPS}/retire-proof.ts:72`, `${OPS}/retire-proof.ts:84`, `${OPS}/retire-proof.ts:88`, `${RP}/rules.ts:15`, ...PATCH_KEY_WAS],
  concept: concept_applications,
  kind: "mutation",
  who: WHO,
  input: Schema.Struct({
    publishableKey: Schema.String,
    origin: Schema.String,
    expectedKeyId: Schema.String,
    expectedApplicationId: Schema.String,
    expectedApplicationName: Schema.String,
  }),
  output: ProofOutcome,
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_developer_applications, table_publishable_keys, table_publishable_key_origins],
  writes: [table_developer_applications, table_publishable_keys, table_publishable_key_origins],
  drives: [machine_publishable_key.t.to_revoked, machine_developer_application.t.to_archived],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
