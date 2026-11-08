// The old book's Accounts area, as it is: one operation record for every operation that
// apps/docs/factory/areas/accounts.yaml lists, in /home/user/factory (branch integration/factory).
// The text (title, about, who, changes, notes, mistakes, acceptance, refusals' `when`) is the
// book's, built from the frozen text (books/frozen), never retyped.
//
// implementedBy is what the CLI command (apps/cli/src/commands/<group>/...) reaches through the
// SDK method it calls: that method's flow (the owning concept's flows.ts) when the method composes
// several calls or does local work, else the one rpc it reaches (by conventional name, from the
// concept's area file). Eight commands call no SDK method at all: auth list, whoami, use personal,
// use env, config telemetry status|on|off and schema read or write only this machine's CLI state.
// No concept owns that work, so this file books each as a CLI-local flow (component cli, sdk
// "none", local steps only) and the operation names it. waitlist.invites.grant is not a CLI
// command: it is the operator's script packages/backend/scripts/beta-waitlist.ts, which runs the
// internal mutation access.referrals.grant-invites with the deployment's admin key.
//
// returns is a Struct of the page's `returns` fields (fieldsOf). A field's type is the protocol
// row's where the row gives it; otherwise Schema.Unknown (CLI-made fields: the session report,
// hand-overs, local state). Where the CLI prints one of two --json shapes and the page lists the
// fields of both, returns is the Union of one Struct per shape. Where the CLI prints a bare array
// (referral list), returns is that Array, whose item has the page's fields.
//
// errors lists what the CLI command produces itself: CLI_USAGE for every command (the parser
// refuses an unknown flag or argument, apps/cli/src/runtime/errors.ts:256, beside each command's
// own inputRequired refusals); NOT_AUTHENTICATED for every command that restores a session (the
// restore refuses before any network work when no session is stored, apps/cli/src/auth/
// first-party.ts:173, :177); CLI_STORAGE where the command's own work reads or writes CLI state
// files (errors.ts:255); and each command's own CliFailure codes. The generic CLI_DEFECT is not
// listed.
//
// A refusal's `given` names the devnet world (packages/scenarios) from which one runs-today
// scenario step's command reaches it, `?` where none does. A step of a root story (parent null:
// S13, S14, S17, S29, S30) reaches it from the world a run starts from, which the scenarios README
// names `before-s1` (packages/scenarios/README.md:36); a step of S1 after s1.20 reaches it from
// after-s1. No budget: nothing measured these commands. Priority is "normal" throughout: the old
// book ranks no operation.

import { Schema } from "effect";
import { defineFlow, defineOperation } from "../../../packages/book/src/index.ts";
import { frozenClaims, frozenRefusals, frozenReturns, frozenText, type FrozenId } from "../../frozen/index.ts";
import { component_cli } from "../shared/foundation.ts";
import {
  error_CAPABILITY_UNAVAILABLE,
  error_CLI_CONFIG,
  error_CLI_DEADLINE,
  error_CLI_STORAGE,
  error_CLI_USAGE,
  error_EXPERIMENTAL_NOT_ACCEPTED,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NETWORK_ERROR,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_ROLE_PERMISSION_DENIED,
  error_SMART_ACCOUNT_MISSING,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  flow_client_auth_get_session,
  flow_client_auth_sign_in,
  flow_client_auth_sign_out,
  flow_client_auth_verify_otp,
} from "../access/flows.ts";
import { rpc_access_waitlist_join, rpc_access_waitlist_status } from "../access/waitlist.ts";
import {
  rpc_access_referrals_grant_invites,
  rpc_access_referrals_invite,
  rpc_access_referrals_list,
  rpc_access_referrals_show,
} from "../access/referrals.ts";
import { rpc_organizations_workspaces_list } from "../organizations/workspaces.ts";
import {
  flow_client_account_get_lifecycle,
  flow_client_me_agents_create,
  flow_client_me_agents_rotate_key,
} from "../accounts/flows.ts";
import {
  rpc_accounts_agents_freeze,
  rpc_accounts_agents_list,
  rpc_accounts_agents_remove,
  rpc_accounts_agents_show,
  rpc_accounts_agents_sweep,
  rpc_accounts_agents_unfreeze,
} from "../accounts/agents.ts";
import { flow_client_verification_start } from "../parties/flows.ts";
import { rpc_parties_verifications_status } from "../parties/verifications.ts";
import {
  rpc_applications_keys_create,
  rpc_applications_keys_list,
  rpc_applications_keys_revoke,
  rpc_applications_keys_rotate,
} from "../applications/keys.ts";
import { rpc_operator_diagnostics_health } from "../operator/diagnostics.ts";

const BOOK = "apps/docs/factory/operations";
const CLI = "apps/cli/src";
const CMD = `${CLI}/commands`;
const SDK = "packages/sdk/src";
const PROTOCOL = "packages/protocol/src";
const ACME = "packages/scenarios/src/acme";
const S29 = `${ACME}/s29-noor-sets-up-a-new-machine.scenario.ts`;
const S30 = `${ACME}/s30-dana-runs-her-agent.scenario.ts`;
const S14 = `${ACME}/s14-dana-builds-an-app.scenario.ts`;
const S17 = `${ACME}/s17-dana-refers-a-friend.scenario.ts`;

/** The world a root story's steps run from (packages/scenarios/README.md:36). */
const BEFORE_S1 = "before-s1";

// The CLI's own refusals, cited by many records below.
const PARSER = `${CLI}/runtime/errors.ts:256`;
const STORAGE = `${CLI}/runtime/errors.ts:255`;
const NO_SESSION = [`${CLI}/auth/first-party.ts:173`, `${CLI}/auth/first-party.ts:177`];
const CONFIRM = `${CMD}/org/internal/write.ts:40`;

// ── helpers: the frozen page's refusals and returns ─────────────────────────────────────────

const ERRORS = {
  CAPABILITY_UNAVAILABLE: error_CAPABILITY_UNAVAILABLE,
  CLI_CONFIG: error_CLI_CONFIG,
  CLI_DEADLINE: error_CLI_DEADLINE,
  CLI_STORAGE: error_CLI_STORAGE,
  CLI_USAGE: error_CLI_USAGE,
  EXPERIMENTAL_NOT_ACCEPTED: error_EXPERIMENTAL_NOT_ACCEPTED,
  FEATURE_NOT_AVAILABLE: error_FEATURE_NOT_AVAILABLE,
  INVALID_INPUT: error_INVALID_INPUT,
  NETWORK_ERROR: error_NETWORK_ERROR,
  NOT_AUTHENTICATED: error_NOT_AUTHENTICATED,
  PROVIDER_ERROR: error_PROVIDER_ERROR,
  ROLE_PERMISSION_DENIED: error_ROLE_PERMISSION_DENIED,
  SMART_ACCOUNT_MISSING: error_SMART_ACCOUNT_MISSING,
  WRONG_STATE: error_WRONG_STATE,
} as const;
type Code = keyof typeof ERRORS;

/** The page's refusals in its order, `when` verbatim, each on its error record and the world that reaches it. */
const refusals = (id: FrozenId, given: Partial<Record<Code, string>> = {}) =>
  frozenRefusals(id).map(({ code, when }) => {
    if (!(code in ERRORS)) throw new Error(`${id}: no error record for refusal ${code}`);
    return { error: ERRORS[code as Code], given: given[code as Code] ?? "?", when };
  });

/** The page's `returns` fields, Schema.Unknown unless `types` refines one; `only` keeps one --json shape's fields. */
const fieldsOf = (id: FrozenId, types: Record<string, Schema.Top> = {}, only?: readonly string[]) => {
  const page = frozenReturns(id).fields as Record<string, Schema.Top>;
  for (const name of [...Object.keys(types), ...(only ?? [])])
    if (!(name in page)) throw new Error(`${id}: the page returns no field ${name}`);
  const kept = only === undefined ? page : Object.fromEntries(only.map((name) => [name, Schema.Unknown]));
  return { ...kept, ...types };
};

// ── protocol shapes the returns refine ──────────────────────────────────────────────────────
// Transcribed from packages/protocol/src with branded strings and Finite numbers plain.

/** WaitlistStatusSchema (access/operations.ts:102): what access.waitlist.status and .join return. */
const Waitlist = {
  email: Schema.String,
  access: Schema.Literals(["admitted", "open", "waiting"]),
  requestedAt: Schema.NullOr(Schema.Number),
  admittedAt: Schema.NullOr(Schema.Number),
  note: Schema.NullOr(Schema.String),
  referredBy: Schema.optional(Schema.NullOr(Schema.String)),
  invitesLeft: Schema.optional(Schema.Number),
};

/** AGENT_STATES (accounts/agent-schema.ts:29) and an AgentChange's state (agent-schema.ts:58). */
const AgentState = Schema.Literals(["creating", "active", "frozen", "removed", "failed"]);
const ChangeState = Schema.Literals(["waiting", "sent", "landed", "failed"]);

/** AgentOwnerSchema (agent-schema.ts:34). */
const AgentOwner = Schema.Struct({
  kind: Schema.Literal("person"),
  accountId: Schema.NullOr(Schema.String),
  email: Schema.String,
  safe: Schema.String,
});

