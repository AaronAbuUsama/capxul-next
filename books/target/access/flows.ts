// Access' Core SDK flows (A4). The CLI's local commands are flows whose steps read and write the
// state the SDK's Node host keeps for this machine in the CLI's settings directory: the sessions
// signed in here, the current person, the environment, the Organization acted for, an agent key's
// store and telemetry consent (decision access.local-flows). The other flows serve surfaces other
// than the CLI and say which: the browser's sign-in (the web app, the approval page and the
// consent page), an SDK host holding an agent's own key, and the assistant consent page.
//
// accounts owns `auth login` and `auth verify` (they answer with the account's setup), as flows over
// access.sign-in.*; the flows here never sign a person in from the CLI.

import { Schema } from "effect";
import { budget, defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { integration_openfort } from "../shared/external.ts";
import {
  error_CANCELLED,
  error_CAPABILITY_UNAVAILABLE,
  error_CLI_STORAGE,
  error_CLI_USAGE,
  error_EXPERIMENTAL_NOT_ACCEPTED,
  error_NOT_AUTHENTICATED,
} from "../shared/vocabulary.ts";
import { rpc_access_assistants_consent, rpc_access_assistants_read_request } from "./assistants.ts";
import { rpc_access_sessions_current, rpc_access_sessions_revoke, rpc_access_sessions_wallet_recovery } from "./sessions.ts";
import {
  rpc_access_sign_in_challenge,
  rpc_access_sign_in_send_code,
  rpc_access_sign_in_verify_code,
  rpc_access_sign_in_with_key,
} from "./sign-in.ts";

const CLI = "apps/cli/src";
const SDK = "packages/sdk/src/access";

const S = Schema.String;
const B = Schema.Boolean;
const Time = Schema.DateTimeUtc;
const Null = Schema.NullOr;

/** A flow that touches only this machine's saved state: a file read or write, no network. */
const LOCAL = { ...budget("read"), p50Ms: 20, p95Ms: 100, why: "local only: one read or write of this machine's saved state, no network" };

const STATE_READ = { name: "read", local: "cache", about: "Reads this machine's saved state; unreadable, unsafe or locked is CLI_STORAGE." } as const;

// ── sign-in on other surfaces ───────────────────────────────────────────────────────────────

export const flow_client_auth_browser_sign_in = defineFlow({
  id: "client.auth.browser.sign-in",
  title: "Sign a person in, in a browser",
  about:
    "Surface: the web app, the approval page and the assistant consent page (React SDK), wherever a browser must know " +
    "the person before they sign an approval or allow an assistant. Sends the code, asks the person for it on the page " +
    "(three tries, as the rpc counts them), signs in, keeps the token in the browser host's store, and readies the " +
    "person's embedded wallet: a recovery session from the backend, then the wallet's address from Openfort.",
  was: [`${SDK}/auth.ts:105`, `${SDK}/auth.ts:118`, "packages/sdk-react/src/access/client-connection.tsx:33", "docs/as-is/archive/access/flows.ts:83"],
  component: component_core_sdk,
  surfaces: ["react"],
  sdk: "client.auth.browser.signIn",
  input: Schema.Struct({ email: S }),
  output: Schema.Struct({ personId: S, email: S, safe: S, expiresAt: Time }),
  steps: [
    { name: "send-code", rpc: rpc_access_sign_in_send_code },
    { name: "ask-code", local: "prompt", about: "The page asks the person for the six-digit code; closing it is CANCELLED." },
    { name: "verify", rpc: rpc_access_sign_in_verify_code, about: "A wrong code asks again while tries are left." },
    { name: "keep", local: "cache", about: "Keeps the session token in the browser host's store." },
    { name: "recovery", rpc: rpc_access_sessions_wallet_recovery },
    { name: "wallet", local: "build", about: "The embedded wallet recovers its key share with that session and reports its address." },
  ],
  errors: [error_CANCELLED],
  calls: [integration_openfort.c.getAddress],
  spans: [],
  budget: budget("vendor"),
});

export const flow_client_auth_key_session = defineFlow({
  id: "client.auth.key-session",
  title: "Open an agent's session with its own key",
  about:
    "Surface: an SDK host that holds an agent's own key (an agent's program built on the Core SDK, created with a local " +
    "key signer). The SDK runs it when the client first needs the backend, and again when the agent's 24-hour session " +
    "nears its end, so the host never handles a token. The key signs locally and never leaves the host.",
  was: ["apps/docs/factory/operations/auth.login.yaml (designed W9: the SDK example)", `${CLI}/auth/own-key.ts:1`],
  component: component_core_sdk,
  surfaces: ["sdk"],
  sdk: "client.auth.keySession",
  input: Schema.Struct({ safe: S }),
  output: Schema.Struct({ personId: S, safe: S, signer: S, owner: S, expiresAt: Time }),
  steps: [
    { name: "challenge", rpc: rpc_access_sign_in_challenge },
    { name: "sign", local: "sign", about: "The agent's key signs the challenge (EIP-191), on this host." },
    { name: "sign-in", rpc: rpc_access_sign_in_with_key },
    { name: "keep", local: "cache", about: "Keeps the token in the host's store and notes when to renew it." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("chain-read"),
});

export const flow_client_auth_assistants_consent = defineFlow({
  id: "client.auth.assistants.consent",
  title: "Allow or decline an assistant, on the consent page",
  about:
    "Surface: Capxul's consent page (React SDK), where an assistant's OAuth client sends the person's browser. A person " +
    "who is not signed in in this browser signs in first (client.auth.browser.signIn). The page shows the client and " +
    "what each scope lets it do, the person decides, and the browser goes back to the client with a code or with " +
    "`access_denied`.",
  was: ["docs/as-is/archive/access/agents.ts:142", "packages/backend/src/access/agents/views/pages.ts:149"],
  component: component_core_sdk,
  surfaces: ["react"],
  sdk: "client.auth.assistants.consent",
  input: Schema.Struct({ request: Schema.Record(S, S) }),
  output: Schema.Struct({ allowed: B, redirectTo: S }),
  steps: [
    { name: "read", rpc: rpc_access_assistants_read_request },
    { name: "decide", local: "prompt", about: "The person allows or declines the client and its scopes." },
    { name: "allow", rpc: rpc_access_assistants_consent, about: "Only when the person allows." },
    { name: "return", local: "build", about: "The redirect back to the client: its code and state, or access_denied." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("write"),
});

// ── the CLI's sign-out and the people signed in here ────────────────────────────────────────

export const flow_client_auth_sign_out = defineFlow({
  id: "client.auth.sign-out",
  title: "Sign out here, then revoke the session",
  about:
    "Finds the person to sign out (the `--email` given, or the current person); with no one signed in it answers " +
    "`email: null`. It deletes the session and that person's saved context on this machine first, then asks the backend " +
    "to revoke the token. The local sign-out always stands: a revoke that fails or does not answer gives " +
    "`remote: unconfirmed`, and a token the backend already refuses counts as confirmed.",
  was: [`${SDK}/auth.ts:151`, `${SDK}/sign-out-revoke.ts:21`, "docs/as-is/archive/access/flows.ts:257", `${CLI}/auth/native-grant-cleanup.ts:66`],
  component: component_core_sdk,
  sdk: "client.auth.signOut",
  input: Schema.Struct({ email: Schema.optionalKey(S) }),
  output: Schema.Struct({ email: Null(S), remote: Null(Schema.Literals(["confirmed", "unconfirmed"])) }),
  steps: [
    STATE_READ,
    { name: "forget", local: "cache", about: "Deletes the person's session and saved context here; a file that cannot be removed is CLI_STORAGE." },
    { name: "revoke", rpc: rpc_access_sessions_revoke, about: "With the token just removed; its outcome sets `remote` only." },
  ],
  errors: [error_CLI_STORAGE],
  calls: [],
  spans: [],
  budget: budget("write"),
});

export const flow_client_auth_switch = defineFlow({
  id: "client.auth.switch",
  title: "Make another person signed in here the current one",
  about:
    "Takes the email given, or at a terminal asks the person to pick one of those signed in here (or to sign someone " +
    "else in, which answers the `capxul auth login` argv to run). A person with no session here is NOT_AUTHENTICATED. " +
    "It checks the session with the backend, which also says whether the person's Safe is set up, and only then makes " +
    "them current.",
  was: [`${CLI}/auth/current-session.ts:1`, `${CLI}/auth/first-party.ts:109`, "apps/docs/factory/operations/auth.switch.yaml"],
  component: component_core_sdk,
  sdk: "client.auth.switch",
  input: Schema.Struct({ email: Schema.optionalKey(S) }),
  output: Schema.Struct({ personId: S, email: Null(S), setupState: Schema.Literals(["ready", "setup-required"]) }),
  steps: [
    STATE_READ,
    { name: "pick", local: "prompt", about: "At a terminal with no email only: the person picks from those signed in here." },
    { name: "check", rpc: rpc_access_sessions_current, about: "The backend still accepts the session; a refusal is NOT_AUTHENTICATED." },
    { name: "make-current", local: "cache", about: "Saves the person as current on this machine." },
  ],
  errors: [error_CLI_STORAGE, error_NOT_AUTHENTICATED],
  calls: [],
  spans: [],
  budget: budget("chain-read"),
});

export const flow_client_auth_list = defineFlow({
  id: "client.auth.list",
  title: "The people signed in on this machine",
  about:
    "Reads the sessions saved on this machine and marks the current one; each says whether it is a person (signs in the " +
    "browser) or an agent (signs with its own key). No network call, so it cannot say whether the backend still accepts " +
    "each session.",
  was: [`${CLI}/auth/current-session.ts:1`, "apps/docs/factory/operations/auth.list.yaml"],
  component: component_core_sdk,
  sdk: "client.auth.list",
  input: Schema.Struct({}),
  output: Schema.Struct({
    current: Null(S),
    people: Schema.Array(Schema.Struct({ email: Null(S), safe: S, kind: Schema.Literals(["person", "agent"]), current: B })),
  }),
  steps: [STATE_READ],
  errors: [error_CLI_STORAGE],
  calls: [],
  spans: [],
  budget: LOCAL,
});

// ── this machine's choices ──────────────────────────────────────────────────────────────────

export const flow_client_use_env = defineFlow({
  id: "client.use.env",
  title: "Save the environment later commands use",
  about:
    "Looks the name up in the deployments this SDK build knows (devnet and staging): one it has no deployment for is " +
    "CAPABILITY_UNAVAILABLE, and production without `acceptExperimental` is EXPERIMENTAL_NOT_ACCEPTED, both before " +
    "anything is saved. Then saves it as this machine's default. Later commands choose `--env`, then `CAPXUL_ENV`, then " +
    "`CAPXUL_BOOTSTRAP_URL` (beside it `CAPXUL_WORLD_GRANT` names a shared world's grant file, which the SDK then sends " +
    "as the bearer of every request to that world's gateway: devnet.shared-world), then this saved choice.",
  was: [`${CLI}/commands/use/subcommands/env/execute.ts:7`, `${CLI}/runtime/environment.ts:1`],
  component: component_core_sdk,
  sdk: "client.use.env",
  input: Schema.Struct({ name: S, acceptExperimental: Schema.optionalKey(B) }),
  output: Schema.Struct({ env: Schema.Struct({ name: S, origin: S }) }),
  steps: [
    { name: "resolve", local: "build", about: "The named environment's deployment in this build, and the production check." },
    { name: "save", local: "cache", about: "Saves the default environment on this machine." },
  ],
  errors: [error_CAPABILITY_UNAVAILABLE, error_EXPERIMENTAL_NOT_ACCEPTED, error_CLI_STORAGE],
  calls: [],
  spans: [],
  budget: LOCAL,
});

export const flow_client_use_personal = defineFlow({
  id: "client.use.personal",
  title: "Act as yourself again",
  about:
    "Forgets the Organization saved for the current environment on this machine, so later commands act for the person. " +
    "`--org` or `CAPXUL_ORG` on one command still acts for that Organization. Nothing changes on the backend.",
  was: [`${CLI}/commands/use/subcommands/personal/execute.ts:1`],
  component: component_core_sdk,
  sdk: "client.use.personal",
  input: Schema.Struct({}),
  output: Schema.Struct({ actingAs: Schema.Struct({ kind: Schema.Literal("personal") }) }),
  steps: [{ name: "forget", local: "cache", about: "Clears the saved Organization for this environment; a file that cannot be written is CLI_STORAGE." }],
  errors: [error_CLI_STORAGE],
  calls: [],
  spans: [],
  budget: LOCAL,
});

export const flow_client_whoami = defineFlow({
  id: "client.whoami",
  title: "Who you are, who you act as, the Safe, the environment and how you sign",
  about:
    "Reads only this machine's saved state. It applies `--email` (that person, without the saved Organization), `--org` " +
    "and `CAPXUL_ORG` (that Organization for this one command) and `--env`, and says where each value came from. " +
    "`signer` is `browser` for a person and `own-key` with its store (`file` or `env`) for an agent: the designed " +
    "`client.me.signer()` is this method's `signer` field (decision access.whoami-signer).",
  was: [`${CLI}/commands/whoami/fast.ts:1`, "apps/docs/factory/operations/whoami.yaml (designed W9)"],
  component: component_core_sdk,
  sdk: "client.whoami",
  input: Schema.Struct({ email: Schema.optionalKey(S), org: Schema.optionalKey(S), env: Schema.optionalKey(S) }),
  output: Schema.Struct({
    user: Null(Schema.Struct({ email: Null(S), handle: Null(S), kind: Schema.Literals(["person", "agent"]) })),
    actingAs: Schema.Struct({ kind: Schema.Literals(["personal", "org"]), handle: Schema.optionalKey(S), source: S }),
    safe: Null(S),
    env: Null(Schema.Struct({ name: S, network: S, source: S })),
    signer: Null(Schema.Union([
      Schema.Struct({ kind: Schema.Literal("browser") }),
      Schema.Struct({ kind: Schema.Literal("own-key"), store: Schema.Literals(["file", "env"]) }),
    ])),
  }),
  steps: [
    STATE_READ,
    { name: "resolve", local: "build", about: "Applies --email, --org, CAPXUL_ORG and --env, and names each value's source." },
  ],
  errors: [error_CLI_STORAGE],
  calls: [],
  spans: [],
  budget: LOCAL,
});

// ── telemetry consent ───────────────────────────────────────────────────────────────────────

const TELEMETRY_ABOUT =
  "The SDK records no span and no event of its own for this method, whatever the consent says, and makes no network call.";
const Telemetry = Schema.Struct({
  enabled: B,
  reason: Schema.Literals(["environment", "disabled", "not_configured", "enabled"]),
});

export const flow_client_config_telemetry_on = defineFlow({
  id: "client.config.telemetry.on",
  title: "Turn telemetry on",
  about: `Saves consent to collect usage and diagnostics on this machine, then reports the status: \`CAPXUL_TELEMETRY_DISABLED\` still forces it off. ${TELEMETRY_ABOUT}`,
  was: [`${CLI}/commands/config/subcommands/on`],
  component: component_core_sdk,
  sdk: "client.config.telemetry.on",
  input: Schema.Struct({}),
  output: Telemetry,
  steps: [
    { name: "save", local: "cache", about: "Saves the preference on; a settings file that cannot be written is CLI_STORAGE." },
    { name: "status", local: "build", about: "Applies CAPXUL_TELEMETRY_DISABLED and whether this build has an endpoint." },
  ],
  errors: [error_CLI_STORAGE],
  calls: [],
  spans: [],
  budget: LOCAL,
});

export const flow_client_config_telemetry_off = defineFlow({
  id: "client.config.telemetry.off",
  title: "Turn telemetry off",
  about: `Saves the preference off on this machine and deletes any records still waiting to be sent, then reports the status. ${TELEMETRY_ABOUT}`,
  was: [`${CLI}/commands/config/subcommands/off`],
  component: component_core_sdk,
  sdk: "client.config.telemetry.off",
  input: Schema.Struct({}),
  output: Telemetry,
  steps: [
    { name: "save", local: "cache", about: "Saves the preference off and deletes queued records; a file that cannot be written is CLI_STORAGE." },
    { name: "status", local: "build", about: "Reports `disabled`, or `environment` while CAPXUL_TELEMETRY_DISABLED is set." },
  ],
  errors: [error_CLI_STORAGE],
  calls: [],
  spans: [],
  budget: LOCAL,
});

export const flow_client_config_telemetry_status = defineFlow({
  id: "client.config.telemetry.status",
  title: "Telemetry status",
  about: `Reads the saved preference (none on a new machine, which collects), applies \`CAPXUL_TELEMETRY_DISABLED\`, and says whether this build has somewhere to send. ${TELEMETRY_ABOUT}`,
  was: [`${CLI}/commands/config/subcommands/status`],
  component: component_core_sdk,
  sdk: "client.config.telemetry.status",
  input: Schema.Struct({}),
  output: Schema.Struct({ stored: Null(B), enabled: B, configured: B, effective: B, reason: Telemetry.fields.reason }),
  steps: [
    { name: "read", local: "cache", about: "The saved preference; a settings file that is unreadable, unsafe or locked is CLI_STORAGE." },
    { name: "status", local: "build", about: "Applies CAPXUL_TELEMETRY_DISABLED and this build's endpoint." },
  ],
  errors: [error_CLI_STORAGE],
  calls: [],
  spans: [],
  budget: LOCAL,
});

// ── the command schema ──────────────────────────────────────────────────────────────────────

export const flow_client_schema = defineFlow({
  id: "client.schema",
  title: "The CLI's command schema",
  about:
    "Reads the command catalogue the SDK ships, generated from the book's operation records: every command with whether " +
    "it moves money, the global flags and the exit codes; or, for the words given (spaced or dotted, `org.payroll.run`), " +
    "that group's commands or that command's arguments, flags, output and errors. `--help` reads the same catalogue, so " +
    "the two agree by construction. A name that is no command or group is CLI_USAGE.",
  was: [`${CLI}/commands/schema/catalog.ts:1`, `${CLI}/commands/schema/execute.ts:1`],
  component: component_core_sdk,
  sdk: "client.schema",
  input: Schema.Struct({ words: Schema.Array(S) }),
  output: Schema.Struct({ commands: Schema.optionalKey(Schema.Array(Schema.Unknown)), command: Schema.optionalKey(Schema.Unknown) }),
  steps: [{ name: "describe", local: "build", about: "Looks the words up in the generated catalogue." }],
  errors: [error_CLI_USAGE],
  calls: [],
  spans: [],
  budget: LOCAL,
});
