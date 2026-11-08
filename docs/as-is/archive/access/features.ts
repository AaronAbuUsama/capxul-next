// The as-is book of the old access concept: the features area, feature gates (scenario oracle 06,
// option A): the devnet gate table, the synced PostHog copy, and the guard.
//
// Registered at `access/features:*` (packages/backend/convex/access/features.ts): three public rows
// of `features` (packages/protocol/src/access/operations.ts:61), the guard's internal query an action
// runs, and the PostHog sync, a one-minute cron, with the mutation it runs. The guard itself is the
// door's requireFeature family (procedures.ts).
//
// How a gate is decided (features/rules.ts:92): effective = ceiling AND gate. The ceiling is the
// catalogue's for the deployment's environment (devnet for a local devnet; staging for staging, beta
// and development; production otherwise). The gate comes from the table on a devnet, or anywhere
// CAPXUL_FEATURE_SYNC is not `posthog`: the subject's rows, or the catalogue default. With PostHog it
// comes from the synced flag; a money gate is off (`stale`) when the last good sync is older than
// 10 minutes. A gate only takes access away.

import { Schema } from "effect";
import { defineRpc, defineWorkflow } from "../../../packages/book/src/index.ts";
import { concept_access } from "../shared/foundation.ts";
import {
  error_ENV_MISSING,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_UNKNOWN,
} from "../shared/vocabulary.ts";
import { integration_posthog } from "../shared/external.ts";
import { table_feature_flags, table_feature_gates, table_feature_syncs } from "./data.ts";
import { procedure_access_authenticated_user } from "./procedures.ts";
import {
  procedure_organizations_read_organization_name_in_tx,
  procedure_organizations_read_organization_party_id_in_tx,
  procedure_organizations_require_org_participant,
} from "../organizations/procedures.ts";
import { procedure_parties_party_by_id } from "../parties/procedures.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/access/features.ts`;
const F = `${BACKEND}/src/access/features`;
const OPS = `${F}/operations`;
const ROWS = "packages/protocol/src/access/operations.ts";
const CATALOG = "packages/protocol/src/features/catalog.ts";

const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const opt = Schema.optionalKey;


/** `FEATURE_KEYS` (catalog.ts:284): any other key does not decode. */
const FeatureKey = Schema.Literals([
  "payment-departments",
  "payment-agreements",
  "payroll-runs",
  "owner-safe-proposals",
  "equity",
  "bank-payouts",
  "scheduled-payments",
  "payslip-preview",
  "books",
  "beta-access",
  "production-access",
]);
const OffReason = Schema.Literals(["gate", "environment", "stale"]);
const Decision = Schema.Struct({ on: B, reason: Schema.NullOr(OffReason) });

/** `CALL` and `DEFECTS` (operations.ts:11, packages/protocol/src/operation.ts:54). */
const CALL_DEFECTS = [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_UNKNOWN, error_ENV_MISSING];

const GATE_READS = [table_feature_gates, table_feature_flags, table_feature_syncs];
const DECIDE_WAS = [
  `${F}/reads.ts:32`,
  `${F}/reads.ts:69`,
  `${F}/reads.ts:85`,
  `${F}/reads.ts:95`,
  `${F}/reads.ts:114`,
  `${F}/reads.ts:194`,
  `${F}/rules.ts:20`,
  `${F}/rules.ts:33`,
  `${F}/rules.ts:92`,
  `${F}/rules.ts:107`,
  `${F}/rules.ts:116`,
  `${F}/rules.ts:141`,
  `${CATALOG}:300`,
];

// ── public rows ─────────────────────────────────────────────────────────────────────────────

