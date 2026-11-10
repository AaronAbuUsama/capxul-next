// The frozen operations access designs (OPERATION_OWNERS): the CLI's sign-out, the people signed in
// on this machine, and the commands that touch only this machine's CLI state. Each is built from its
// frozen text (frozenText), with its acceptance as claims (P1) and one Core SDK flow behind it (A4).
// `auth login` and `auth verify` are accounts' (they answer with the account's setup).
//
// Worlds named in `given` are devnet snapshots taken with the eval machine's CLI home (decision
// access.worlds): empty-devnet, person-signed-in, two-people-signed-in.

import { Schema } from "effect";
import { ADDRESS, ID, NORTHWIND, PEOPLE, ok, refused } from "../shared/examples.ts";
import { budget, defineOperation } from "../../packages/blueprint-engine/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../baseline/index.ts";
import {
  error_CAPABILITY_UNAVAILABLE,
  error_CLI_STORAGE,
  error_CLI_USAGE,
  error_EXPERIMENTAL_NOT_ACCEPTED,
  error_NOT_AUTHENTICATED,
} from "../shared/vocabulary.ts";
import {
  flow_client_auth_list,
  flow_client_auth_sign_out,
  flow_client_auth_switch,
  flow_client_config_telemetry_off,
  flow_client_config_telemetry_on,
  flow_client_config_telemetry_status,
  flow_client_schema,
  flow_client_use_env,
  flow_client_use_personal,
  flow_client_whoami,
} from "./flows.ts";

const S = Schema.String;
const B = Schema.Boolean;
const Null = Schema.NullOr;

/** A frozen acceptance line kept word for word, with what observes it and its old test citation. */
const keep = (id: FrozenId, n: number, observes: string) => {
  const line = frozen[id].acceptance[n - 1] as { claim: string; was: readonly string[] };
  return { claim: line.claim, observes, was: [...line.was] };
};

/** A frozen line rewritten as an observable claim: the old line and its citation move to `was` (P1). */
const rewrite = (id: FrozenId, n: number, claim: string, observes: string) => {
  const line = frozen[id].acceptance[n - 1] as { claim: string; was: readonly string[] };
  return { claim, observes, was: [line.claim, ...line.was] };
};

/** An operation that touches only this machine: the CLI's start and one file, no network. */
const LOCAL = {
  ...budget("read"),
  p50Ms: 300,
  p95Ms: 600,
  why: "local only: the CLI's start (300 ms target) and one read or write of this machine's state, no network",
};

const storage = (given: string, when: string) => ({ error: error_CLI_STORAGE, given, when });
const noArgument = (given: string) => ({ error: error_CLI_USAGE, given, when: "It is given an argument; it takes none." });

// ── the people signed in here ───────────────────────────────────────────────────────────────

export const operation_auth_list = defineOperation({
  ...frozenText("auth.list"),
  priority: "normal",
  implementedBy: flow_client_auth_list,
  acceptance: [
    keep("auth.list", 1, "cli: with two people signed in on the eval's machine, the `--json` result lists both, and exactly one has `current: true`, the one last made current."),
  ],
  returns: Schema.Struct({
    current: Null(S),
    people: Schema.Array(Schema.Struct({ email: Null(S), safe: S, kind: Schema.Literals(["person", "agent"]), current: B })),
  }),
  errors: [error_CLI_USAGE],
  refusals: [
    storage("two-people-signed-in", "The saved sessions on this machine are unreadable, unsafe or locked: the eval makes the state file unreadable after the world is restored."),
    noArgument("empty-devnet"),
  ],
  examples: [
    ok("Two people are signed in on this machine", "capxul auth list --json", {
      current: PEOPLE.hannah.email,
      people: [
        { email: PEOPLE.hannah.email, safe: ADDRESS.hannah, kind: "person", current: true },
        { email: PEOPLE.marcus.email, safe: ADDRESS.marcus, kind: "person", current: false },
      ],
    }),
    refused("The saved sessions cannot be read", "capxul auth list --json", error_CLI_STORAGE),
    refused("An argument is given; it takes none", "capxul auth list hannah --json", error_CLI_USAGE),
  ],
  budget: LOCAL,
});