/** AgentChangeSchema (agent-schema.ts:55) with AgentSweptSchema (:43). */
const Swept = Schema.Struct({ tokenAddress: Schema.String, rawAmount: Schema.String, to: Schema.String });
const AgentChange = Schema.Struct({
  changeId: Schema.String,
  kind: Schema.Literals(["freeze", "unfreeze", "sweep", "remove", "rotate"]),
  state: ChangeState,
  txHash: Schema.NullOr(Schema.String),
  swept: Schema.NullOr(Schema.Array(Swept)),
  sweeps: Schema.optional(Schema.Array(Swept)),
  signer: Schema.optional(Schema.String),
});

/** AgentSchema (agent-schema.ts:71): what accounts.agents.list returns, each. */
const Agent = Schema.Struct({
  agentId: Schema.String,
  name: Schema.String,
  handle: Schema.String,
  accountId: Schema.String,
  safe: Schema.String,
  signer: Schema.String,
  state: AgentState,
  owner: AgentOwner,
  txHash: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  lastChange: Schema.optional(AgentChange),
});

/** AssetPositionSchema (accounts/operations.ts:45): one asset an agent's Safe holds. */
const AssetPosition = Schema.Struct({
  assetId: Schema.String,
  tokenAddress: Schema.String,
  symbol: Schema.String,
  decimals: Schema.Number,
  rawBalance: Schema.String,
  rawAvailableBalance: Schema.String,
});

/** VerificationStatusSchema's status and currencies (parties/verification-schema.ts:61, :78). */
const VerificationState = Schema.Literals([
  "not_started",
  "waiting_people",
  "needs_person",
  "needs_answers",
  "in_review",
  "approved",
  "rejected",
  "restricted",
]);
const VerificationCurrencies = Schema.Array(
  Schema.Struct({
    currency: Schema.Literals(["usd", "eur", "gbp"]),
    status: Schema.Literals(["pending", "approved", "needs_more", "rejected", "restricted"]),
  }),
);

/** A publishable key as its account sees it (applications/operations.ts:41) and a key just made (:61). */
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
const CreatedKey = Schema.Struct({ key: Key, publishableKey: Schema.String });

// ── CLI-local flows: the commands that call no SDK method ───────────────────────────────────
// Each reads or writes only this machine's CLI state (the CLI home folder): no SDK client is
// made and nothing leaves the machine. sdk is "none"; the CLI's own command span is not recorded
// by name in the old code these flows cite, so spans is empty.

export const flow_cli_auth_list = defineFlow({
  id: "cli.auth.list",
  title: "List the people signed in on this machine, from local state only",
  about:
    "The CLI's own work for `capxul auth list`: it lists the session records in the CLI home for the selected environment, " +
    "reads the current-session pointer, and reads whether each person signs as a human or as an AI with its own key. It " +
    "makes no SDK client and no network call, so it cannot say whether the backend still accepts each session. An " +
    "unreadable, unsafe or locked state file is CLI_STORAGE.",
  was: [
    `${CMD}/auth/subcommands/list/execute.ts:14`,
    `${CMD}/auth/subcommands/list/execute.ts:16`,
    `${CMD}/auth/subcommands/list/execute.ts:17`,
    `${CMD}/auth/subcommands/list/execute.ts:20`,
    `${CLI}/auth/first-party-session.ts:115`,
    `${CLI}/auth/current-session.ts:25`,
    `${CLI}/auth/own-key.ts:112`,
    STORAGE,
  ],
  component: component_cli,
  sdk: "none",
  input: Schema.Struct({}),
  output: Schema.Struct({ current: Schema.NullOr(Schema.String), people: Schema.Array(Schema.Unknown) }),
  steps: [
    { name: "sessions", local: "cache", about: "signedInPeople: the emails with a session record for this environment." },
    { name: "pointer", local: "cache", about: "readCurrentSession: the current person, kept only when they still have a record." },
    { name: "kinds", local: "cache", about: "memberKind for each: `human`, or `ai` when an own key is kept for them." },
  ],
  errors: [error_CLI_STORAGE],
  calls: [],
  spans: [],
});

export const flow_cli_whoami = defineFlow({
  id: "cli.whoami",
  title: "Say who acts, for whom, with which Safe and environment, from local state",
  about:
    "The CLI's own work for `capxul whoami`: currentWhere reads the saved choices (person, Organization, Safe, " +
    "environment) and applies this command's `--email`, `--org`, `CAPXUL_ORG` and `--env`, naming where each value came " +
    "from; ownKeyDescription says how the signed-in person signs. It makes no SDK client and no network call. An " +
    "unreadable, unsafe or locked state file is CLI_STORAGE.",
  was: [
    `${CMD}/whoami/command.ts:22`,
    `${CMD}/whoami/execute.ts:10`,
    `${CMD}/whoami/execute.ts:13`,
    `${CMD}/whoami/execute.ts:16`,
    `${CLI}/runtime/where-store.ts:125`,
    `${CLI}/auth/own-key.ts:118`,
    STORAGE,
  ],
  component: component_cli,
  sdk: "none",
  input: Schema.Struct({ email: Schema.optionalKey(Schema.String) }),
  output: Schema.Unknown,
  steps: [
    { name: "where", local: "cache", about: "currentWhere: the saved person, Organization, Safe and environment, with this command's overrides." },
    { name: "signer", local: "cache", about: "ownKeyDescription: browser, or an own key kept in a file or the environment; null when no one is signed in." },
  ],
  errors: [error_CLI_STORAGE],
  calls: [],
  spans: [],
});

export const flow_cli_use_personal = defineFlow({
  id: "cli.use.personal",
  title: "Forget the saved Organization for this environment",
  about:
    "The CLI's own work for `capxul use personal`: updateOrigin clears the saved Organization for the selected " +
    "environment, then the header is shown again. It makes no SDK client and no network call. A state file that cannot " +
    "be read or written is CLI_STORAGE.",
  was: [
    `${CMD}/use/subcommands/personal/execute.ts:8`,
    `${CMD}/use/subcommands/personal/execute.ts:10`,
    `${CMD}/use/internal/shared.ts:15`,
    `${CLI}/runtime/where-store.ts:52`,
    STORAGE,
  ],
  component: component_cli,
  sdk: "none",
  input: Schema.Struct({}),
  output: Schema.Struct({ actingAs: Schema.Struct({ kind: Schema.Literal("personal") }) }),
  steps: [
    { name: "forget", local: "cache", about: "updateOrigin sets the saved org to null for this environment's origin." },
    { name: "header", local: "build", about: "showNewHeader prints who the next command acts as." },
  ],
  errors: [error_CLI_STORAGE],
  calls: [],
  spans: [],
});

export const flow_cli_use_env = defineFlow({
  id: "cli.use.env",
  title: "Save the environment later commands use",
  about:
    "The CLI's own work for `capxul use env <name>`: the command runner loads the named environment's configuration " +
    "first, so production without `--accept-experimental` is EXPERIMENTAL_NOT_ACCEPTED, and production with it, or beta " +
    "with no origin, is CAPABILITY_UNAVAILABLE, before anything is saved. Then updateWhere saves the name and the header " +
    "is shown again. It makes no SDK client and no network call. A state file that cannot be written is CLI_STORAGE.",
  was: [
    `${CMD}/use/subcommands/env/command.ts:16`,
    `${CLI}/runtime/environment.ts:165`,
    `${CLI}/runtime/environment.ts:174`,
    `${CLI}/runtime/environment.ts:181`,
    `${CLI}/runtime/environment-refusal.ts:62`,
    `${CMD}/use/subcommands/env/execute.ts:12`,
    `${CMD}/use/subcommands/env/execute.ts:14`,
    `${CLI}/runtime/where-store.ts:34`,
    STORAGE,
  ],
  component: component_cli,
  sdk: "none",
  input: Schema.Struct({ name: Schema.Literals(["staging", "devnet", "beta", "production"]) }),
  output: Schema.Struct({ env: Schema.Struct({ name: Schema.String, origin: Schema.String }) }),
  steps: [
    { name: "choose", local: "build", about: "The runner resolves the named environment; production and an unprovisioned beta are refused here." },
    { name: "save", local: "cache", about: "updateWhere saves the environment's name for later commands." },
    { name: "header", local: "build", about: "showNewHeader prints who the next command acts as." },
  ],
  errors: [error_EXPERIMENTAL_NOT_ACCEPTED, error_CAPABILITY_UNAVAILABLE, error_CLI_STORAGE],
  calls: [],
  spans: [],
});

