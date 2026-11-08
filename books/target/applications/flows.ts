// Applications' Core SDK flows (A4): one per operation that composes rpcs and local steps, and the
// browser's bootstrap. `key create` and `key list` are one rpc each, so they have no flow. `key rotate`
// and `key revoke` ask at a terminal before their one write (the prompt is the host's: a `wait.person`
// span, never system time); `doctor` reads this machine's setup and, with `--online`, bootstraps and
// asks the deployment; `dev key` mints and writes `.env.local`. `createCapxulClient` serves the web
// surfaces, not the CLI (decision applications.flows).

import { Schema } from "effect";
import { budget, defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import {
  error_CANCELLED,
  error_CLI_STORAGE,
  error_INVALID_INPUT,
  error_NETWORK_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_WRONG_ENVIRONMENT,
} from "../shared/vocabulary.ts";
import { Envelope, rpc_applications_bootstraps_resolve } from "./bootstraps.ts";
import { rpc_applications_health_check } from "./health.ts";
import { CreatedKey, Key, Owner, rpc_applications_keys_revoke, rpc_applications_keys_rotate } from "./keys.ts";
import { MintedKey, rpc_applications_quickstarts_mint } from "./quickstarts.ts";

const CLI = "apps/cli/src/commands";
const SDK = "packages/sdk/src";

const S = Schema.String;
const B = Schema.Boolean;
const N = Schema.Number;

/** A guided write: at a terminal the host asks first; the one rpc is the system time. */
const GUIDED = { ...budget("write"), excludes: ["wait.person"] };

const confirm = (shows: string) =>
  ({
    name: "confirm",
    local: "prompt",
    about: `Only at a terminal without \`confirm\`: shows the account, the key and ${shows}, and asks; a decline is CANCELLED and writes nothing.`,
  }) as const;

// ── doctor ──────────────────────────────────────────────────────────────────────────────────

export const DoctorReport = Schema.Struct({
  runtime: Schema.Struct({ nodeVersion: S, platform: S }),
  application: Schema.Struct({
    configured: B,
    /** The environment the key's bootstrap targets: `devnet`, `staging`, or `custom` for another origin. */
    target: S,
    bootstrapOrigin: S,
  }),
  network: Schema.Union([
    Schema.Struct({ status: Schema.Literal("not_checked") }),
    Schema.Struct({ status: Schema.Literal("ok"), deployment: S, commit: Schema.NullOr(S), backendAt: N, durationMs: N }),
  ]),
  collection: Schema.Struct({
    enabled: B,
    reason: Schema.Literals(["enabled", "environment", "disabled", "not_configured"]),
  }),
});

export const flow_client_system_health = defineFlow({
  id: "client.system.health",
  title: "Check this machine's setup and, online, the deployment and its key",
  about:
    "Reads this machine's setup: the Node version and platform, whether a publishable key is configured and the " +
    "environment it targets, and whether telemetry is on and why. Without `online` it makes no network call. With it, " +
    "inside one deadline of at most 15 s that starts after the local reads: the bootstrap resolves the key (no Origin, " +
    "as a Node host), then the health check at the backend the envelope names, with this run's nonce. The deployment " +
    "counts as reached only when the answer echoes that nonce (else PROVIDER_RESPONSE_INVALID). The deadline passing, " +
    "or no answer, is NETWORK_ERROR with mode `timeout`, which the CLI exits 124 with (decision applications.doctor-exit).",
  was: [`${CLI}/doctor/execute.ts:9`, `${CLI}/doctor/internal/probe.ts:19`, `${CLI}/doctor/internal/report.ts:6`, `${SDK}/operator/diagnostics.ts:49`],
  component: component_core_sdk,
  sdk: "client.system.health",
  input: Schema.Struct({
    online: B,
    /** The CLI's configured key (CAPXUL_PUBLISHABLE_KEY); required with `online`. */
    publishableKey: Schema.optionalKey(S),
    /** This run's identifier, which the backend must echo. */
    nonce: S,
    /** 1 to 15,000; 15,000 when absent. */
    timeoutMs: Schema.optionalKey(Schema.Int),
  }),
  output: DoctorReport,
  steps: [
    { name: "local", local: "cache", about: "Reads the runtime, the configured key and its target, and telemetry consent from this machine." },
    { name: "bootstrap", rpc: rpc_applications_bootstraps_resolve, about: "Only with `online`: the configured key, with no Origin." },
    { name: "health", rpc: rpc_applications_health_check, about: "Only with `online`: this run's nonce, at the envelope's backend." },
    { name: "check", local: "build", about: "Only with `online`: requires the nonce echoed and measures the round trip from before the bootstrap." },
  ],
  errors: [error_NETWORK_ERROR, error_PROVIDER_RESPONSE_INVALID],
  calls: [],
  spans: [],
  budget: {
    ...budget("read"),
    p50Ms: 1_000,
    p95Ms: 2_000,
    why: "with `online`, two backend calls in sequence: the bootstrap, then the health check at the backend it names",
  },
});

// ── key rotate, key revoke ──────────────────────────────────────────────────────────────────

export const flow_client_account_keys_rotate = defineFlow({
  id: "client.account.keys.rotate",
  title: "Rotate a publishable key, asking first at a terminal",
  about:
    "At a terminal it shows the account, the key and the grace window and asks; from a script `confirm` is required (the " +
    "CLI refuses without it before restoring a session) and nothing is asked. Then one call. The owner is the input, so " +
    "one method serves a person's keys and an Organization's (`--org`); the old `client.org(id).keys` twin goes.",
  was: [`${CLI}/key/subcommands/rotate/execute.ts:25`, `${SDK}/applications/keys.ts:94`],
  component: component_core_sdk,
  sdk: "client.account.keys.rotate",
  input: Schema.Struct({ owner: Owner, keyId: S, graceMs: Schema.Int, confirm: Schema.optionalKey(B) }),
  output: Schema.Struct({ active: CreatedKey, retired: Key }),
  steps: [confirm("the grace window"), { name: "rotate", rpc: rpc_applications_keys_rotate }],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: GUIDED,
});

export const flow_client_account_keys_revoke = defineFlow({
  id: "client.account.keys.revoke",
  title: "Revoke a publishable key, asking first at a terminal",
  about:
    "At a terminal it shows the account and the key, says that apps using it stop at their next sign-in and that it " +
    "cannot be undone, and asks; from a script `confirm` is required (the CLI refuses without it before restoring a " +
    "session). Then one call.",
  was: [`${CLI}/key/subcommands/revoke/execute.ts:12`, `${SDK}/applications/keys.ts:95`],
  component: component_core_sdk,
  sdk: "client.account.keys.revoke",
  input: Schema.Struct({ owner: Owner, keyId: S, confirm: Schema.optionalKey(B) }),
  output: Schema.Struct({ id: S, state: Schema.Literal("revoked") }),
  steps: [confirm("that apps using it stop at their next sign-in"), { name: "revoke", rpc: rpc_applications_keys_revoke }],
  errors: [error_CANCELLED],
  calls: [],
  spans: [],
  budget: GUIDED,
});

// ── dev key ─────────────────────────────────────────────────────────────────────────────────

export const flow_client_dev_key = defineFlow({
  id: "client.dev.key",
  title: "Mint a test key and write it to `.env.local`",
  about:
    "In the Core SDK's Node-only test entry, not the public client (decision applications.dev-key-flow). The environment " +
    "this machine targets must be a devnet or staging (WRONG_ENVIRONMENT). Unless `print`, it reads `.env.local` in the " +
    "given folder, following links, and checks it can write it before it mints, so a failed write spends no key " +
    "(CLI_STORAGE). Then the mint, and unless `print`, sets `NEXT_PUBLIC_CAPXUL_PUBLISHABLE_KEY` and `CAPXUL_SITE_URL` " +
    "through a temporary file renamed over `.env.local`, so a write that fails part-way leaves it whole, and every other " +
    "line is kept.",
  was: [`${CLI}/dev/key.ts:31`, `${CLI}/dev/key.ts:65`, `${CLI}/dev/key.ts:189`, `${CLI}/dev/key.ts:211`],
  component: component_core_sdk,
  sdk: "client.dev.key",
  input: Schema.Struct({
    /** A local http(s) origin; `http://localhost:3000` when absent. */
    origin: Schema.optionalKey(S),
    print: B,
    /** The folder whose `.env.local` it writes: the CLI's working folder. */
    folder: S,
  }),
  output: Schema.Struct({ ...MintedKey.fields, origin: S, envFile: Schema.NullOr(S) }),
  steps: [
    { name: "environment", local: "build", about: "The environment this machine targets must be a devnet or staging; else WRONG_ENVIRONMENT before anything else." },
    { name: "check", local: "cache", about: "Unless `print`: reads `.env.local` and checks it can be written; else CLI_STORAGE before any mint." },
    { name: "mint", rpc: rpc_applications_quickstarts_mint },
    { name: "write", local: "cache", about: "Unless `print`: sets the two values through a temporary file renamed over `.env.local`, keeping every other line." },
  ],
  errors: [error_WRONG_ENVIRONMENT, error_CLI_STORAGE],
  calls: [],
  spans: [],
  budget: budget("write"),
});

// ── the browser's bootstrap ─────────────────────────────────────────────────────────────────

export const flow_create_capxul_client = defineFlow({
  id: "create-capxul-client",
  title: "Create a client: resolve the publishable key into a bootstrap envelope",
  about:
    "Surface: a developer's web app and Capxul's own web app, approval page and consent page (React SDK), and any SDK " +
    "host given a publishable key. The key must be `cap_pk_(test|live)_` and 32 Crockford characters (INVALID_INPUT); in " +
    "a browser the origin is the page's. A host-supplied cache is read first: an envelope it holds that decodes and " +
    "ends more than 30 s from now is used with no request. Otherwise it bootstraps, retrying a transient answer twice; " +
    "no answer is NETWORK_ERROR, an envelope that does not decode PROVIDER_RESPONSE_INVALID. It keeps the envelope and " +
    "sends its origin token with every backend request, and bootstraps again before the envelope ends.",
  was: ["books/as-is/applications/flows.ts:27", `${SDK}/platform/production.ts:135`, `${SDK}/applications/bootstrap-adapter.ts:50`],
  component: component_core_sdk,
  surfaces: ["react", "sdk"],
  sdk: "createCapxulClient",
  input: Schema.Struct({
    publishableKey: S,
    /** A host's load and save of the last envelope. */
    bootstrapCache: Schema.optionalKey(Schema.Unknown),
    /** The signer, fetch and telemetry ports: the host's, not this concept's. */
    rest: Schema.optionalKey(Schema.Unknown),
  }),
  output: Schema.Struct({ envelope: Envelope, client: Schema.Unknown }),
  steps: [
    { name: "input", local: "build", about: "Checks the key's form; a browser takes the page's origin." },
    { name: "cache", local: "cache", about: "With a host cache: reuses a stored envelope that decodes and ends more than 30 s from now." },
    { name: "bootstrap", rpc: rpc_applications_bootstraps_resolve, about: "The key and the page's Origin; up to two retries of a transient answer." },
    { name: "keep", local: "cache", about: "Decodes the envelope, saves it to the host cache and keeps its origin token for every backend request." },
  ],
  errors: [error_INVALID_INPUT, error_NETWORK_ERROR, error_PROVIDER_RESPONSE_INVALID],
  calls: [],
  spans: [],
  budget: budget("write"),
});
