// The old book's Organizations area, as it is: one operation record for each of the six operations
// apps/docs/factory/areas/organizations.yaml lists (org create, show, wait, retry, list, me), read from
// /home/user/factory (branch integration/factory). The text (title, about, who, changes, notes,
// mistakes, acceptance and each refusal's `when`) is the frozen book's, spread from ../../frozen, never
// retyped. The page is cited as `<id>.yaml:1` in `was`.
//
// implementedBy is what the CLI command (apps/cli/src/commands/org/subcommands/<verb>/) reaches through
// the SDK method the page names: that method's flow when it composes several calls, else the one rpc it
// reaches. `org create` calls `client.onboarding.beginOrganization` (sdk profiles/organization-
// onboarding.ts:83), which restores the session, reads the profile, refreshes the identity, reaches the
// claimed Account and only then runs organizations.setups.begin: a flow, owned by ../profiles/flows.ts.
// The other five reach one row each: `client.org(orgId).setup.get`, `.setup.subscribe` (a live
// subscription to the same row, sdk setup-adapter.ts:201) and `.setup.resume` (setup-adapter.ts:82, :118)
// in ../organizations/setups.ts; `client.orgs` and `client.org(orgId).me` (sdk adapter.ts:49, me.ts:161)
// in ../organizations/workspaces.ts. Where the CLI itself makes further calls around the method (the
// access list, the founder authorization, a Directors read), the record's comment says so.
//
// returns is what the command prints with `--json` (its envelope's `data`), typed from the protocol row
// (packages/protocol/src/organizations/setup-schema.ts, schema.ts) as the SDK maps it (sdk organizations/
// views.ts:120, me.ts:101). A setup issue's `error` is the SDK's rehydrated CapxulError (sdk setups.ts:95)
// and a member assignment's `policy` the permissions CurrentPolicy: both are Schema.Unknown. Where the page
// lists other fields than the CLI prints, the comment says so: that gap is a finding.
//
// errors is what the CLI command produces itself (CliFailure, or a CapxulError the CLI constructs):
// CLI_USAGE (the parser and inputRequired, apps/cli/src/auth/input.ts:11; an unknown `--org` handle,
// auth/actor.ts:59), ROLE_PERMISSION_DENIED (organizationAccessDenied, org/internal/lifecycle.ts:17, from
// the access list read at org/internal/read.ts:218 or requireCurrentAccess, lifecycle.ts:34), CLI_DEADLINE
// (organizationWaitTimeout, lifecycle.ts:130) and, for the writes, WRONG_STATE (write.ts:193, recovery-
// output.ts:134, requireReadyLifecycle write.ts:241). Left out: the session restore's NOT_AUTHENTICATED,
// shared by every signed-in command; the generic CLI_DEFECT (write-failures.ts:25, progress.ts:69); the
// integrity checks a person cannot meet (INVALID_INPUT on a setup scope mismatch and the abort's CANCELLED
// in observeOrganizationSetup, lifecycle.ts:93, :106); and committedOrganizationFailure (recovery-output.ts:
// 205), which keeps the backend's own code and only rewords it.
//
// A refusal's `given` names the devnet world (packages/scenarios) from which one runs-today scenario
// step's command line, run by the same person, reaches the code for a cause the `when` describes: a step
// of S1 after s1.20 reaches it from after-s1 (saved at s1.20, s1-acme-is-founded.scenario.ts:185). `?`
// where no step does; the comment names the step when one reaches the code on the SDK surface alone. No
// budget: nothing measured these commands. Priority is `normal` throughout: the old book ranks none.