export const operation_auth_logout = defineOperation({
  ...frozenText("auth.logout"),
  priority: "normal",
  implementedBy: flow_client_auth_sign_out,
  acceptance: [
    rewrite(
      "auth.logout",
      1,
      "It removes the current person's session on this machine, and the backend refuses that session's token afterwards.",
      "cli: `auth list` no longer lists the person and the result says `remote: confirmed`. world: the person's session goes from active to revoked. trace: one session_transitioned with transition revoke.",
    ),
  ],
  returns: Schema.Struct({
    authenticated: Schema.Literal(false),
    email: Null(S),
    remote: Null(Schema.Literals(["confirmed", "unconfirmed"])),
  }),
  errors: [error_CLI_USAGE],
  refusals: [
    storage("person-signed-in", "The saved session on this machine cannot be read or removed: the eval makes the state file unreadable after the world is restored."),
    noArgument("person-signed-in"),
  ],
  examples: [
    ok("Sign out the current person", "capxul auth logout --json", { authenticated: false, email: PEOPLE.hannah.email, remote: "confirmed" }),
    ok("Sign out a named person; the backend could not confirm the revoke", `capxul auth logout --email ${PEOPLE.marcus.email} --json`, { authenticated: false, email: PEOPLE.marcus.email, remote: "unconfirmed" }),
    refused("The saved session cannot be removed", "capxul auth logout --json", error_CLI_STORAGE),
  ],
  budget: budget("write"),
});

export const operation_auth_switch = defineOperation({
  ...frozenText("auth.switch"),
  priority: "normal",
  implementedBy: flow_client_auth_switch,
  acceptance: [
    keep("auth.switch", 1, "cli: after `capxul auth switch sam@acme.test` on a machine where Dana is current, `capxul auth list --json` marks Sam current and only Sam."),
  ],
  returns: Schema.Struct({
    authenticated: Schema.Literal(true),
    email: Null(S),
    authUserId: S,
    setupState: Schema.Literals(["ready", "setup-required"]),
  }),
  errors: [error_CLI_USAGE],
  refusals: [
    {
      error: error_CLI_USAGE,
      given: "two-people-signed-in",
      when: "No email was named in a script, an agent or a `--json` run. The refusal names who is signed in here.",
    },
    {
      error: error_NOT_AUTHENTICATED,
      given: "two-people-signed-in",
      when: "The person named is not signed in on this machine, or the backend no longer accepts their session.",
    },
  ],
  examples: [
    ok("Switch to Marcus, who is signed in here", `capxul auth switch ${PEOPLE.marcus.email} --json`, { authenticated: true, email: PEOPLE.marcus.email, authUserId: ID.marcus, setupState: "ready" }),
    refused("No email named in a --json run", "capxul auth switch --json", error_CLI_USAGE),
    refused("Priya is not signed in on this machine", `capxul auth switch ${PEOPLE.priya.email} --json`, error_NOT_AUTHENTICATED),
  ],
  budget: budget("chain-read"),
});

// ── telemetry consent ───────────────────────────────────────────────────────────────────────

const Telemetry = Schema.Struct({
  enabled: B,
  reason: Schema.Literals(["environment", "disabled", "not_configured", "enabled"]),
});
const NOTHING_RECORDED = "trace: the local collector receives no span and no event from the command.";

export const operation_config_telemetry_off = defineOperation({
  ...frozenText("config.telemetry.off"),
  priority: "normal",
  implementedBy: flow_client_config_telemetry_off,
  acceptance: [
    keep("config.telemetry.off", 1, NOTHING_RECORDED),
    keep("config.telemetry.off", 2, "cli: `config telemetry status --json` then answers `stored: false` and `enabled: false`."),
    keep("config.telemetry.off", 3, "cli: with the settings file made read-only, the command exits 2 with code CLI_STORAGE."),
  ],
  returns: Telemetry,
  errors: [error_CLI_USAGE],
  refusals: [
    storage("empty-devnet", "The settings file on this machine cannot be written: the eval makes it read-only."),
    noArgument("empty-devnet"),
  ],
  examples: [
    ok("Turn collection off", "capxul config telemetry off --json", { enabled: false, reason: "disabled" }),
    refused("The settings file is read-only", "capxul config telemetry off --json", error_CLI_STORAGE),
  ],
  budget: LOCAL,
});