export const flow_cli_config_telemetry_status = defineFlow({
  id: "cli.config.telemetry.status",
  title: "Report whether this CLI collects usage and diagnostics",
  about:
    "The CLI's own work for `capxul config telemetry status`: collectionStatus reads the saved preference from the " +
    "settings file and applies CAPXUL_TELEMETRY_DISABLED and whether this build has a delivery target. It makes no SDK " +
    "client and no network call. An unreadable, unsafe or locked settings file is CLI_STORAGE.",
  was: [
    `${CMD}/config/subcommands/status/execute.ts:5`,
    `${CMD}/config/subcommands/shared.ts:23`,
    `${CLI}/runtime/config.ts:267`,
    `${CLI}/platform/state-files.ts:119`,
    STORAGE,
  ],
  component: component_cli,
  sdk: "none",
  input: Schema.Struct({}),
  output: Schema.Struct({
    stored: Schema.NullOr(Schema.Boolean),
    enabled: Schema.Boolean,
    configured: Schema.Boolean,
    effective: Schema.Boolean,
    reason: Schema.Literals(["environment", "disabled", "not_configured", "enabled"]),
  }),
  steps: [{ name: "status", local: "cache", about: "collectionStatus: the saved preference, the environment override and the delivery target." }],
  errors: [error_CLI_STORAGE],
  calls: [],
  spans: [],
});

export const flow_cli_config_telemetry_on = defineFlow({
  id: "cli.config.telemetry.on",
  title: "Save collection on, then report it",
  about:
    "The CLI's own work for `capxul config telemetry on`: setCollectionEnabled(true) writes the settings file, then " +
    "collectionStatus reads it back with CAPXUL_TELEMETRY_DISABLED applied. It makes no SDK client and no network call. " +
    "A settings file that cannot be written is CLI_STORAGE.",
  was: [
    `${CMD}/config/subcommands/on/execute.ts:6`,
    `${CLI}/platform/state-files.ts:262`,
    `${CLI}/runtime/config.ts:267`,
    STORAGE,
  ],
  component: component_cli,
  sdk: "none",
  input: Schema.Struct({}),
  output: Schema.Unknown,
  steps: [
    { name: "save", local: "cache", about: "setCollectionEnabled(true) writes the preference." },
    { name: "status", local: "cache", about: "collectionStatus reads it back." },
  ],
  errors: [error_CLI_STORAGE],
  calls: [],
  spans: [],
});

export const flow_cli_config_telemetry_off = defineFlow({
  id: "cli.config.telemetry.off",
  title: "Save collection off, drop the spool, then report it",
  about:
    "The CLI's own work for `capxul config telemetry off`: setCollectionEnabled(false) writes the settings file, " +
    "clearSpool drops what was waiting to be sent for that settings generation, then collectionStatus reads it back. It " +
    "makes no SDK client and no network call. A settings file that cannot be written is CLI_STORAGE.",
  was: [
    `${CMD}/config/subcommands/off/execute.ts:7`,
    `${CLI}/platform/state-files.ts:262`,
    `${CLI}/observability/journal.ts:106`,
    `${CLI}/runtime/config.ts:267`,
    STORAGE,
  ],
  component: component_cli,
  sdk: "none",
  input: Schema.Struct({}),
  output: Schema.Unknown,
  steps: [
    { name: "save", local: "cache", about: "setCollectionEnabled(false) writes the preference." },
    { name: "spool", local: "cache", about: "clearSpool removes the waiting observations of that settings generation." },
    { name: "status", local: "cache", about: "collectionStatus reads it back." },
  ],
  errors: [error_CLI_STORAGE],
  calls: [],
  spans: [],
});

export const flow_cli_schema = defineFlow({
  id: "cli.schema",
  title: "Describe every command, or one, from the CLI's own command tree",
  about:
    "The CLI's own work for `capxul schema [command…]`: with no words it lists every command with whether it moves money, " +
    "the global flags and the exit codes; with words (spaced or dotted) it describes that command from its own " +
    "definition. A command that does not exist is CLI_USAGE. It makes no SDK client and no network call.",
  was: [
    `${CMD}/schema/command.ts:21`,
    `${CMD}/schema/execute.ts:14`,
    `${CMD}/schema/execute.ts:34`,
    `${CMD}/schema/execute.ts:45`,
  ],
  component: component_cli,
  sdk: "none",
  input: Schema.Struct({ words: Schema.Array(Schema.String) }),
  output: Schema.Unknown,
  steps: [{ name: "describe", local: "build", about: "Walks the root command tree: every listed path, or the one the words name." }],
  errors: [error_CLI_USAGE],
  calls: [],
  spans: [],
});

// ── auth login ──────────────────────────────────────────────────────────────────────────────

// Without a terminal and without --otp-stdin the CLI only sends the code (sendCode: client.auth.getSession, then
// client.auth.signIn) and prints the otp-required hand-over. Otherwise signInWithOtp runs client.auth.getSession,
// client.auth.signIn and client.auth.verifyOtp, then the session report reads client.identity.loadCurrent,
// client.account.getLifecycle and client.smartAccount.loadCurrent; with --own-key it also completes the Profile or
// retries setup and sets the member kind. The book's method is client.auth.signIn, an identity-actor flow (RequestOtp
// through the auth client), so the operation names its flow. The CLI refuses --name/--country/--handle without
// --own-key (command.ts:45), --own-key without --otp-stdin off a terminal (execute.ts:38), a new own-key account
// without all three (:83) and a missing email off a terminal (auth/input.ts:39).
// s14.2: Priya types a wrong code with --otp-stdin and is refused INVALID_INPUT (root story S14).
export const operation_auth_login = defineOperation({
  ...frozenText("auth.login"),
  was: [
    `${BOOK}/auth.login.yaml:1`,
    `${CMD}/auth/subcommands/login/command.ts:30`,
    `${CMD}/auth/subcommands/login/command.ts:45`,
    `${CMD}/auth/subcommands/login/execute.ts:36`,
    `${CMD}/auth/subcommands/login/execute.ts:38`,
    `${CMD}/auth/subcommands/login/execute.ts:46`,
    `${CMD}/auth/subcommands/login/execute.ts:83`,
    `${CMD}/auth/internal/send-code.ts:20`,
    `${CMD}/auth/internal/send-code.ts:22`,
    `${CLI}/auth/otp-sign-in.ts:23`,
    `${CLI}/auth/otp-sign-in.ts:33`,
    `${CLI}/auth/profile-report.ts:36`,
    `${CLI}/auth/input.ts:39`,
    `${SDK}/access/auth.ts:105`,
    `${SDK}/access/otp-programs.ts:139`,
    PARSER,
    `${S14}:328`,
  ],
  priority: "normal",
  implementedBy: flow_client_auth_sign_in,
  acceptance: frozenClaims("auth.login"),
  returns: Schema.Union([
    Schema.Struct(fieldsOf("auth.login", {}, ["authenticated", "email", "journeyId"])),
    Schema.Struct(fieldsOf("auth.login", {}, ["authenticated", "email", "authUserId", "expiresAt", "setupState"])),
  ]),
  errors: [error_CLI_USAGE],
  refusals: refusals("auth.login", { INVALID_INPUT: BEFORE_S1 }),
});

// ── auth verify ─────────────────────────────────────────────────────────────────────────────

// The CLI reads the sign-in `auth login` left waiting (refusing CLI_USAGE when none waits, execute.ts:25, or none for
// the --email given, :33), then calls client.auth.getSession, client.auth.resumeOtp and client.auth.verifyOtp, and
// the same session report as login, adding the journeyId. The book's method is client.auth.verifyOtp: its flow.
export const operation_auth_verify = defineOperation({
  ...frozenText("auth.verify"),
  was: [
    `${BOOK}/auth.verify.yaml:1`,
    `${CMD}/auth/subcommands/verify/command.ts:6`,
    `${CMD}/auth/subcommands/verify/execute.ts:25`,
    `${CMD}/auth/subcommands/verify/execute.ts:33`,
    `${CMD}/auth/subcommands/verify/execute.ts:40`,
    `${CMD}/auth/subcommands/verify/execute.ts:49`,
    `${CMD}/auth/subcommands/verify/execute.ts:58`,
    `${SDK}/access/auth.ts:118`,
    `${SDK}/access/otp-programs.ts:28`,
    PARSER,
  ],
  priority: "normal",
  implementedBy: flow_client_auth_verify_otp,
  acceptance: frozenClaims("auth.verify"),
  returns: Schema.Struct(fieldsOf("auth.verify")),
  errors: [error_CLI_USAGE],
  refusals: refusals("auth.verify"),
});

// ── auth list ───────────────────────────────────────────────────────────────────────────────

// Local only: no SDK method. s29.17: `auth list all` is refused CLI_USAGE by the parser (root story S29).
export const operation_auth_list = defineOperation({
  ...frozenText("auth.list"),
  was: [
    `${BOOK}/auth.list.yaml:1`,
    `${CMD}/auth/subcommands/list/command.ts:5`,
    `${CMD}/auth/subcommands/list/execute.ts:14`,
    PARSER,
    STORAGE,
    `${S29}:458`,
  ],
  priority: "normal",
  implementedBy: flow_cli_auth_list,
  acceptance: frozenClaims("auth.list"),
  returns: Schema.Struct(fieldsOf("auth.list")),
  errors: [error_CLI_USAGE, error_CLI_STORAGE],
  refusals: refusals("auth.list", { CLI_USAGE: BEFORE_S1 }),
});

// ── auth switch ─────────────────────────────────────────────────────────────────────────────