import { Schema } from "effect";
import { defineOperation, type Ref } from "../../../packages/book/src/index.ts";
import { frozenClaims, frozenRefusals, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CLI_DEADLINE,
  error_CLI_STORAGE,
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { flow_client_onboarding_begin_organization } from "../profiles/flows.ts";
import { rpc_organizations_setups_get, rpc_organizations_setups_resume } from "../organizations/setups.ts";
import { rpc_organizations_workspaces_list, rpc_organizations_workspaces_me } from "../organizations/workspaces.ts";

// ── how a page's refusals become records ─────────────────────────────────────────────────────

/** The page's refusals in its order, `when` verbatim; `mapped[i]` is the i-th one's error and world. */
const refusalsOf = (id: FrozenId, mapped: readonly (readonly [error: Ref<"error">, given: string])[]) => {
  const frozen = frozenRefusals(id);
  if (frozen.length !== mapped.length) throw new Error(`${id}: ${frozen.length} refusals, ${mapped.length} mapped`);
  return frozen.map(({ code, when }, i) => {
    const [error, given] = mapped[i]!;
    if (error.id !== code) throw new Error(`${id}: refusal ${i + 1} is ${code}, mapped to ${error.id}`);
    return { error, given, when };
  });
};

const book = (id: string) => `apps/docs/factory/operations/${id}.yaml:1`;
const CLI = "apps/cli/src/commands";
const ORG = `${CLI}/org/subcommands`;
const INTERNAL = `${CLI}/org/internal`;
const SDK = "packages/sdk/src";
const ROWS = "packages/protocol/src";
const S1 = "packages/scenarios/src/acme/s1-acme-is-founded.scenario.ts";

/** How every org read picks its Organization (org/internal/read.ts:98): one `--org`, the saved one, a prompt. */
const READ_WAS = [
  `${INTERNAL}/read.ts:98`,
  `${INTERNAL}/read.ts:131`,
  `${INTERNAL}/read.ts:139`,
  `${INTERNAL}/read.ts:166`,
  `${INTERNAL}/read.ts:174`,
  `${INTERNAL}/read.ts:206`,
  `${INTERNAL}/read.ts:218`,
  `${INTERNAL}/lifecycle.ts:17`,
  "apps/cli/src/auth/actor.ts:59",
  "apps/cli/src/auth/input.ts:11",
];

// ── what the organizations rows answer, transcribed ──────────────────────────────────────────
// Branded strings and refined numbers are plain here.

/** ORGANIZATION_SETUP_REASONS (organizations/setup-model.ts:14). */
const SetupReason = Schema.Literals([
  "submission_unknown",
  "receipt_unresolved",
  "provider_unavailable",
  "receipt_reverted",
  "deterministic_address_mismatch",
  "receipt_mismatch",
  "block_identity_changed",
  "authority_event_mismatch",
  "allowance_timestamp_mismatch",
  "receipt_identity_unavailable",
  "receipt_identity_mismatch",
  "contract_code_unavailable",
  "contract_state_mismatch",
  "permission_projection_mismatch",
  "bootstrap_reorg",
  "dependent_authority_unresolved",
  "historical_evidence_missing",
  "worker_failed",
]);

/** ORGANIZATION_SETUP_STATUSES and _STEPS (setup-model.ts:2, :42). */
const SetupStatus = Schema.Literals(["awaitingAuthorization", "processing", "needsAttention", "ready", "rechecking", "failed"]);
const SetupStep = Schema.Literals(["safe_minted", "money_deployed", "installed"]);

/** A stored setup issue (setup-schema.ts:10); `error` is the SDK's rehydrated CapxulError (sdk setups.ts:95). */
const SetupIssue = Schema.Struct({ reason: SetupReason, error: Schema.optionalKey(Schema.Unknown) });

/** OrganizationSetupSchema (organizations/setup-schema.ts:20), as the SDK parses it (sdk setups.ts:105). */
const OrganizationSetup = Schema.Struct({
  orgId: Schema.String,
  status: SetupStatus,
  steps: Schema.Array(SetupStep),
  completedAt: Schema.NullOr(Schema.Number),
  lastCheckedAt: Schema.NullOr(Schema.Number),
  nextCheckAt: Schema.NullOr(Schema.Number),
  issue: Schema.NullOr(SetupIssue),
  lastSendIssue: Schema.NullOr(SetupIssue),
  recovery: Schema.Literals(["authorize", "checkAgain", "none"]),
  phase: Schema.optionalKey(Schema.Literals(["resolvingSubmission", "confirmingBootstrap"])),
});

/** What create, retry and wait print: the Organization and its setup (create/execute.ts:284). */
const OrganizationLifecycle = Schema.Struct({ organizationId: Schema.String, lifecycle: OrganizationSetup });

/** MemberIdentityProjectionSchema (organizations/schema.ts:39); the assignment's `policy` is CurrentPolicy, untranscribed. */
const MemberIdentity = Schema.Struct({
  orgId: Schema.String,
  partyId: Schema.String,
  accountId: Schema.NullOr(Schema.String),
  safeAddress: Schema.String,
  accountReady: Schema.NullOr(Schema.Boolean),
  assignments: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      authority: Schema.Union([
        Schema.Struct({ type: Schema.Literal("budget"), budgetId: Schema.String }),
        Schema.Struct({ type: Schema.Literal("managePeople"), permissionId: Schema.String }),
      ]),
      state: Schema.Literals(["pending", "active", "suspended", "revoked"]),
      policy: Schema.Unknown,
      revision: Schema.Number,
      observedAt: Schema.Number,
    }),
  ),
});