export const operation_config_telemetry_on = defineOperation({
  ...frozenText("config.telemetry.on"),
  priority: "normal",
  implementedBy: flow_client_config_telemetry_on,
  acceptance: [
    keep("config.telemetry.on", 1, NOTHING_RECORDED),
    keep("config.telemetry.on", 2, "cli: after `config telemetry off`, `on` answers `enabled: true` and `status` reads `stored: true`."),
    keep("config.telemetry.on", 3, "cli: with CAPXUL_TELEMETRY_DISABLED set, `on` answers `enabled: false` with `reason: environment`, and so does `status`."),
    keep("config.telemetry.on", 4, "cli: with the settings file made read-only, the command exits 2 with code CLI_STORAGE."),
  ],
  returns: Telemetry,
  errors: [error_CLI_USAGE],
  refusals: [
    storage("empty-devnet", "The settings file on this machine cannot be written: the eval makes it read-only."),
    noArgument("empty-devnet"),
  ],
  examples: [
    ok("Turn collection on", "capxul config telemetry on --json", { enabled: true, reason: "enabled" }),
    refused("An argument is given; it takes none", "capxul config telemetry on now --json", error_CLI_USAGE),
  ],
  budget: LOCAL,
});

export const operation_config_telemetry_status = defineOperation({
  ...frozenText("config.telemetry.status"),
  priority: "normal",
  implementedBy: flow_client_config_telemetry_status,
  acceptance: [
    keep("config.telemetry.status", 1, `cli: it answers with the network off. ${NOTHING_RECORDED}`),
    keep("config.telemetry.status", 2, "cli: on a fresh CLI home it answers `stored: null`, `enabled: true`."),
    keep("config.telemetry.status", 3, "cli: a build with no telemetry endpoint answers `configured: false`, `effective: false`, `reason: not_configured`."),
  ],
  returns: Schema.Struct({
    stored: Null(B),
    enabled: B,
    configured: B,
    effective: B,
    reason: Schema.Literals(["environment", "disabled", "not_configured", "enabled"]),
  }),
  errors: [error_CLI_USAGE],
  refusals: [
    storage("empty-devnet", "The settings file on this machine is unreadable, unsafe or locked: the eval makes it unreadable."),
    noArgument("empty-devnet"),
  ],
  examples: [
    ok("Collection is on and this build can send it", "capxul config telemetry status --json", { stored: true, enabled: true, configured: true, effective: true, reason: "enabled" }),
    ok("The environment forces collection off", "capxul config telemetry status --json", { stored: true, enabled: false, configured: true, effective: false, reason: "environment" }),
    refused("The settings file is unreadable", "capxul config telemetry status --json", error_CLI_STORAGE),
  ],
  budget: LOCAL,
});

// ── the command schema ──────────────────────────────────────────────────────────────────────

export const operation_schema = defineOperation({
  ...frozenText("schema"),
  priority: "normal",
  implementedBy: flow_client_schema,
  acceptance: [
    keep("schema", 1, "cli: the commands `schema --json` lists are exactly those `--help` lists, each with `movesMoney`."),
    keep("schema", 2, "cli: `schema payment send --json` gives the arguments, flags, output and error codes that command's own definition has."),
    keep("schema", 3, "cli: `schema org` lists the group's commands; `schema no such` exits 2 with CLI_USAGE."),
    keep("schema", 4, "cli: `schema org.payroll.run` answers the same as `schema org payroll run`."),
  ],
  returns: Schema.Struct({
    commands: Schema.optionalKey(Schema.Array(Schema.Unknown)),
    command: Schema.optionalKey(Schema.Unknown),
  }),
  errors: [error_CLI_USAGE],
  refusals: [{ error: error_CLI_USAGE, given: "empty-devnet", when: "The command named does not exist." }],
  examples: [
    ok("Describe one command", "capxul schema payment send --json", {
      command: { name: "payment send", movesMoney: true, arguments: ["to", "amount"], flags: ["--asset", "--from", "--note", "--on", "--at"], errors: ["INSUFFICIENT_BALANCE", "INVALID_RECIPIENT", "NOT_AUTHENTICATED"] },
    }),
    ok("List every command", "capxul schema --json", {
      commands: [
        { name: "payment send", movesMoney: true },
        { name: "payment list", movesMoney: false },
        { name: "whoami", movesMoney: false },
      ],
    }),
    refused("A command that does not exist", "capxul schema payment teleport --json", error_CLI_USAGE),
  ],
  budget: LOCAL,
});