// With no email off a terminal the CLI refuses CLI_USAGE naming who is signed in (pickEmail, execute.ts:28); at a
// terminal "Sign in someone else" runs `auth login` (:59). A named person with no stored session is NOT_AUTHENTICATED
// from the CLI itself (:63); otherwise restoreVerifiedClient checks the session with client.auth.getSession and the
// session report follows. The book's method is client.auth.getSession: its flow.
// s29.14: Noor switches to Dana, who is not signed in on her machine: NOT_AUTHENTICATED (root story S29).
export const operation_auth_switch = defineOperation({
  ...frozenText("auth.switch"),
  was: [
    `${BOOK}/auth.switch.yaml:1`,
    `${CMD}/auth/subcommands/switch/command.ts:6`,
    `${CMD}/auth/subcommands/switch/execute.ts:28`,
    `${CMD}/auth/subcommands/switch/execute.ts:59`,
    `${CMD}/auth/subcommands/switch/execute.ts:63`,
    `${CMD}/auth/subcommands/switch/execute.ts:64`,
    `${CLI}/auth/first-party.ts:111`,
    `${SDK}/access/auth.ts:165`,
    PARSER,
    `${S29}:368`,
  ],
  priority: "normal",
  implementedBy: flow_client_auth_get_session,
  acceptance: frozenClaims("auth.switch"),
  returns: Schema.Struct(fieldsOf("auth.switch")),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("auth.switch", { NOT_AUTHENTICATED: BEFORE_S1 }),
});

// ── auth logout ─────────────────────────────────────────────────────────────────────────────

// The CLI clears the local session first (execute.ts:25), then, with a token, restores a client from the captured
// token, checks it and calls client.auth.signOut; any failure there only makes `remote` "unconfirmed" (:45). An older
// stored native grant is removed and revoked too (:48). The book's method is client.auth.signOut: its flow.
// s29.20: `auth logout now` is refused CLI_USAGE by the parser (root story S29).
export const operation_auth_logout = defineOperation({
  ...frozenText("auth.logout"),
  was: [
    `${BOOK}/auth.logout.yaml:1`,
    `${CMD}/auth/subcommands/logout/command.ts:6`,
    `${CMD}/auth/subcommands/logout/execute.ts:15`,
    `${CMD}/auth/subcommands/logout/execute.ts:25`,
    `${CMD}/auth/subcommands/logout/execute.ts:43`,
    `${CMD}/auth/subcommands/logout/execute.ts:45`,
    `${CMD}/auth/subcommands/logout/execute.ts:48`,
    `${SDK}/access/auth.ts:151`,
    PARSER,
    STORAGE,
    `${S29}:538`,
  ],
  priority: "normal",
  implementedBy: flow_client_auth_sign_out,
  acceptance: frozenClaims("auth.logout"),
  returns: Schema.Struct(fieldsOf("auth.logout")),
  errors: [error_CLI_USAGE, error_CLI_STORAGE],
  refusals: refusals("auth.logout", { CLI_USAGE: BEFORE_S1 }),
});

// ── whoami ──────────────────────────────────────────────────────────────────────────────────

// Local only: no SDK method (runCommand with network false, local true). S13 runs it signed out and signed in, with
// no refusal step.
export const operation_whoami = defineOperation({
  ...frozenText("whoami"),
  was: [`${BOOK}/whoami.yaml:1`, `${CMD}/whoami/command.ts:13`, `${CMD}/whoami/execute.ts:10`, STORAGE],
  priority: "normal",
  implementedBy: flow_cli_whoami,
  acceptance: frozenClaims("whoami"),
  returns: Schema.Struct(fieldsOf("whoami")),
  errors: [error_CLI_USAGE, error_CLI_STORAGE],
  refusals: refusals("whoami"),
});

// ── use personal ────────────────────────────────────────────────────────────────────────────

// Local only. s29.24: `use personal acme` is refused CLI_USAGE by the parser (root story S29).
export const operation_use_personal = defineOperation({
  ...frozenText("use.personal"),
  was: [
    `${BOOK}/use.personal.yaml:1`,
    `${CMD}/use/subcommands/personal/command.ts:7`,
    `${CMD}/use/subcommands/personal/execute.ts:8`,
    PARSER,
    STORAGE,
    `${S29}:619`,
  ],
  priority: "normal",
  implementedBy: flow_cli_use_personal,
  acceptance: frozenClaims("use.personal"),
  returns: Schema.Struct(fieldsOf("use.personal", { actingAs: Schema.Struct({ kind: Schema.Literal("personal") }) })),
  errors: [error_CLI_USAGE, error_CLI_STORAGE],
  refusals: refusals("use.personal", { CLI_USAGE: BEFORE_S1 }),
});

// ── use org ─────────────────────────────────────────────────────────────────────────────────

// The CLI restores the session, lists your Organizations with client.orgs (one rpc: organizations.workspaces.list,
// organizations/adapter.ts:48), finds the handle or ID among them and saves it locally; one you are not in is
// CLI_USAGE from the CLI (execute.ts:29). It grants no authority.
// s1.49: Sam names Analytical Engines, which he is not in: CLI_USAGE. It runs after s1.20 saves after-s1.
export const operation_use_org = defineOperation({
  ...frozenText("use.org"),
  was: [
    `${BOOK}/use.org.yaml:1`,
    `${CMD}/use/subcommands/org/command.ts:7`,
    `${CMD}/use/subcommands/org/execute.ts:19`,
    `${CMD}/use/subcommands/org/execute.ts:21`,
    `${CMD}/use/subcommands/org/execute.ts:29`,
    `${CMD}/use/subcommands/org/execute.ts:39`,
    `${SDK}/organizations/scope.ts:157`,
    `${SDK}/organizations/adapter.ts:48`,
    `${PROTOCOL}/organizations/operations.ts:144`,
    ...NO_SESSION,
    PARSER,
    `${ACME}/s1-acme-is-founded.scenario.ts:2420`,
    `${ACME}/s1-acme-is-founded.scenario.ts:185`,
  ],
  priority: "normal",
  implementedBy: rpc_organizations_workspaces_list,
  acceptance: frozenClaims("use.org"),
  returns: Schema.Struct(fieldsOf("use.org")),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("use.org", { CLI_USAGE: "after-s1" }),
});

// ── use env ─────────────────────────────────────────────────────────────────────────────────

// Local only: the runner loads the environment (and refuses production) before execute saves it.
// s29.22: `use env production` without --accept-experimental: EXPERIMENTAL_NOT_ACCEPTED (root story S29). No step
// reaches CAPABILITY_UNAVAILABLE through `use env`; s1.23 reaches it through `org show --env production`.
export const operation_use_env = defineOperation({
  ...frozenText("use.env"),
  was: [
    `${BOOK}/use.env.yaml:1`,
    `${CMD}/use/subcommands/env/command.ts:8`,
    `${CMD}/use/subcommands/env/command.ts:16`,
    `${CLI}/runtime/environment.ts:174`,
    `${CLI}/runtime/environment.ts:181`,
    `${CLI}/runtime/environment-refusal.ts:62`,
    PARSER,
    STORAGE,
    `${S29}:580`,
  ],
  priority: "normal",
  implementedBy: flow_cli_use_env,
  acceptance: frozenClaims("use.env"),
  returns: Schema.Struct(fieldsOf("use.env", { env: Schema.Struct({ name: Schema.String, origin: Schema.String }) })),
  errors: [error_CLI_USAGE, error_CLI_STORAGE, error_EXPERIMENTAL_NOT_ACCEPTED, error_CAPABILITY_UNAVAILABLE],
  refusals: refusals("use.env", { EXPERIMENTAL_NOT_ACCEPTED: BEFORE_S1 }),
});

// ── agent create ────────────────────────────────────────────────────────────────────────────

// `--org` is refused FEATURE_NOT_AVAILABLE by the CLI before any session (create/execute.ts:37, :48). Otherwise
// client.me.agents.create makes the agent's key on this machine, calls accounts.agents.create with its address only
// and checks the backend named that key and name (agents.ts:200, :138): local work around one rpc, so its flow. The
// CLI keeps the key (file) or prints it once (env), follows the approval and then client.me.agents.wait until the Safe
// is on chain. With --no-wait it prints the hand-over (status, approvalId, approvalUrl, expiresAt, agent, key)
// instead; the page lists only the followed shape.
export const operation_agent_create = defineOperation({
  ...frozenText("agent.create"),
  was: [
    `${BOOK}/agent.create.yaml:1`,
    `${CMD}/agent/subcommands/create/command.ts:32`,
    `${CMD}/agent/subcommands/create/execute.ts:37`,
    `${CMD}/agent/subcommands/create/execute.ts:48`,
    `${CMD}/agent/subcommands/create/execute.ts:53`,
    `${CMD}/agent/subcommands/create/execute.ts:93`,
    `${CMD}/agent/subcommands/create/execute.ts:155`,
    `${SDK}/accounts/agents.ts:200`,
    `${SDK}/accounts/agents.ts:138`,
    `${PROTOCOL}/accounts/agent-operations.ts:48`,
    `${PROTOCOL}/accounts/agent-schema.ts:71`,
    ...NO_SESSION,
    PARSER,
  ],
  priority: "normal",
  implementedBy: flow_client_me_agents_create,
  acceptance: frozenClaims("agent.create"),
  returns: Schema.Struct(
    fieldsOf("agent.create", {
      agentId: Schema.String,
      name: Schema.String,
      handle: Schema.String,
      accountId: Schema.String,
      safe: Schema.String,
      state: AgentState,
      owner: Schema.Struct({ kind: Schema.Literal("person"), accountId: Schema.NullOr(Schema.String), email: Schema.String }),
    }),
  ),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED, error_FEATURE_NOT_AVAILABLE],
  refusals: refusals("agent.create"),
});