export const rpc_access_features_list = defineRpc({
  id: "access.features.list",
  title: "Every catalogue gate for the caller, and an Organization",
  about:
    "Row `access.features.list`, registered as `access/features:list`. Signed in; with `orgId` the caller must take part in " +
    "the Organization (organizations' requireOrgParticipant, ROLE_PERMISSION_DENIED). Decides every catalogue gate, in " +
    "catalogue order, for the person and the Organization together: `{key, on, reason}`. Display only: each gated " +
    "operation checks its own gate, and the SDK does not pre-check.",
  was: [`${CONVEX}:3`, `${OPS}/list.ts:18`, `${OPS}/list.ts:23`, `${OPS}/list.ts:32`, `${ROWS}:67`, `${ROWS}:32`, ...DECIDE_WAS],
  concept: concept_access,
  kind: "query",
  who: "A signed-in person; with orgId, a current participant of that Organization.",
  input: Schema.Struct({ orgId: opt(S) }),
  output: Schema.Array(Schema.Struct({ key: FeatureKey, on: B, reason: Schema.NullOr(OffReason) })),
  errors: [...CALL_DEFECTS, error_ROLE_PERMISSION_DENIED],
  reads: GATE_READS,
  writes: [],
  drives: [],
  invokes: [procedure_access_authenticated_user, procedure_organizations_require_org_participant],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_features_set = defineRpc({
  id: "access.features.set",
  title: "Set an Organization's gate in a devnet's gate table",
  about:
    "Row `access.features.set`, registered as `access/features:set` (`capxul dev gates set KEY on|off --org H`). Off a local " +
    "devnet it refuses INVALID_INPUT (field environment) before it signs the caller in. Then: an unknown Organization is " +
    "INVALID_INPUT (orgId); the caller must take part in it (ROLE_PERMISSION_DENIED); turning on a gate whose devnet ceiling is " +
    "off is FEATURE_NOT_AVAILABLE (reason environment). Upserts the Organization's row (`updatedBy` the caller) and answers " +
    "the row, the Organization's handle and name, the devnet ceiling and the effective value, decided for the Organization " +
    "alone.",
  was: [
    `${CONVEX}:4`,
    `${OPS}/set.ts:24`,
    `${OPS}/set.ts:26`,
    `${OPS}/set.ts:29`,
    `${OPS}/set.ts:31`,
    `${OPS}/set.ts:34`,
    `${OPS}/set.ts:38`,
    `${OPS}/set.ts:40`,
    `${F}/guards.ts:164`,
    `${F}/errors.ts:49`,
    `${F}/errors.ts:56`,
    `${F}/writes.ts:13`,
    `${F}/views.ts:8`,
    `${F}/reads.ts:124`,
    `${ROWS}:77`,
    `${ROWS}:39`,
    ...DECIDE_WAS,
  ],
  concept: concept_access,
  kind: "mutation",
  who: "A signed-in participant of the Organization, on a local devnet only.",
  input: Schema.Struct({ key: FeatureKey, orgId: S, on: B }),
  output: Schema.Struct({
    key: FeatureKey,
    orgId: S,
    org: Schema.NullOr(S),
    name: S,
    on: B,
    ceiling: Schema.Literals(["on", "off"]),
    effective: B,
    source: Schema.Literal("devnet"),
  }),
  errors: [...CALL_DEFECTS, error_ROLE_PERMISSION_DENIED, error_FEATURE_NOT_AVAILABLE],
  reads: GATE_READS,
  writes: [table_feature_gates],
  drives: [],
  invokes: [
    procedure_access_authenticated_user,
    procedure_organizations_read_organization_name_in_tx,
    procedure_organizations_read_organization_party_id_in_tx,
    procedure_parties_party_by_id,
    procedure_organizations_require_org_participant,
  ],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_access_features_set_mine = defineRpc({
  id: "access.features.set-mine",
  title: "Set the caller's own person gate in a devnet's gate table",
  about:
    "Row `access.features.setMine`, registered as `access/features:setMine` (`capxul dev gates set KEY on|off` with no " +
    "Organization; `beta-access off` stands in for beta's closed waitlist). Off a local devnet INVALID_INPUT (environment) " +
    "before sign-in; a gate that targets only Organizations is INVALID_INPUT (key); turning on a gate whose devnet ceiling " +
    "is off is FEATURE_NOT_AVAILABLE. Upserts the caller's row and answers it with the devnet ceiling and the effective value " +
    "for the person.",
  was: [`${CONVEX}:5`, `${OPS}/set-mine.ts:22`, `${OPS}/set-mine.ts:24`, `${OPS}/set-mine.ts:27`, `${OPS}/set-mine.ts:28`, `${OPS}/set-mine.ts:30`, `${OPS}/set-mine.ts:33`, `${F}/errors.ts:63`, `${F}/writes.ts:36`, `${F}/views.ts:26`, `${ROWS}:88`, `${ROWS}:53`, ...DECIDE_WAS],
  concept: concept_access,
  kind: "mutation",
  who: "A signed-in person, on a local devnet only.",
  input: Schema.Struct({ key: FeatureKey, on: B }),
  output: Schema.Struct({ key: FeatureKey, on: B, ceiling: Schema.Literals(["on", "off"]), effective: B, source: Schema.Literal("devnet") }),
  errors: [...CALL_DEFECTS, error_FEATURE_NOT_AVAILABLE],
  reads: GATE_READS,
  writes: [table_feature_gates],
  drives: [],
  invokes: [procedure_access_authenticated_user],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

// ── internal ────────────────────────────────────────────────────────────────────────────────

export const rpc_access_features_check = defineRpc({
  id: "access.features.check",
  title: "One gate check for an action's guard",
  about:
    "Internal query `access/features:check`, run by requireFeatureFromAction and featureOnFromAction in the action's own " +
    "call. A key not in the catalogue is INVALID_INPUT (key). Decides the gate for the subject; an off gate for an " +
    "Organization also reads its name and its Party's handle for the refusal (null when the Organization is unknown).",
  was: [`${CONVEX}:8`, `${OPS}/check.ts:14`, `${OPS}/check.ts:18`, `${F}/reads.ts:143`, `${F}/reads.ts:124`, `${F}/errors.ts:60`, ...DECIDE_WAS],
  concept: concept_access,
  kind: "query",
  who: "internal: the door's action-side gate guards.",
  input: Schema.Struct({ key: S, authUserId: opt(S), orgId: opt(S) }),
  output: Schema.Struct({
    decision: Decision,
    organization: Schema.NullOr(Schema.Struct({ orgId: S, name: S, handle: Schema.NullOr(S) })),
  }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: GATE_READS,
  writes: [],
  drives: [],
  invokes: [procedure_organizations_read_organization_name_in_tx, procedure_organizations_read_organization_party_id_in_tx, procedure_parties_party_by_id],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

const FlagDefinition = Schema.Struct({
  key: S,
  active: B,
  target: Schema.Literals(["person", "organization"]),
  conditions: Schema.Array(Schema.Struct({ ids: Schema.NullOr(Schema.Array(S)), rollout: N })),
  unsupported: opt(S),
});

export const rpc_access_features_record_sync = defineRpc({
  id: "access.features.record-sync",
  title: "Keep one PostHog sync run",
  about:
    "Internal mutation `access/features:recordSync`, run by the sync. A `synced` record with a key outside the catalogue is " +
    "INVALID_INPUT and nothing is written; otherwise every synced flag row is deleted, the run's flags inserted with its hash " +
    "and time, and a `synced` run row added with the counts. A `failed` record adds a failed run row and changes no flag, so " +
    "the last good copy stays until it is stale.",
  was: [`${CONVEX}:9`, `${OPS}/record-sync.ts:22`, `${OPS}/record-sync.ts:45`, `${OPS}/record-sync.ts:50`, `${F}/writes.ts:71`],
  concept: concept_access,
  kind: "mutation",
  who: "internal: the PostHog sync (access.features.sync).",
  input: Schema.Struct({
    at: N,
    record: Schema.Union([
      Schema.Struct({ outcome: Schema.Literal("synced"), definitionHash: S, flags: Schema.Array(FlagDefinition), ignored: Schema.Array(S) }),
      Schema.Struct({ outcome: Schema.Literal("failed"), reason: S }),
    ]),
  }),
  output: Schema.Null,
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_feature_flags],
  writes: [table_feature_flags, table_feature_syncs],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const workflow_access_features_sync = defineWorkflow({
  id: "access.features.sync",
  title: "Copy the PostHog feature flags into Convex, every minute",
  about:
    "Internal action `access/features:sync`, the cron job `sync feature flags from PostHog` every minute (`crons.interval`), " +
    "registered on every deployment, attributed to the system job sync_feature_flags. It answers `off` and reads nothing " +
    "unless the gate source is PostHog (CAPXUL_FEATURE_SYNC=posthog, never on a devnet). Then it reads every flag of the " +
    "project (POSTHOG_FLAGS_API_KEY, POSTHOG_FLAGS_PROJECT_ID, POSTHOG_FLAGS_HOST default us.posthog.com; 100 a page, at " +
    "most 10 pages, 10 s each). No key or project records `failed` `not_configured`; a failed read `failed` " +
    "`posthog_unavailable`. Otherwise it plans the catalogue's definitions (a deleted flag is none; one outside the " +
    "catalogue is ignored; a rule the evaluator cannot read is unsupported; the Organization group's index is " +
    "POSTHOG_ORGANIZATION_GROUP_INDEX, default 0), hashes them, annotates the outcome and runs access.features.record-sync.",
  was: [
    `${CONVEX}:10`,
    `${OPS}/sync.ts:32`,
    `${OPS}/sync.ts:37`,
    `${OPS}/sync.ts:38`,
    `${OPS}/sync.ts:39`,
    `${OPS}/sync.ts:41`,
    `${OPS}/sync.ts:44`,
    `${OPS}/sync.ts:48`,
    `${OPS}/sync.ts:58`,
    `${F}/events.ts:4`,
    `${F}/external.ts:12`,
    `${F}/external.ts:21`,
    `${F}/rules.ts:186`,
    `${F}/rules.ts:260`,
    `${F}/rules.ts:281`,
    `${BACKEND}/src/integrations/posthog/flags.ts:62`,
    `${BACKEND}/src/platform/jobs.ts:77`,
    `${BACKEND}/convex/crons.ts:8`,
  ],
  concept: concept_access,
  priority: "critical",
  trigger: { cron: "* * * * *" },
  instance: "singleton",
  steps: [
    { name: "attribute", about: "Records the run as the system job sync_feature_flags." },
    { name: "switch", about: "Answers `off` unless the deployment's gate source is PostHog." },
    { name: "read", about: "Reads every PostHog flag of the configured project, following `next` on the same origin, at most 10 pages." },
    { name: "plan", about: "Keeps the catalogue's flags as local definitions in key order, lists the rest as ignored, and hashes the kept ones (SHA-256)." },
    { name: "record", about: "Runs access.features.record-sync with the synced or failed record and the time; answers the outcome." },
  ],
  reads: [table_feature_flags],
  writes: [table_feature_flags, table_feature_syncs],
  drives: [],
  invokes: [],
  emits: [],
  calls: [integration_posthog.c.readFlagDefinitions],
  chain: [],
  idempotency: "Each run replaces the whole synced copy with the same plan for the same flags; a failed run changes no flag.",
  timeoutMs: 600000,
  retries: { max: 0, backoff: "none" },
});