// ── this machine's environment and acting-as ────────────────────────────────────────────────

export const operation_use_env = defineOperation({
  ...frozenText("use.env"),
  priority: "normal",
  implementedBy: flow_client_use_env,
  acceptance: [
    keep("use.env", 1, "cli: after `capxul use env devnet`, `capxul whoami --json` answers `env.name: devnet` with `source: saved`, and a network command reaches the devnet."),
  ],
  returns: Schema.Struct({ env: Schema.Struct({ name: S, origin: S }) }),
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_EXPERIMENTAL_NOT_ACCEPTED, given: "empty-devnet", when: "Production without `--accept-experimental`." },
    { error: error_CAPABILITY_UNAVAILABLE, given: "empty-devnet", when: "This CLI has no deployment for that environment (beta, or production with the flag)." },
  ],
  examples: [
    ok("Choose the devnet", "capxul use env devnet --json", { env: { name: "devnet", origin: "http://localhost:3000" } }),
    refused("Production without accepting that it is experimental", "capxul use env production --json", error_EXPERIMENTAL_NOT_ACCEPTED),
    refused("An environment this CLI has no deployment for", "capxul use env beta --json", error_CAPABILITY_UNAVAILABLE),
  ],
  budget: LOCAL,
});

export const operation_use_personal = defineOperation({
  ...frozenText("use.personal"),
  priority: "normal",
  implementedBy: flow_client_use_personal,
  acceptance: [
    keep("use.personal", 1, "cli: after `use org acme` then `use personal`, `whoami --json` answers `actingAs.kind: personal`, and a later command acts for the person."),
  ],
  returns: Schema.Struct({ actingAs: Schema.Struct({ kind: Schema.Literal("personal") }) }),
  errors: [error_CLI_USAGE],
  refusals: [
    storage("person-signed-in", "The saved choice on this machine cannot be read or written: the eval makes the state file read-only."),
    { error: error_CLI_USAGE, given: "person-signed-in", when: "It is given an argument; an Organization is chosen with `capxul use org`." },
  ],
  examples: [
    ok("Go back to acting for yourself", "capxul use personal --json", { actingAs: { kind: "personal" } }),
    refused("An argument is given; an organization is chosen with use org", "capxul use personal northwind --json", error_CLI_USAGE),
  ],
  budget: LOCAL,
});

export const operation_whoami = defineOperation({
  ...frozenText("whoami"),
  priority: "normal",
  implementedBy: flow_client_whoami,
  acceptance: [
    keep("whoami", 1, "cli: `whoami --org acme --json` and `CAPXUL_ORG=acme whoami --json` answer `actingAs.handle: acme`; `whoami --email sam@acme.test --json` answers Sam with `actingAs.kind: personal` though Dana saved an Organization."),
  ],
  returns: Schema.Struct({
    user: Null(Schema.Struct({ email: Null(S), handle: Null(S), kind: Schema.Literals(["person", "agent"]) })),
    actingAs: Schema.Struct({ kind: Schema.Literals(["personal", "org"]), handle: Schema.optionalKey(S), source: S }),
    safe: Null(S),
    env: Null(Schema.Struct({ name: S, network: S, source: S })),
    signer: Null(Schema.Union([
      Schema.Struct({ kind: Schema.Literal("browser") }),
      Schema.Struct({ kind: Schema.Literal("own-key"), store: Schema.Literals(["file", "env"]) }),
    ])),
  }),
  refusals: [
    storage("two-people-signed-in", "The saved state on this machine is unreadable, unsafe or locked: the eval makes the state file unreadable after the world is restored."),
  ],
  examples: [
    ok("Hannah, signed in with the browser, acting for Northwind", "capxul whoami --json", {
      user: { email: PEOPLE.hannah.email, handle: "hannah", kind: "person" },
      actingAs: { kind: "org", handle: NORTHWIND.slug, source: "saved" },
      safe: ADDRESS.hannah,
      env: { name: "devnet", network: "town", source: "saved" },
      signer: { kind: "browser" },
    }),
    ok("Nobody is signed in", "capxul whoami --json", {
      user: null,
      actingAs: { kind: "personal", source: "default" },
      safe: null,
      env: null,
      signer: null,
    }),
    refused("The saved state is unreadable", "capxul whoami --json", error_CLI_STORAGE),
  ],
  budget: LOCAL,
});