// ── agent show ──────────────────────────────────────────────────────────────────────────────

// client.me.agents.show forwards one rpc, accounts.agents.show (agents.ts:227); the CLI prints the AgentDetail.
// s30.6: Sam asks for Dana's Ledger: ROLE_PERMISSION_DENIED (root story S30).
export const operation_agent_show = defineOperation({
  ...frozenText("agent.show"),
  was: [
    `${BOOK}/agent.show.yaml:1`,
    `${CMD}/agent/subcommands/show/command.ts:13`,
    `${CMD}/agent/subcommands/show/execute.ts:19`,
    `${CMD}/agent/subcommands/show/execute.ts:21`,
    `${SDK}/accounts/agents.ts:227`,
    `${PROTOCOL}/accounts/agent-operations.ts:78`,
    `${PROTOCOL}/accounts/agent-schema.ts:213`,
    ...NO_SESSION,
    PARSER,
    `${S30}:296`,
  ],
  priority: "normal",
  implementedBy: rpc_accounts_agents_show,
  acceptance: frozenClaims("agent.show"),
  returns: Schema.Struct(
    fieldsOf("agent.show", {
      agentId: Schema.String,
      handle: Schema.String,
      accountId: Schema.String,
      safe: Schema.String,
      signer: Schema.String,
      state: AgentState,
      owner: AgentOwner,
      positions: Schema.Array(AssetPosition),
    }),
  ),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("agent.show", { ROLE_PERMISSION_DENIED: BEFORE_S1 }),
});

// ── agent list ──────────────────────────────────────────────────────────────────────────────

// client.me.agents.list forwards one rpc, accounts.agents.list (agents.ts:254); the CLI prints { agents }.
export const operation_agent_list = defineOperation({
  ...frozenText("agent.list"),
  was: [
    `${BOOK}/agent.list.yaml:1`,
    `${CMD}/agent/subcommands/list/command.ts:6`,
    `${CMD}/agent/subcommands/list/execute.ts:13`,
    `${CMD}/agent/subcommands/list/execute.ts:15`,
    `${SDK}/accounts/agents.ts:254`,
    `${PROTOCOL}/accounts/agent-operations.ts:149`,
    ...NO_SESSION,
    PARSER,
  ],
  priority: "normal",
  implementedBy: rpc_accounts_agents_list,
  acceptance: frozenClaims("agent.list"),
  returns: Schema.Struct(fieldsOf("agent.list", { agents: Schema.Array(Agent) })),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("agent.list"),
});

// ── agent freeze ────────────────────────────────────────────────────────────────────────────

// client.me.agents.freeze forwards one rpc, accounts.agents.freeze, and reshapes its answer as a pending change
// (agents.ts:228, :156). The CLI follows the approval, then client.me.agents.wait until `frozen` (internal/change.ts).
// s30.8: Dana freezes Ledger again: WRONG_STATE, currentState frozen (root story S30).
export const operation_agent_freeze = defineOperation({
  ...frozenText("agent.freeze"),
  was: [
    `${BOOK}/agent.freeze.yaml:1`,
    `${CMD}/agent/subcommands/freeze/command.ts:15`,
    `${CMD}/agent/subcommands/freeze/execute.ts:9`,
    `${CMD}/agent/internal/change.ts:114`,
    `${SDK}/accounts/agents.ts:228`,
    `${PROTOCOL}/accounts/agent-operations.ts:90`,
    ...NO_SESSION,
    PARSER,
    `${S30}:338`,
  ],
  priority: "normal",
  implementedBy: rpc_accounts_agents_freeze,
  acceptance: frozenClaims("agent.freeze"),
  returns: Schema.Struct(fieldsOf("agent.freeze", { agentId: Schema.String, handle: Schema.String, state: AgentState })),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("agent.freeze", { WRONG_STATE: BEFORE_S1 }),
});

// ── agent unfreeze ──────────────────────────────────────────────────────────────────────────

// client.me.agents.unfreeze forwards one rpc, accounts.agents.unfreeze (agents.ts:229); the CLI follows it to `active`.
// s30.10: Dana unfreezes an active Ledger: WRONG_STATE, currentState active (root story S30).
export const operation_agent_unfreeze = defineOperation({
  ...frozenText("agent.unfreeze"),
  was: [
    `${BOOK}/agent.unfreeze.yaml:1`,
    `${CMD}/agent/subcommands/unfreeze/command.ts:15`,
    `${CMD}/agent/subcommands/unfreeze/execute.ts:9`,
    `${CMD}/agent/internal/change.ts:114`,
    `${SDK}/accounts/agents.ts:229`,
    `${PROTOCOL}/accounts/agent-operations.ts:97`,
    ...NO_SESSION,
    PARSER,
    `${S30}:378`,
  ],
  priority: "normal",
  implementedBy: rpc_accounts_agents_unfreeze,
  acceptance: frozenClaims("agent.unfreeze"),
  returns: Schema.Struct(fieldsOf("agent.unfreeze", { agentId: Schema.String, handle: Schema.String, state: AgentState })),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("agent.unfreeze", { WRONG_STATE: BEFORE_S1 }),
});

// ── agent key rotate ────────────────────────────────────────────────────────────────────────

// client.me.agents.rotateKey makes the new key on this machine, calls accounts.agents.rotateKey with its address and
// refuses an answer naming another key (agent-keys.ts:43, :52): local work around one rpc, so its flow. The CLI keeps
// the waiting key, follows the approval and client.me.agents.waitChange, then keeps the new key alone.
// s30.15: Dana rotates removed Ledger's key: WRONG_STATE. s30.18: Sam rotates Dana's Scout: ROLE_PERMISSION_DENIED.
export const operation_agent_key_rotate = defineOperation({
  ...frozenText("agent.key.rotate"),
  was: [
    `${BOOK}/agent.key.rotate.yaml:1`,
    `${CMD}/agent/subcommands/key/command.ts:24`,
    `${CMD}/agent/internal/rotate.ts:40`,
    `${CMD}/agent/internal/rotate.ts:133`,
    `${CMD}/agent/internal/rotate.ts:149`,
    `${SDK}/accounts/agents.ts:249`,
    `${SDK}/accounts/agent-keys.ts:43`,
    `${SDK}/accounts/agent-keys.ts:52`,
    `${PROTOCOL}/accounts/agent-operations.ts:142`,
    `${PROTOCOL}/accounts/agent-schema.ts:185`,
    ...NO_SESSION,
    PARSER,
    `${S30}:530`,
    `${S30}:616`,
  ],
  priority: "normal",
  implementedBy: flow_client_me_agents_rotate_key,
  acceptance: frozenClaims("agent.key.rotate"),
  returns: Schema.Struct(
    fieldsOf("agent.key.rotate", {
      agentId: Schema.String,
      handle: Schema.String,
      changeId: Schema.String,
      state: ChangeState,
      txHash: Schema.NullOr(Schema.String),
      oldSigner: Schema.String,
      signer: Schema.String,
    }),
  ),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("agent.key.rotate", { ROLE_PERMISSION_DENIED: BEFORE_S1, WRONG_STATE: BEFORE_S1 }),
});

// ── agent sweep ─────────────────────────────────────────────────────────────────────────────

// client.me.agents.sweep forwards one rpc, accounts.agents.sweep, reshaped as a pending change (agents.ts:230,
// agent-changes.ts:40). The CLI follows the approval and waitChange, then names each swept token's symbol.
// s30.12: Dana sweeps an empty Ledger: WRONG_STATE, currentState empty (root story S30).
export const operation_agent_sweep = defineOperation({
  ...frozenText("agent.sweep"),
  was: [
    `${BOOK}/agent.sweep.yaml:1`,
    `${CMD}/agent/subcommands/sweep/command.ts:25`,
    `${CMD}/agent/internal/sweep.ts:38`,
    `${CMD}/agent/internal/sweep.ts:107`,
    `${CMD}/agent/internal/sweep.ts:113`,
    `${SDK}/accounts/agents.ts:230`,
    `${SDK}/accounts/agent-changes.ts:40`,
    `${PROTOCOL}/accounts/agent-operations.ts:112`,
    ...NO_SESSION,
    PARSER,
    `${S30}:455`,
  ],
  priority: "normal",
  implementedBy: rpc_accounts_agents_sweep,
  acceptance: frozenClaims("agent.sweep"),
  returns: Schema.Struct(
    fieldsOf("agent.sweep", {
      agentId: Schema.String,
      handle: Schema.String,
      state: ChangeState,
      txHash: Schema.NullOr(Schema.String),
      swept: Schema.Array(
        Schema.Struct({
          tokenAddress: Schema.String,
          rawAmount: Schema.String,
          to: Schema.String,
          symbol: Schema.optionalKey(Schema.String),
          decimals: Schema.optionalKey(Schema.Number),
        }),
      ),
    }),
  ),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("agent.sweep", { WRONG_STATE: BEFORE_S1 }),
});