const Capabilities = Schema.Struct({ canManagePeople: Schema.Boolean, canSpend: Schema.Boolean });

/** One workspace as the SDK brands it (sdk organizations/views.ts:120, records.ts:91) from WorkspaceSchema (schema.ts:86). */
const OrganizationAccess = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  handle: Schema.String,
  account: Schema.Struct({ id: Schema.NullOr(Schema.String), address: Schema.String, ready: Schema.NullOr(Schema.Boolean) }),
  setup: OrganizationSetup,
  member: Schema.NullOr(MemberIdentity),
  capabilities: Capabilities,
  custody: Schema.Struct({ status: Schema.Literal("unknown") }),
  observedAt: Schema.Number,
});

/** AssetAmountSchema (money/schema.ts:46). */
const AssetAmount = Schema.Struct({
  asset: Schema.String,
  value: Schema.String,
  currency: Schema.optional(Schema.Never),
  decimals: Schema.optional(Schema.Never),
});

/** OrgMe as the SDK maps OrgMeSchema (schema.ts:62) in toOrgMe (sdk organizations/me.ts:101). */
const OrgMe = Schema.Struct({
  member: MemberIdentity,
  role: Schema.NullOr(Schema.Struct({ label: Schema.String })),
  capabilities: Capabilities,
  budgets: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      asset: Schema.Struct({ assetId: Schema.String, symbol: Schema.String, decimals: Schema.Number }),
      limit: Schema.NullOr(AssetAmount),
    }),
  ),
  safe: Schema.Struct({ isOwner: Schema.Boolean, threshold: Schema.Number, ownerCount: Schema.Number }),
  observedAt: Schema.Number,
});

// ═══ org create ══════════════════════════════════════════════════════════════════════════════

