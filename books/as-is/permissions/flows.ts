// The as-is Core SDK flows of the old permissions concept, part one: the methods of
// `client.org(orgId).allowances` (packages/sdk/src/permissions/commands.ts, mounted at
// packages/sdk/src/organizations/scope.ts:257) that reach the authorities, grants, verifications,
// views and configurations areas. Only `authorities` has SDK methods: no SDK method calls
// permissions.verifications.verify, any grants operation or a configurations row from this folder
// (configurations.propose is called by packages/sdk/src/organizations/, booked by that concept).
// Methods that forward one rpc are listed in the comment at the end, with the rpc each forwards.
// The allowance and command methods are part two's (flows-allowances.ts); the write flows the
// operations book imports from this file by name are re-exported from there.
//
// Paths in `was` are relative to the old repository root (/home/user/factory).

import { Schema } from "effect";
import { defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { error_CANCELLED, error_INVALID_INPUT } from "../shared/vocabulary.ts";
import { rpc_permissions_authorities_list } from "./authorities.ts";

export {
  flow_client_org_allowances_assign,
  flow_client_org_allowances_change,
  flow_client_org_allowances_create,
  flow_client_org_allowances_revoke,
} from "./flows-allowances.ts";

const SDK = "packages/sdk/src/permissions";

const S = Schema.String;
const N = Schema.Number;
const opt = Schema.optionalKey;

/** `PermissionOptions` (records.ts:297): an AbortSignal and a callback, not data. */
const Options = opt(
  Schema.Struct({
    signal: opt(Schema.Unknown),
    onPrepared: opt(Schema.Unknown),
  }),
);

/** `Permission` (protocol permission-schema.ts:120); `currentPolicy` is deep: Unknown. */
const Permission = Schema.Struct({
  permissionId: S,
  orgId: S,
  type: Schema.Literals(["budget", "managePeople"]),
  state: Schema.Literals(["pending", "active", "suspended", "revoked", "superseded"]),
  revision: N,
  roleKey: S,
  currentPolicy: opt(Schema.Unknown),
  assetId: opt(S),
  tokenAddress: opt(S),
  decimals: opt(N),
  limitRaw: opt(S),
  allowanceKey: opt(S),
});

// ── flow: client.org(orgId).allowances.get ──────────────────────────────────────────────────

export const flow_client_org_allowances_get = defineFlow({
  id: "client.org.allowances.get",
  title: "Read one Roles Permission at its current revision",
  about:
    "The pre-v4 (Roles) read of one Permission: it reads the whole list (permissions.authorities.list) and picks the " +
    "Permission locally, so the answer is decided in the SDK, not by the rpc. Under the observed runner (an SDK " +
    "operation org.permissions.get, its span and its failure capture): an aborted signal is CANCELLED; the list must " +
    "belong to the Organization (INVALID_INPUT, permission); currentPermission keeps the one active revision (two are " +
    "INVALID_INPUT, multiple active Permission revisions), else the newest revision that is not superseded (else the " +
    "newest), and two at that revision are INVALID_INPUT; no row is null. The v4 read is getBudget (part two). Output: " +
    "the Permission or null; every error arrives as a CapxulResult failure.",
  component: component_core_sdk,
  sdk: "client.org(orgId).allowances.get",
  input: Schema.Struct({ permissionId: S, options: Options }),
  output: Schema.NullOr(Permission),
  steps: [
    {
      name: "observe",
      local: "build",
      about: "observed(): an aborted signal is CANCELLED before any call; opens the org.permissions.get operation span.",
    },
    { name: "list", rpc: rpc_permissions_authorities_list, about: "Every Permission of the Organization and its assignments, one page." },
    {
      name: "organization",
      local: "build",
      about: "Any item of another Organization is INVALID_INPUT (permission, read belongs to another Organization); else the Organization is verified.",
    },
    {
      name: "current-revision",
      local: "build",
      about: "currentPermission: the single active revision, else the newest not superseded; ambiguity is INVALID_INPUT (permissionId).",
    },
  ],
  errors: [error_CANCELLED, error_INVALID_INPUT],
  calls: [],
  spans: ["org.permissions.get"],
  was: [
    `${SDK}/commands.ts:232`,
    `${SDK}/commands.ts:24`,
    `${SDK}/commands.ts:44`,
    `${SDK}/observed-operation.ts:22`,
    `${SDK}/records.ts:189`,
    "packages/sdk/src/organizations/scope.ts:257",
    "packages/observability/src/operations/org.ts:136",
  ],
});

// ── Methods that forward one rpc: no flow; the operation names the rpc ───────────────────────
//
// client.org(orgId).allowances.list          → permissions.authorities.list, under the observed runner
//                                              (org.permissions.list); refuses a page with an item of another
//                                              Organization, INVALID_INPUT (commands.ts:213, :67).
// client.org(orgId).allowances.allowanceLeft → permissions.authorities.budget-left with { orgId, budgetId },
//                                              under the observed runner (org.permissions.budgetLeft); verifies
//                                              the Organization on success (commands.ts:226, budget-left.ts:14).
//
// Not booked here, because they reach other areas: previewReplacement (replacements), getCommand and
// subscribeCommand (commands), create/change/assign/revoke, replace, listBudgets and getBudget (part two:
// flows-allowances.ts).