// ── agent remove ────────────────────────────────────────────────────────────────────────────

// Off a terminal the CLI refuses CLI_USAGE without --confirm, before any session (remove.ts:35, write.ts:40).
// client.me.agents.remove forwards one rpc, accounts.agents.remove, reshaped as a pending change (agents.ts:248,
// agent-changes.ts:69). The CLI follows it to `removed` and reports each token's landed raw amount.
// s30.14: Dana removes Ledger again: WRONG_STATE, currentState removed (root story S30).
export const operation_agent_remove = defineOperation({
  ...frozenText("agent.remove"),
  was: [
    `${BOOK}/agent.remove.yaml:1`,
    `${CMD}/agent/subcommands/remove/command.ts:17`,
    `${CMD}/agent/internal/remove.ts:35`,
    `${CMD}/agent/internal/remove.ts:45`,
    `${CMD}/agent/internal/remove.ts:107`,
    `${CMD}/agent/internal/remove.ts:122`,
    CONFIRM,
    `${SDK}/accounts/agents.ts:248`,
    `${SDK}/accounts/agent-changes.ts:69`,
    `${PROTOCOL}/accounts/agent-operations.ts:126`,
    ...NO_SESSION,
    PARSER,
    `${S30}:514`,
  ],
  priority: "normal",
  implementedBy: rpc_accounts_agents_remove,
  acceptance: frozenClaims("agent.remove"),
  returns: Schema.Struct(
    fieldsOf("agent.remove", {
      agentId: Schema.String,
      handle: Schema.String,
      state: AgentState,
      txHash: Schema.NullOr(Schema.String),
      swept: Schema.Array(
        Schema.Struct({
          symbol: Schema.String,
          decimals: Schema.Number,
          tokenAddress: Schema.String,
          rawAmount: Schema.String,
        }),
      ),
    }),
  ),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("agent.remove", { WRONG_STATE: BEFORE_S1 }),
});

// ── account show ────────────────────────────────────────────────────────────────────────────

// client.account.getLifecycle reads the Account's status (accounts.safes.loadByAuthUserId) and, when ready, the
// balance read for its id, then maps the lifecycle (account-setup.ts:18): several calls, so its flow. The CLI prints
// { lifecycle }, a failed one reduced to its step and error code (account/internal/presentation.ts:35).
// s14.1: Noor, never signed in on this machine, asks for her account: NOT_AUTHENTICATED (root story S14).
export const operation_account_show = defineOperation({
  ...frozenText("account.show"),
  was: [
    `${BOOK}/account.show.yaml:1`,
    `${CMD}/account/subcommands/show/command.ts:6`,
    `${CMD}/account/subcommands/show/execute.ts:14`,
    `${CMD}/account/internal/presentation.ts:35`,
    `${SDK}/accounts/account.ts:118`,
    `${SDK}/accounts/account-setup.ts:18`,
    ...NO_SESSION,
    PARSER,
    `${S14}:313`,
  ],
  priority: "normal",
  implementedBy: flow_client_account_get_lifecycle,
  acceptance: frozenClaims("account.show"),
  returns: Schema.Struct(fieldsOf("account.show")),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("account.show", { NOT_AUTHENTICATED: BEFORE_S1 }),
});

// ── account retry ───────────────────────────────────────────────────────────────────────────

// The CLI runs the session report (client.identity.loadCurrent, client.account.getLifecycle,
// client.smartAccount.loadCurrent) and, when not ready, the setup hand-over; it starts no setup and opens no browser.
// The book's method is client.account.getLifecycle: its flow.
// s14.13: Noor asks where to finish setup without signing in: NOT_AUTHENTICATED (root story S14).
export const operation_account_retry = defineOperation({
  ...frozenText("account.retry"),
  was: [
    `${BOOK}/account.retry.yaml:1`,
    `${CMD}/account/subcommands/retry/command.ts:6`,
    `${CMD}/account/subcommands/retry/execute.ts:18`,
    `${CLI}/auth/profile-report.ts:18`,
    `${CLI}/auth/profile-report.ts:49`,
    `${SDK}/accounts/account.ts:118`,
    ...NO_SESSION,
    PARSER,
    `${S14}:502`,
  ],
  priority: "normal",
  implementedBy: flow_client_account_get_lifecycle,
  acceptance: frozenClaims("account.retry"),
  returns: Schema.Struct(fieldsOf("account.retry")),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("account.retry", { NOT_AUTHENTICATED: BEFORE_S1 }),
});

// ── waitlist status ─────────────────────────────────────────────────────────────────────────

// client.waitlist.status forwards one rpc, access.waitlist.status (waitlist.ts:38); the CLI prints the WaitlistStatus.
// s29.32: Noor asks after signing out: NOT_AUTHENTICATED (root story S29).
export const operation_waitlist_status = defineOperation({
  ...frozenText("waitlist.status"),
  was: [
    `${BOOK}/waitlist.status.yaml:1`,
    `${CMD}/waitlist/subcommands/status/command.ts:15`,
    `${CMD}/waitlist/subcommands/status/execute.ts:15`,
    `${SDK}/access/waitlist.ts:38`,
    `${PROTOCOL}/access/operations.ts:124`,
    `${PROTOCOL}/access/operations.ts:102`,
    ...NO_SESSION,
    PARSER,
    `${S29}:803`,
  ],
  priority: "normal",
  implementedBy: rpc_access_waitlist_status,
  acceptance: frozenClaims("waitlist.status"),
  returns: Schema.Struct(fieldsOf("waitlist.status", Waitlist)),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("waitlist.status", { NOT_AUTHENTICATED: BEFORE_S1 }),
});

// ── waitlist join ───────────────────────────────────────────────────────────────────────────

// client.waitlist.join forwards one rpc, access.waitlist.join (waitlist.ts:47); the CLI prints the whole
// WaitlistStatus, of which the page lists five fields.
// s14.12: Dana's 501-character note: INVALID_INPUT (root story S14).
export const operation_waitlist_join = defineOperation({
  ...frozenText("waitlist.join"),
  was: [
    `${BOOK}/waitlist.join.yaml:1`,
    `${CMD}/waitlist/subcommands/join/command.ts:15`,
    `${CMD}/waitlist/subcommands/join/execute.ts:23`,
    `${SDK}/access/waitlist.ts:47`,
    `${PROTOCOL}/access/operations.ts:131`,
    ...NO_SESSION,
    PARSER,
    `${S14}:489`,
  ],
  priority: "normal",
  implementedBy: rpc_access_waitlist_join,
  acceptance: frozenClaims("waitlist.join"),
  returns: Schema.Struct(
    fieldsOf("waitlist.join", {
      email: Waitlist.email,
      access: Waitlist.access,
      requestedAt: Waitlist.requestedAt,
      note: Waitlist.note,
      referredBy: Waitlist.referredBy,
    }),
  ),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("waitlist.join", { INVALID_INPUT: BEFORE_S1 }),
});

// ── referral ────────────────────────────────────────────────────────────────────────────────

// client.referral.show forwards one rpc, access.referrals.show (referrals.ts:39), a mutation: it makes the code on
// first use.
export const operation_referral_show = defineOperation({
  ...frozenText("referral.show"),
  was: [
    `${BOOK}/referral.show.yaml:1`,
    `${CMD}/referral/command.ts:19`,
    `${CMD}/referral/execute.ts:15`,
    `${SDK}/access/referrals.ts:39`,
    `${PROTOCOL}/access/operations.ts:182`,
    `${PROTOCOL}/access/operations.ts:151`,
    ...NO_SESSION,
    PARSER,
  ],
  priority: "normal",
  implementedBy: rpc_access_referrals_show,
  acceptance: frozenClaims("referral.show"),
  returns: Schema.Struct(
    fieldsOf("referral.show", {
      code: Schema.String,
      link: Schema.String,
      invitesLeft: Schema.Number,
      counts: Schema.Struct({
        attributed: Schema.Number,
        admitted: Schema.Number,
        qualified: Schema.Number,
        rewarded: Schema.Number,
      }),
    }),
  ),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("referral.show"),
});

// ── referral invite ─────────────────────────────────────────────────────────────────────────