// `org create` (create/execute.ts:63). Before any signer: the draft, `--confirm` in a script, the session,
// the waitlist (refuseWhileWaiting reads client.waitlist.status and answers FEATURE_NOT_AVAILABLE itself,
// waitlist/internal/hold.ts:12) and the machine's recovery record (org/internal/recovery.ts:100). A
// recorded journey resumes its own Organization (route `recover`, :160). Otherwise the CLI saves the
// handle, then calls `client.onboarding.beginOrganization` (:201), the flow. Then the CLI itself runs
// `setup.authorize` (:227: setups.get, setups.prepare-authorization, the founder's signature,
// setups.submit-authorization, sdk setup-adapter.ts:130), follows `setup.subscribe` (:231) and reads
// `client.orgs` for current access (:241). With `--json` it prints the Organization ID and its last
// lifecycle once ready. CLI_STORAGE is the recovery record the command itself writes (recovery.ts:100).
// S1's two creates (s1.4, s1:1382; s1.24, s1:2076) and S8's (s8:574) succeed: no step reaches a refusal.
export const operation_org_create = defineOperation({
  ...frozenText("org.create"),
  was: [
    book("org.create"),
    `${ORG}/create/command.ts:8`,
    `${ORG}/create/execute.ts:63`,
    `${ORG}/create/execute.ts:78`,
    `${ORG}/create/execute.ts:80`,
    `${ORG}/create/execute.ts:86`,
    `${ORG}/create/execute.ts:160`,
    `${ORG}/create/execute.ts:199`,
    `${ORG}/create/execute.ts:201`,
    `${ORG}/create/execute.ts:227`,
    `${ORG}/create/execute.ts:231`,
    `${ORG}/create/execute.ts:241`,
    `${ORG}/create/execute.ts:277`,
    `${ORG}/create/execute.ts:284`,
    `${SDK}/profiles/organization-onboarding.ts:83`,
    `${SDK}/profiles/organization-onboarding.ts:117`,
    `${SDK}/profiles/onboardings.ts:232`,
    `${SDK}/organizations/setup-adapter.ts:59`,
    `${INTERNAL}/draft.ts:16`,
    `${INTERNAL}/write.ts:36`,
    `${INTERNAL}/write.ts:50`,
    `${INTERNAL}/write.ts:193`,
    `${INTERNAL}/write.ts:241`,
    `${INTERNAL}/recovery-output.ts:134`,
    `${INTERNAL}/lifecycle.ts:130`,
    `${INTERNAL}/recovery.ts:100`,
    `${CLI}/waitlist/internal/hold.ts:12`,
    `${ROWS}/organizations/setup-schema.ts:20`,
    `${S1}:1382`,
  ],
  priority: "normal",
  implementedBy: flow_client_onboarding_begin_organization,
  acceptance: frozenClaims("org.create"),
  returns: OrganizationLifecycle,
  errors: [
    error_CLI_USAGE,
    error_WRONG_STATE,
    error_ROLE_PERMISSION_DENIED,
    error_CLI_DEADLINE,
    error_FEATURE_NOT_AVAILABLE,
    error_CLI_STORAGE,
  ],
  refusals: refusalsOf("org.create", [
    [error_CLI_USAGE, "?"],
    [error_INVALID_INPUT, "?"],
    [error_WRONG_STATE, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// ═══ org show ════════════════════════════════════════════════════════════════════════════════

// `org show` (show/execute.ts:14). readOrganization picks the Organization: with none chosen and exactly one
// unfinished setup it reads that one (setups.list-mine, read.ts:166); else it reads `client.orgs` and refuses
// one not in the list (read.ts:218). It reads `client.org(orgId).setup.get` (:23), the rpc, and once ready
// requires current access (:26) and reads `directors.get` for the Board (:35). The page's three fields are
// what it prints. No step reaches a page refusal: s1.22 and s1.23 (s1:2014, :2045) are refused by the
// environment (EXPERIMENTAL_NOT_ACCEPTED, CAPABILITY_UNAVAILABLE), which the page does not list.
export const operation_org_show = defineOperation({
  ...frozenText("org.show"),
  was: [
    book("org.show"),
    `${ORG}/show/command.ts:6`,
    `${ORG}/show/execute.ts:14`,
    `${ORG}/show/execute.ts:23`,
    `${ORG}/show/execute.ts:26`,
    `${ORG}/show/execute.ts:34`,
    `${ORG}/show/execute.ts:35`,
    `${ORG}/show/execute.ts:39`,
    `${INTERNAL}/setup-read.ts:11`,
    ...READ_WAS,
    `${SDK}/organizations/scope.ts:235`,
    `${SDK}/organizations/setup-adapter.ts:82`,
    `${ROWS}/organizations/setup-model.ts:42`,
    `${S1}:2014`,
    `${S1}:2045`,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_setups_get,
  acceptance: frozenClaims("org.show"),
  returns: Schema.Struct({
    setup: SetupStatus,
    steps: Schema.Array(SetupStep),
    board: Schema.NullOr(Schema.Struct({ directors: Schema.Number, threshold: Schema.Number })),
  }),
  errors: [error_CLI_USAGE, error_ROLE_PERMISSION_DENIED, error_CLI_DEADLINE],
  refusals: refusalsOf("org.show", [
    [error_CLI_USAGE, "?"],
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// ═══ org wait ════════════════════════════════════════════════════════════════════════════════

// `org wait` (wait/execute.ts:54). The same Organization pick as `org show`, then it follows
// `client.org(orgId).setup.subscribe` (:29), a live subscription to organizations.setups.get, until a
// settled state (ready, failed, awaiting authorization, or needing attention with no check planned,
// lifecycle.ts:51), requires current access (:39), and stops at `--timeout-seconds` with CLI_DEADLINE
// (setup-read.ts:11). Finding: the page lists `status` and `recovery`; the CLI prints the Organization ID
// and its whole lifecycle (setup-read.ts:41), with `status` and `recovery` inside `lifecycle`.
// s1.45 (s1:2370): Sam runs `org wait --org engines`, not one of his Organizations, and the CLI refuses
// the handle with CLI_USAGE (actor.ts:59) before it reads setup. From after-s1 the same command meets the
// same refusal: Engines (made at s1.24, after after-s1) is not among Sam's either way. Its SDK line reaches
// ROLE_PERMISSION_DENIED; no CLI line does.
export const operation_org_wait = defineOperation({
  ...frozenText("org.wait"),
  was: [
    book("org.wait"),
    `${ORG}/wait/command.ts:6`,
    `${ORG}/wait/execute.ts:14`,
    `${ORG}/wait/execute.ts:29`,
    `${ORG}/wait/execute.ts:39`,
    `${ORG}/wait/execute.ts:54`,
    `${INTERNAL}/lifecycle.ts:51`,
    `${INTERNAL}/lifecycle.ts:63`,
    `${INTERNAL}/setup-read.ts:11`,
    `${INTERNAL}/setup-read.ts:41`,
    ...READ_WAS,
    `${SDK}/organizations/scope.ts:239`,
    `${SDK}/organizations/setup-adapter.ts:176`,
    `${S1}:185`,
    `${S1}:2370`,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_setups_get,
  acceptance: frozenClaims("org.wait"),
  returns: OrganizationLifecycle,
  errors: [error_CLI_USAGE, error_ROLE_PERMISSION_DENIED, error_CLI_DEADLINE],
  refusals: refusalsOf("org.wait", [
    [error_CLI_USAGE, "after-s1"],
    [error_CLI_DEADLINE, "?"],
    [error_ROLE_PERMISSION_DENIED, "?"],
  ]),
});

// ═══ org retry ═══════════════════════════════════════════════════════════════════════════════

// `org retry` (retry/execute.ts:38). Exactly one `--org`, never a saved default (:52-61), `--confirm` in a
// script, then at a terminal a preview (organizationPreview, :69). The page names `setup.resume`; the CLI
// reads `setup.get` first and calls `setup.authorize` while the setup awaits the founder's authorization,
// else `client.org(orgId).setup.resume` (:117-122), then follows `setup.subscribe` (:124), requires a ready
// lifecycle (:148) and current access (:149). implementedBy is the rpc the page's method reaches.
// s1.47 (s1:2401): Dana runs `org retry --confirm` from a script with no `--org` and the CLI refuses
// before any call; from after-s1 the same.
export const operation_org_retry = defineOperation({
  ...frozenText("org.retry"),
  was: [
    book("org.retry"),
    `${ORG}/retry/command.ts:8`,
    `${ORG}/retry/execute.ts:38`,
    `${ORG}/retry/execute.ts:49`,
    `${ORG}/retry/execute.ts:55`,
    `${ORG}/retry/execute.ts:58`,
    `${ORG}/retry/execute.ts:61`,
    `${ORG}/retry/execute.ts:63`,
    `${ORG}/retry/execute.ts:69`,
    `${ORG}/retry/execute.ts:117`,
    `${ORG}/retry/execute.ts:121`,
    `${ORG}/retry/execute.ts:122`,
    `${ORG}/retry/execute.ts:124`,
    `${ORG}/retry/execute.ts:147`,
    `${ORG}/retry/execute.ts:148`,
    `${ORG}/retry/execute.ts:149`,
    `${ORG}/retry/execute.ts:153`,
    `${SDK}/organizations/scope.ts:243`,
    `${SDK}/organizations/setup-adapter.ts:118`,
    `${INTERNAL}/write.ts:241`,
    `${INTERNAL}/lifecycle.ts:130`,
    `${S1}:185`,
    `${S1}:2401`,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_setups_resume,
  acceptance: frozenClaims("org.retry"),
  returns: OrganizationLifecycle,
  errors: [error_CLI_USAGE, error_WRONG_STATE, error_ROLE_PERMISSION_DENIED, error_CLI_DEADLINE],
  refusals: refusalsOf("org.retry", [
    [error_CLI_USAGE, "after-s1"],
    [error_INVALID_INPUT, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// ═══ org list ════════════════════════════════════════════════════════════════════════════════

// `org list` (list/execute.ts:29). `--limit` and `--after` are checked before any read (checkBounds,
// runtime/paging.ts:43). It reads `client.orgs` (:34), the rpc organizations.workspaces.list, and every page
// of the founder's unfinished setups (`client.onboarding.listOrganizationSetups`, :36; read.ts:50), then
// pages the Organizations itself (showPage over one page whose cursor is null, :14). An unfinished setup
// grants no access. s1.43 (s1:2342): Dana's `org list --limit 0` is refused before any read; from after-s1
// the same.
export const operation_org_list = defineOperation({
  ...frozenText("org.list"),
  was: [
    book("org.list"),
    `${ORG}/list/command.ts:9`,
    `${ORG}/list/execute.ts:14`,
    `${ORG}/list/execute.ts:21`,
    `${ORG}/list/execute.ts:29`,
    `${ORG}/list/execute.ts:30`,
    `${ORG}/list/execute.ts:34`,
    `${ORG}/list/execute.ts:36`,
    `${INTERNAL}/read.ts:50`,
    `${INTERNAL}/read.ts:196`,
    "apps/cli/src/runtime/paging.ts:43",
    "apps/cli/src/runtime/paging.ts:82",
    `${SDK}/organizations/scope.ts:157`,
    `${SDK}/organizations/adapter.ts:49`,
    `${SDK}/organizations/views.ts:120`,
    `${ROWS}/organizations/operations.ts:144`,
    `${ROWS}/organizations/schema.ts:86`,
    `${S1}:185`,
    `${S1}:2342`,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_workspaces_list,
  acceptance: frozenClaims("org.list"),
  returns: Schema.Struct({
    items: Schema.Array(OrganizationAccess),
    nextCursor: Schema.NullOr(Schema.String),
    unfinishedSetups: Schema.Array(OrganizationSetup),
  }),
  errors: [error_CLI_USAGE],
  refusals: refusalsOf("org.list", [
    [error_CLI_USAGE, "after-s1"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});

// ═══ org me ══════════════════════════════════════════════════════════════════════════════════

// `org me` (me/execute.ts:32). The Organization pick refuses one not in `client.orgs` (read.ts:218); then
// `client.org(orgId).me` (:21), the rpc organizations.workspaces.me, printed as the SDK maps it. The page
// lists member, role, capabilities and budgets; the CLI also prints `safe` (isOwner, threshold, ownerCount)
// and `observedAt`. s2.12 (s2:1238) reads it and succeeds: no step reaches a refusal.
export const operation_org_me = defineOperation({
  ...frozenText("org.me"),
  was: [
    book("org.me"),
    `${ORG}/me/command.ts:7`,
    `${ORG}/me/execute.ts:21`,
    `${ORG}/me/execute.ts:24`,
    `${ORG}/me/execute.ts:32`,
    ...READ_WAS,
    `${SDK}/organizations/me.ts:101`,
    `${SDK}/organizations/me.ts:156`,
    `${ROWS}/organizations/operations.ts:151`,
    `${ROWS}/organizations/schema.ts:62`,
    "packages/scenarios/src/acme/s2-the-team-and-its-permissions.scenario.ts:1238",
  ],
  priority: "normal",
  implementedBy: rpc_organizations_workspaces_me,
  acceptance: frozenClaims("org.me"),
  returns: OrgMe,
  errors: [error_CLI_USAGE, error_ROLE_PERMISSION_DENIED],
  refusals: refusalsOf("org.me", [
    [error_ROLE_PERMISSION_DENIED, "?"],
    [error_NOT_AUTHENTICATED, "?"],
  ]),
});