// client.referral.invite forwards one rpc, access.referrals.invite (referrals.ts:48).
// S17: Noor, still waiting, invites Rex: FEATURE_NOT_AVAILABLE for beta-access (root story S17).
export const operation_referral_invite = defineOperation({
  ...frozenText("referral.invite"),
  was: [
    `${BOOK}/referral.invite.yaml:1`,
    `${CMD}/referral/subcommands/invite/command.ts:15`,
    `${CMD}/referral/subcommands/invite/execute.ts:18`,
    `${SDK}/access/referrals.ts:48`,
    `${PROTOCOL}/access/operations.ts:189`,
    `${PROTOCOL}/access/operations.ts:164`,
    ...NO_SESSION,
    PARSER,
    `${S17}:184`,
  ],
  priority: "normal",
  implementedBy: rpc_access_referrals_invite,
  acceptance: frozenClaims("referral.invite"),
  returns: Schema.Struct(
    fieldsOf("referral.invite", { email: Schema.String, access: Schema.Literal("admitted"), invitesLeft: Schema.Number }),
  ),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("referral.invite", { FEATURE_NOT_AVAILABLE: BEFORE_S1 }),
});

// ── referral list ───────────────────────────────────────────────────────────────────────────

// client.referral.list forwards one rpc, access.referrals.list (referrals.ts:61). The CLI prints the bare array
// (list/execute.ts:20); the page lists one item's fields.
export const operation_referral_list = defineOperation({
  ...frozenText("referral.list"),
  was: [
    `${BOOK}/referral.list.yaml:1`,
    `${CMD}/referral/subcommands/list/command.ts:15`,
    `${CMD}/referral/subcommands/list/execute.ts:15`,
    `${CMD}/referral/subcommands/list/execute.ts:20`,
    `${SDK}/access/referrals.ts:61`,
    `${PROTOCOL}/access/operations.ts:196`,
    `${PROTOCOL}/access/operations.ts:170`,
    ...NO_SESSION,
    PARSER,
  ],
  priority: "normal",
  implementedBy: rpc_access_referrals_list,
  acceptance: frozenClaims("referral.list"),
  returns: Schema.Array(
    Schema.Struct(
      fieldsOf("referral.list", {
        email: Schema.String,
        via: Schema.Literals(["link", "invite"]),
        stage: Schema.Literals(["attributed", "admitted", "qualified", "rewarded", "voided"]),
        attributedAt: Schema.Number,
        admittedAt: Schema.NullOr(Schema.Number),
        qualifiedAt: Schema.NullOr(Schema.Number),
      }),
    ),
  ),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("referral.list"),
});

// ── waitlist invites grant ──────────────────────────────────────────────────────────────────

// Not a CLI command: the operator runs packages/backend/scripts/beta-waitlist.ts with the deployment's admin key; it
// runs the internal mutation access.referrals.grantInvites through `convex run` (beta-waitlist.ts:84, :107). The
// script's own usage refusal prints the usage and exits 2 with no error code (:98), so `errors` is empty. Its answer
// ({ email, invitesLeft }, grant-invites.ts:44) has no protocol row: the fields stay Schema.Unknown.
// S17: the operator grants to `dana-at-acme.test`: INVALID_INPUT (root story S17).
export const operation_waitlist_invites_grant = defineOperation({
  ...frozenText("waitlist.invites.grant"),
  was: [
    `${BOOK}/waitlist.invites.grant.yaml:1`,
    "packages/backend/scripts/beta-waitlist.ts:64",
    "packages/backend/scripts/beta-waitlist.ts:84",
    "packages/backend/scripts/beta-waitlist.ts:98",
    "packages/backend/scripts/beta-waitlist.ts:107",
    "packages/backend/src/access/referrals/operations/grant-invites.ts:20",
    "packages/backend/src/access/referrals/operations/grant-invites.ts:28",
    "packages/backend/src/access/referrals/operations/grant-invites.ts:44",
    `${S17}:347`,
  ],
  priority: "normal",
  implementedBy: rpc_access_referrals_grant_invites,
  acceptance: frozenClaims("waitlist.invites.grant"),
  returns: Schema.Struct(fieldsOf("waitlist.invites.grant")),
  errors: [],
  refusals: refusals("waitlist.invites.grant", { INVALID_INPUT: BEFORE_S1 }),
});

// ── verify start ────────────────────────────────────────────────────────────────────────────

// The CLI acts for the saved Organization with client.org(id).verification, else client.verification
// (verify/internal/client.ts:13). client.verification.start calls parties.verifications.start, or uploads each file
// and calls parties.verifications.answer, then parties.verifications.invite for people (verifications.ts:173): several
// calls, so its flow. The CLI loops over the steps, prompting at a terminal, and refuses a bad --input itself
// (verify/internal/input.ts).
// s29.12: `--input` with an unknown key: CLI_USAGE (root story S29).
export const operation_verify_start = defineOperation({
  ...frozenText("verify.start"),
  was: [
    `${BOOK}/verify.start.yaml:1`,
    `${CMD}/verify/subcommands/start/command.ts:14`,
    `${CMD}/verify/subcommands/start/execute.ts:44`,
    `${CMD}/verify/subcommands/start/execute.ts:151`,
    `${CMD}/verify/internal/client.ts:13`,
    `${CMD}/verify/internal/input.ts:46`,
    `${CMD}/verify/internal/input.ts:64`,
    `${CMD}/verify/internal/input.ts:80`,
    `${CMD}/verify/internal/input.ts:125`,
    `${CMD}/verify/internal/presentation.ts:92`,
    `${SDK}/parties/verifications.ts:173`,
    `${PROTOCOL}/parties/operations.ts:57`,
    `${PROTOCOL}/parties/verification-schema.ts:78`,
    ...NO_SESSION,
    PARSER,
    `${S29}:327`,
  ],
  priority: "normal",
  implementedBy: flow_client_verification_start,
  acceptance: frozenClaims("verify.start"),
  returns: Schema.Struct(
    fieldsOf("verify.start", { status: VerificationState, journeyId: Schema.String, currencies: VerificationCurrencies }),
  ),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("verify.start", { CLI_USAGE: BEFORE_S1 }),
});

// ── verify status ───────────────────────────────────────────────────────────────────────────

// client.verification.status forwards one rpc, parties.verifications.status, and checks the answer is for its target
// (verifications.ts:232). With --wait, or at a terminal on a person step, the CLI reads it again every interval until
// it changes; past --timeout-seconds that is CLI_DEADLINE from the CLI (verify/internal/wait.ts:56).
// s29.7: Noor asks before signing in: NOT_AUTHENTICATED (root story S29).
export const operation_verify_status = defineOperation({
  ...frozenText("verify.status"),
  was: [
    `${BOOK}/verify.status.yaml:1`,
    `${CMD}/verify/subcommands/status/command.ts:12`,
    `${CMD}/verify/subcommands/status/execute.ts:19`,
    `${CMD}/verify/subcommands/status/execute.ts:29`,
    `${CMD}/verify/internal/wait.ts:39`,
    `${CMD}/verify/internal/wait.ts:56`,
    `${SDK}/parties/verifications.ts:232`,
    `${PROTOCOL}/parties/operations.ts:65`,
    ...NO_SESSION,
    PARSER,
    `${S29}:204`,
  ],
  priority: "normal",
  implementedBy: rpc_parties_verifications_status,
  acceptance: frozenClaims("verify.status"),
  returns: Schema.Struct(fieldsOf("verify.status", { status: VerificationState, currencies: VerificationCurrencies })),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED, error_CLI_DEADLINE],
  refusals: refusals("verify.status", { NOT_AUTHENTICATED: BEFORE_S1 }),
});

// ── key list ────────────────────────────────────────────────────────────────────────────────

// client.account.keys.list (with --org, client.org(id).keys.list) forwards one rpc, applications.keys.list
// (applications/keys.ts:93). As is, the CLI prints { items } and, only when there are none, `next`: the
// `capxul key create` command line (list/execute.ts:18), not where a next page starts; it never pages.
// s29.30: Noor lists keys after signing out: NOT_AUTHENTICATED (root story S29).
export const operation_key_list = defineOperation({
  ...frozenText("key.list"),
  was: [
    `${BOOK}/key.list.yaml:1`,
    `${CMD}/key/subcommands/list/command.ts:7`,
    `${CMD}/key/subcommands/list/execute.ts:10`,
    `${CMD}/key/subcommands/list/execute.ts:13`,
    `${CMD}/key/subcommands/list/execute.ts:18`,
    `${SDK}/applications/keys.ts:93`,
    `${PROTOCOL}/applications/operations.ts:100`,
    `${PROTOCOL}/applications/operations.ts:41`,
    ...NO_SESSION,
    PARSER,
    `${S29}:756`,
  ],
  priority: "normal",
  implementedBy: rpc_applications_keys_list,
  acceptance: frozenClaims("key.list"),
  returns: Schema.Struct(fieldsOf("key.list", { items: Schema.Array(Key), next: Schema.optionalKey(Schema.String) })),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("key.list", { NOT_AUTHENTICATED: BEFORE_S1 }),
});

// ── key create ──────────────────────────────────────────────────────────────────────────────

// client.account.keys.create forwards one rpc, applications.keys.create (applications/keys.ts:84). The CLI checks
// --app and the scope (CLI_USAGE) and re-raises the backend's WRONG_STATE as its own CliFailure naming the 20-key
// limit and `key list` (create/execute.ts:13, :39).
// s14.6: Dana's wildcard origin: INVALID_INPUT (root story S14).
export const operation_key_create = defineOperation({
  ...frozenText("key.create"),
  was: [
    `${BOOK}/key.create.yaml:1`,
    `${CMD}/key/subcommands/create/command.ts:7`,
    `${CMD}/key/subcommands/create/execute.ts:13`,
    `${CMD}/key/subcommands/create/execute.ts:25`,
    `${CMD}/key/subcommands/create/execute.ts:29`,
    `${CMD}/key/subcommands/create/execute.ts:39`,
    `${CMD}/request/internal/read.ts:11`,
    `${SDK}/applications/keys.ts:84`,
    `${PROTOCOL}/applications/operations.ts:89`,
    `${PROTOCOL}/applications/operations.ts:61`,
    ...NO_SESSION,
    PARSER,
    `${S14}:399`,
  ],
  priority: "normal",
  implementedBy: rpc_applications_keys_create,
  acceptance: frozenClaims("key.create"),
  returns: Schema.Struct(fieldsOf("key.create", { key: Key, publishableKey: Schema.String })),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED, error_WRONG_STATE],
  refusals: refusals("key.create", { INVALID_INPUT: BEFORE_S1 }),
});

// ── key rotate ──────────────────────────────────────────────────────────────────────────────

// The CLI refuses a bad --grace and, off a terminal, a missing --confirm with CLI_USAGE before any session
// (rotate/execute.ts:25, :36), then client.account.keys.rotate forwards one rpc, applications.keys.rotate.
// s14.8: Dana rotates the old key again: WRONG_STATE (root story S14).
export const operation_key_rotate = defineOperation({
  ...frozenText("key.rotate"),
  was: [
    `${BOOK}/key.rotate.yaml:1`,
    `${CMD}/key/subcommands/rotate/command.ts:7`,
    `${CMD}/key/subcommands/rotate/execute.ts:25`,
    `${CMD}/key/subcommands/rotate/execute.ts:36`,
    `${CMD}/key/subcommands/rotate/execute.ts:49`,
    CONFIRM,
    `${SDK}/applications/keys.ts:94`,
    `${PROTOCOL}/applications/operations.ts:110`,
    ...NO_SESSION,
    PARSER,
    `${S14}:431`,
  ],
  priority: "normal",
  implementedBy: rpc_applications_keys_rotate,
  acceptance: frozenClaims("key.rotate"),
  returns: Schema.Struct(fieldsOf("key.rotate", { active: CreatedKey, retired: Key })),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("key.rotate", { WRONG_STATE: BEFORE_S1 }),
});

// ── key revoke ──────────────────────────────────────────────────────────────────────────────

// Off a terminal the CLI refuses a missing --confirm with CLI_USAGE before any session (revoke/execute.ts:16), then
// client.account.keys.revoke forwards one rpc, applications.keys.revoke; the CLI prints the revoked Key.
// s14.10: Dana revokes a key that is not hers: NOT_AUTHENTICATED (root story S14).
export const operation_key_revoke = defineOperation({
  ...frozenText("key.revoke"),
  was: [
    `${BOOK}/key.revoke.yaml:1`,
    `${CMD}/key/subcommands/revoke/command.ts:7`,
    `${CMD}/key/subcommands/revoke/execute.ts:16`,
    `${CMD}/key/subcommands/revoke/execute.ts:28`,
    CONFIRM,
    `${SDK}/applications/keys.ts:95`,
    `${PROTOCOL}/applications/operations.ts:117`,
    ...NO_SESSION,
    PARSER,
    `${S14}:460`,
  ],
  priority: "normal",
  implementedBy: rpc_applications_keys_revoke,
  acceptance: frozenClaims("key.revoke"),
  returns: Schema.Struct(fieldsOf("key.revoke", { id: Schema.String, state: Key.fields.state })),
  errors: [error_CLI_USAGE, error_NOT_AUTHENTICATED],
  refusals: refusals("key.revoke", { NOT_AUTHENTICATED: BEFORE_S1 }),
});

// ── doctor ──────────────────────────────────────────────────────────────────────────────────

// Without --online doctor reads only local state. With --online it needs CAPXUL_PUBLISHABLE_KEY (CLI_CONFIG,
// probe.ts:13), makes a client and calls client.system.health with this run's nonce: one rpc,
// operator.diagnostics.health (operator/diagnostics.ts:49). The CLI refuses an answer without its nonce
// (PROVIDER_ERROR, probe.ts:48), and its own deadline, or the SDK's read deadline passing first, is NETWORK_ERROR
// with exit 124 (execute.ts:30, :50).
// s29.26: `doctor --deep` is refused CLI_USAGE by the parser (root story S29).
export const operation_doctor = defineOperation({
  ...frozenText("doctor"),
  was: [
    `${BOOK}/doctor.yaml:1`,
    `${CMD}/doctor/command.ts:14`,
    `${CMD}/doctor/execute.ts:11`,
    `${CMD}/doctor/execute.ts:17`,
    `${CMD}/doctor/execute.ts:30`,
    `${CMD}/doctor/execute.ts:50`,
    `${CMD}/doctor/internal/probe.ts:13`,
    `${CMD}/doctor/internal/probe.ts:48`,
    `${SDK}/operator/diagnostics.ts:49`,
    `${PROTOCOL}/operator/operations.ts:64`,
    PARSER,
    `${S29}:667`,
  ],
  priority: "normal",
  implementedBy: rpc_operator_diagnostics_health,
  acceptance: frozenClaims("doctor"),
  returns: Schema.Struct(fieldsOf("doctor")),
  errors: [error_CLI_USAGE, error_CLI_CONFIG, error_NETWORK_ERROR, error_PROVIDER_ERROR],
  refusals: refusals("doctor", { CLI_USAGE: BEFORE_S1 }),
});

// ── config telemetry status | on | off ──────────────────────────────────────────────────────

// Local only. s29.6, s29.4 and s29.5: each given an argument is refused CLI_USAGE by the parser (root story S29).
export const operation_config_telemetry_status = defineOperation({
  ...frozenText("config.telemetry.status"),
  was: [
    `${BOOK}/config.telemetry.status.yaml:1`,
    `${CMD}/config/subcommands/status/command.ts:5`,
    `${CMD}/config/subcommands/status/execute.ts:5`,
    PARSER,
    STORAGE,
    `${S29}:185`,
  ],
  priority: "normal",
  implementedBy: flow_cli_config_telemetry_status,
  acceptance: frozenClaims("config.telemetry.status"),
  returns: Schema.Struct(fieldsOf("config.telemetry.status")),
  errors: [error_CLI_USAGE, error_CLI_STORAGE],
  refusals: refusals("config.telemetry.status", { CLI_USAGE: BEFORE_S1 }),
});

export const operation_config_telemetry_on = defineOperation({
  ...frozenText("config.telemetry.on"),
  was: [
    `${BOOK}/config.telemetry.on.yaml:1`,
    `${CMD}/config/subcommands/on/command.ts:5`,
    `${CMD}/config/subcommands/on/execute.ts:6`,
    PARSER,
    STORAGE,
    `${S29}:147`,
  ],
  priority: "normal",
  implementedBy: flow_cli_config_telemetry_on,
  acceptance: frozenClaims("config.telemetry.on"),
  returns: Schema.Struct(fieldsOf("config.telemetry.on")),
  errors: [error_CLI_USAGE, error_CLI_STORAGE],
  refusals: refusals("config.telemetry.on", { CLI_USAGE: BEFORE_S1 }),
});

export const operation_config_telemetry_off = defineOperation({
  ...frozenText("config.telemetry.off"),
  was: [
    `${BOOK}/config.telemetry.off.yaml:1`,
    `${CMD}/config/subcommands/off/command.ts:5`,
    `${CMD}/config/subcommands/off/execute.ts:7`,
    PARSER,
    STORAGE,
    `${S29}:166`,
  ],
  priority: "normal",
  implementedBy: flow_cli_config_telemetry_off,
  acceptance: frozenClaims("config.telemetry.off"),
  returns: Schema.Struct(fieldsOf("config.telemetry.off")),
  errors: [error_CLI_USAGE, error_CLI_STORAGE],
  refusals: refusals("config.telemetry.off", { CLI_USAGE: BEFORE_S1 }),
});

// ── schema ──────────────────────────────────────────────────────────────────────────────────

// Local only. As is, `schema <command>` prints the described command as the whole data, not under a `command` key,
// and with no words prints { version, describe, globalFlags, exitCodes, commands } (schema/execute.ts:25, :53).
// s29.28: `schema nothing.here` is refused CLI_USAGE (root story S29).
export const operation_schema = defineOperation({
  ...frozenText("schema"),
  was: [
    `${BOOK}/schema.yaml:1`,
    `${CMD}/schema/command.ts:13`,
    `${CMD}/schema/execute.ts:25`,
    `${CMD}/schema/execute.ts:45`,
    `${CMD}/schema/execute.ts:53`,
    PARSER,
    `${S29}:715`,
  ],
  priority: "normal",
  implementedBy: flow_cli_schema,
  acceptance: frozenClaims("schema"),
  returns: Schema.Struct(fieldsOf("schema")),
  errors: [error_CLI_USAGE],
  refusals: refusals("schema", { CLI_USAGE: BEFORE_S1 }),
});
