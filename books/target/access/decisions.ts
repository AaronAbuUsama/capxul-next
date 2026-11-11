// Access' own judgments in the target design, one decision record each, linked to the records they
// shape. Made by Claude on 8 November 2026 under A1-A4 and P1-P10, with the old code
// (/home/user/factory, integration/factory) and the as-is book (docs/as-is/archive/access/) as evidence.

import { defineDecision } from "../../../packages/book/src/index.ts";
import { component_backend, component_mcp_server, concept_access } from "../shared/foundation.ts";
import { integration_openfort_shield } from "../shared/external.ts";
import * as d from "./data.ts";
import * as sign from "./sign-in.ts";
import * as ses from "./sessions.ts";
import * as asst from "./assistants.ts";
import * as p from "./processes.ts";
import * as fl from "./flows.ts";
import * as op from "./operations.ts";

const CLAUDE = "Claude, access target design, 8 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;

const LOCAL_FLOWS = [
  fl.flow_client_auth_list,
  fl.flow_client_auth_switch,
  fl.flow_client_auth_sign_out,
  fl.flow_client_use_env,
  fl.flow_client_use_personal,
  fl.flow_client_whoami,
  fl.flow_client_config_telemetry_on,
  fl.flow_client_config_telemetry_off,
  fl.flow_client_config_telemetry_status,
  fl.flow_client_schema,
];
const LOCAL_OPERATIONS = [
  op.operation_auth_list,
  op.operation_use_env,
  op.operation_use_personal,
  op.operation_whoami,
  op.operation_config_telemetry_on,
  op.operation_config_telemetry_off,
  op.operation_config_telemetry_status,
  op.operation_schema,
];

// ── how sign-in is built ────────────────────────────────────────────────────────────────────

export const decision_access_own_sign_in = defineDecision({
  id: "access.own-sign-in",
  title: "Sign-in and sessions on access' own tables, not BetterAuth",
  question: "Does the rebuild keep BetterAuth (email OTP, bearer, JWT and the OIDC provider) behind access, or build sign-in on access' own tables?",
  options: [
    { label: "own", text: "Access' own tables and rpcs: an emailed code, an agent's signed challenge, opaque session tokens stored as hashes, OAuth for assistants on one table." },
    { label: "betterauth", text: "BetterAuth on Postgres with its emailOTP, bearer, jwt and oidcProvider plugins, its models mapped onto access' tables, and a plugin for the agent challenge." },
  ],
  chosen: "own",
  why:
    "BetterAuth's route handlers write its own models through its adapter, outside the rpc's one transaction (A3), so a " +
    "session's birth could not send session_transitioned in its transaction (P7); its schema is its own, not generated " +
    "from the book with row-level security (P8); and its lookups run before any tenant is set. The old system used " +
    "about eight of its models and mounted some forty routes nobody called (the as-is `access.auth.request`). What " +
    "Capxul needs is small: a hashed six-digit code with a cooldown, a random token stored as a hash, a challenge proved " +
    "on chain, and OAuth's code, token and revocation steps for MCP clients. Each is a few rpcs over access' tables, " +
    "checked by the same evals as every other concept.",
  source: by("docs/as-is/archive/access/sessions.ts:392 (the unused BetterAuth routes); docs/as-is/archive/access/data.ts:472 (eight component tables)"),
  affects: [
    concept_access, d.table_principals, d.table_sign_in_codes, d.table_sessions, d.table_assistant_grants,
    sign.rpc_access_sign_in_send_code, sign.rpc_access_sign_in_verify_code,
  ],
});

export const decision_access_principals = defineDecision({
  id: "access.principals",
  title: "One principals table for people and agents, keyed by person_id",
  question: "How does access know an agent, which has no email and whose record is agents', when access may read no other concept?",
  options: [
    { label: "one-table", text: "One principals row per person or agent; `person_id` is the principal id for both, the Safe is on the row, an agent's row is born at its first proved sign-in." },
    { label: "agents-table", text: "Sessions name an agent by a key into agents' table." },
    { label: "email-for-agents", text: "Give each agent an email account, as the old own-key login did." },
  ],
  chosen: "one-table",
  why:
    "Access depends on nothing (concepts.access), so it cannot key a session into agents' rows; the chain proves an " +
    "agent (AgentOwner and its Safe's owners), so access can keep its own principal for it. One id column for both kinds " +
    "lets row-level security set one personal tenant whoever calls. The Safe on the row is what approvals and every " +
    "personal read need (dependencies.approvals-low: an agent's Safe is on its principal); a person's is a pure function " +
    "of the email, computed without a chain call. The designed v4 login signs an agent in by key alone, with no inbox.",
  source: by("apps/docs/factory/operations/auth.login.yaml (designed W9); books/target/shared/decisions.ts (dependencies.approvals-low)"),
  affects: [d.table_principals, d.table_sessions, d.table_assistant_grants, sign.rpc_access_sign_in_with_key],
});

export const decision_access_tenancy_before_sign_in = defineDecision({
  id: "access.tenancy-before-sign-in",
  title: "A sign-in code's tenant is the email it was sent to",
  question: "Whose row is a sign-in code, when no principal exists until the code is verified?",
  options: [
    { label: "email", text: "Tenancy person with tenantField email: the row belongs to the address, and its policy admits only the email the request names." },
    { label: "principal-first", text: "Create a principal at the first send, so the code carries person_id." },
    { label: "global", text: "Treat codes as global rows." },
  ],
  chosen: "email",
  why:
    "A principal born for every typed address would put unverified people in the table every concept names. Global is " +
    "for rows only the system writes (prices, flags), and a code is one person's secret. Keying by the email keeps the " +
    "row the address owner's, which is what the code proves. The other lookups made before a tenant is known (by token " +
    "hash, by code hash, by challenge, by Safe) are crossTenant indexes, each saying why.",
  source: by("docs/as-is/archive/access/data.ts:77 (otp-rate-limits keyed by email); P8 tenancy values"),
  affects: [d.table_sign_in_codes, d.table_sessions, d.table_assistant_grants, d.table_principals],
});

export const decision_access_sign_in_codes = defineDecision({
  id: "access.sign-in-codes",
  title: "One row per email holds the code and its cooldown; send first, then store",
  question: "How are the emailed code, its tries and the send cooldown stored, and in what order are sending and storing done?",
  options: [
    { label: "one-row", text: "One row per email: code hash, tries, expiry and sent time (the cooldown). Check the cooldown, send, then store in one transaction." },
    { label: "two-stores", text: "Keep the old cooldown table beside the auth library's verification rows, claiming the cooldown before the send and releasing it after a failure." },
  ],
  chosen: "one-row",
  why:
    "The cooldown and the code are one fact about one address, and the old code kept them in two stores with a claim and " +
    "release dance between them. Sending before storing means a failed send leaves nothing to release: the person can ask " +
    "again at once, and a crash after the send leaves only an email whose code was never stored. The numbers stay: six " +
    "digits, five minutes, three tries, 60 seconds between sends. Three wrong codes are RATE_LIMITED, as the old SDK " +
    "mapped TOO_MANY_ATTEMPTS; one wrong code is INVALID_INPUT and an old one OTP_EXPIRED, as the frozen book says.",
  source: by("packages/backend/src/access/sessions/rules.ts:165; packages/backend/src/access/sessions/external/auth.ts:197; apps/docs/factory/operations/auth.login.yaml (mistakes)"),
  affects: [d.table_sign_in_codes, sign.rpc_access_sign_in_send_code, sign.rpc_access_sign_in_verify_code],
});

export const decision_access_sessions = defineDecision({
  id: "access.sessions",
  title: "Opaque, hashed session tokens: 30 days for a person, 24 hours for an agent",
  question: "What is a session token, how is it checked on every request, and how long does it last?",
  options: [
    { label: "opaque", text: "32 random bytes handed back once; the runtime finds the session by the token's SHA-256 in the request's own transaction." },
    { label: "jwt", text: "A signed JWT checked against cached keys, with a JWKS route." },
  ],
  chosen: "opaque",
  why:
    "A hash lookup is one indexed statement in the transaction every rpc already opens, about the cost of a JWT check " +
    "(P5's hop table), and a revoked session is refused at once, which a JWT cannot do without a lookup anyway. The old " +
    "JWKS existed for Convex and for Ponder's read scope, both gone, so the backend needs no JWKS route. A person's " +
    "session lasts 30 days, then they sign in again; an agent's lasts 24 hours and the SDK signs a new challenge itself " +
    "(the old agent exchange gave one hour). The session machine records every end, so the funnel sees sign-outs and " +
    "expiries; the daily sweep writes the expiry.",
  source: by("docs/decisions/policy-pack.md#p5 (hop table); packages/backend/src/access/agents/writes.ts:10; docs/as-is/archive/access/sessions.ts:291"),
  affects: [
    d.table_sessions, d.machine_session, d.event_session_transitioned, ses.rpc_access_sessions_current,
    ses.rpc_access_sessions_revoke, p.workflow_access_sessions_sweep, component_backend,
  ],
});

export const decision_access_agent_sign_in = defineDecision({
  id: "access.agent-sign-in",
  title: "An agent signs in with a stateless challenge, proved on chain",
  question: "How does an agent prove its key, and how is a challenge kept from being replayed?",
  options: [
    { label: "stateless", text: "The challenge is Capxul's MAC over the Safe, a nonce and the time; the session it opens keeps the nonce under a unique index." },
    { label: "stored", text: "A challenges table, written at issue and spent at sign-in." },
  ],
  chosen: "stateless",
  why:
    "Issuing a challenge then writes nothing, so anyone can ask for one without growing a table, and the one write is the " +
    "session that spends it: a replay fails on the nonce's unique index in that same transaction. The proof is the " +
    "chain's, read at `latest` in parallel: AgentOwner's `agentOf(safe)` names an owner, is not frozen and names the key, " +
    "and the Safe's only owner is the key. That is the designed v4 refusal: NOT_AUTHENTICATED when the key signs for no " +
    "agent account or the agent is frozen. A key rotation shows up as a new signer at the next sign-in.",
  source: by("apps/docs/factory/operations/auth.login.yaml (designed W9 refusals); books/target/shared/external.ts (agent-owner agentOf)"),
  affects: [sign.rpc_access_sign_in_challenge, sign.rpc_access_sign_in_with_key, d.table_sessions, fl.flow_client_auth_key_session],
});

// ── what leaves ─────────────────────────────────────────────────────────────────────────────

export const decision_access_no_device_flow = defineDecision({
  id: "access.no-device-flow",
  title: "The native client device flow is not ported; the daily sweep keeps sessions",
  question: "The concept map names the CLI's native client grants (device flow) and P3 keeps their daily sweep. Are they rebuilt?",
  options: [
    { label: "drop", text: "Drop the native client contexts, requests and grants, their 14 routes and the browser continuation; the daily cron sweeps sessions, codes and ended grants." },
    { label: "port", text: "Rebuild the device flow and its sweep as they were." },
  ],
  chosen: "drop",
  why:
    "P2: nothing starts a device request. The CLI signs in first-party with an emailed code and keeps the old grant " +
    "records only to delete them (`native-grant-cleanup.ts`); `auth login` never opens a browser; no other client calls " +
    "/native/device/code. The browser continuation page has no request to continue. The daily cron P3 keeps survives " +
    "as access.sessions.sweep, and an assistant grant's expiry is its own process's timer.",
  source: by("apps/cli/src/auth/native-grant-cleanup.ts:5; docs/as-is/archive/access/clients.ts (start-request reached only by /native/device/code)"),
  affects: [concept_access, p.workflow_access_sessions_sweep],
});

export const decision_access_dropped = defineDecision({
  id: "access.dropped",
  title: "Old access functions with no place in the target",
  question: "What else of old access is not rebuilt, and where did each go?",
  options: [
    {
      label: "drop-or-move",
      text:
        "The indexer read scope and the session's `safes` claim (row-level security), application consent (applications), " +
        "the waitlist and referrals (accounts), operator proof identities and purges (devnet worlds), reserved e2e " +
        "identities and the fixed code (the devnet mail sink), currentUser (access.sessions.current), the token exchange " +
        "for the MCP server (the runtime resolves assistant tokens), features.list and setMine (no caller), features.set " +
        "(devnet's `dev gates set`).",
    },
    { label: "keep", text: "Port each as it was." },
  ],
  chosen: "drop-or-move",
  why:
    "Each either has no caller (P2), is plumbing the runtime now does (P3), lives in the concept the map moved it to " +
    "(concepts.access, concepts.accounts, concepts.applications), or existed only to test the old system by hand " +
    "(P8: evals restore worlds instead of seeding proof identities).",
  source: by("packages/backend/src/access/README.md:3; docs/as-is/archive/access/sessions.ts:158; docs/as-is/archive/access/procedures.ts"),
  affects: [concept_access],
});

// ── assistants: OAuth for MCP clients ───────────────────────────────────────────────────────

export const decision_access_assistants = defineDecision({
  id: "access.assistants",
  title: "OAuth 2.1 for MCP clients on one grants table, with stateless registration",
  question: "How does an assistant (an MCP client) get to act as a person, and what does the backend store for it?",
  options: [
    {
      label: "grants",
      text:
        "Stateless client registration (the client id is Capxul's MAC over its name and redirect URIs), a consent page, " +
        "PKCE codes, rotating refresh tokens and opaque access tokens on one assistant-grants table, which the runtime " +
        "resolves like a session.",
    },
    { label: "oidc-provider", text: "An OIDC provider with client, token and consent tables, and the MCP server exchanging each token at the backend with a shared secret, as before." },
  ],
  chosen: "grants",
  why:
    "A registration row has nothing to say that the client id cannot carry, and open registration endpoints get " +
    "flooded, so signing the metadata leaves no client table to sweep. One row per consent holds the code, the tokens' " +
    "hashes and the refresh window. The runtime resolves an assistant's bearer to the person and its scopes as it " +
    "resolves a session, so the MCP server passes the token through the Core SDK and needs no exchange (its " +
    "MCP_EXCHANGE_SECRET is unused). The scopes keep the old grammar; none signs or sends money: the person signs every " +
    "approval. The discovery documents and registration are stateless protocol routes and are not booked as rpcs.",
  source: by("packages/backend/src/access/rules.ts:14 (scope grammar); apps/mcp/src/identity.ts:1 (the exchange); docs/as-is/archive/access/agents.ts"),
  affects: [
    d.table_assistant_grants, d.machine_assistant_grant, d.event_assistant_grant_transitioned,
    asst.rpc_access_assistants_read_request, asst.rpc_access_assistants_consent, asst.rpc_access_assistants_token,
    asst.rpc_access_assistants_revoke, fl.flow_client_auth_assistants_consent, component_mcp_server,
  ],
});

export const decision_access_assistant_grant_process = defineDecision({
  id: "access.assistant-grant-process",
  title: "An assistant grant is a long-lived object with one durable process",
  question: "Who expires an unexchanged code or a grant whose refresh window lapsed?",
  options: [
    { label: "process", text: "One process per grant: it waits for the code exchange (10 minutes) and then on the sliding refresh window, signalled by the token and revocation routes." },
    { label: "sweep", text: "The daily sweep marks lapsed grants expired." },
  ],
  chosen: "process",
  why:
    "A grant waits on a person (consent made it), on the client (the exchange) and on a clock (the refresh window), and " +
    "it has an expiry, like an invitation: A3's shape, an object rules.durable-processes lets a designer add. Its own " +
    "timer ends it on time, where a daily sweep would leave a lapsed grant active for up to a day, and P3 turns what the " +
    "old system swept for into a process's timer.",
  source: by("A3; P3; packages/backend/src/platform/jobs.ts:69 (the old daily sweep of client grants)"),
  affects: [p.workflow_access_assistants_grant, d.machine_assistant_grant, asst.rpc_access_assistants_token, asst.rpc_access_assistants_revoke],
});

// ── feature gates ───────────────────────────────────────────────────────────────────────────

export const decision_access_gates = defineDecision({
  id: "access.gates",
  title: "One flags table synced each minute, read by every gated concept",
  question: "What does access keep for feature gates, and how do other concepts check one?",
  options: [
    {
      label: "one-table",
      text:
        "One feature-flags row per catalogue gate, rewritten by the minute sync with `checked_at`; devnet's gate table " +
        "feeds the PostHog fake; every gated concept reads the table through access' one evaluator.",
    },
    { label: "as-is", text: "Keep the gate table, the flag copy and a sync-run log in access, and a check procedure on its door." },
  ],
  chosen: "one-table",
  why:
    "The old copy, its devnet override table and a run log that grew a row a minute were three stores for one answer. " +
    "Staleness needs only the last good sync's time, which every row's `checked_at` carries; a money gate still reads " +
    "off when it is older than 10 minutes. Writing gates on a devnet is devnet's (`dev gates set`), seen through the " +
    "PostHog fake, so production code has one path. A gate check is a read, not a money fact, so it is no procedure " +
    "(rules.procedures): a concept that refuses FEATURE_NOT_AVAILABLE lists this table in its reads. features.list and " +
    "setMine had no caller.",
  source: by("docs/as-is/archive/access/data.ts:256, :293, :319; packages/backend/src/access/features/rules.ts:84; books/target/shared/external.ts (posthog fake)"),
  affects: [d.table_feature_flags, p.workflow_access_gates_sync],
});

export const decision_access_no_procedures = defineDecision({
  id: "access.no-procedures",
  title: "Access' door has no procedures; the caller is the runtime's",
  question: "Which procedures do other concepts invoke on access?",
  options: [
    { label: "none", text: "None: the runtime resolves the caller before the rpc runs, and gates and Safes are reads of access' tables." },
    { label: "guards", text: "Procedures for the caller, a consented caller, a read scope and a gate, as the old door had." },
  ],
  chosen: "none",
  why:
    "A procedure exists for a write that is one money fact with its invoker's (rules.procedures), and no concept's money " +
    "fact writes a principal, a session, a grant or a flag. Who is calling is resolved once per request by the runtime, " +
    "which also sets the tenant for row-level security, so it is no more a record than the outbox is (rules.outbox). " +
    "The old door's read-scope and consent guards went with the indexer scope and application consent.",
  source: by("docs/as-is/archive/access/procedures.ts (26 door functions); books/target/shared/decisions.ts (rules.procedures, rules.outbox)"),
  affects: [concept_access, d.table_feature_flags, d.table_principals],
});

// ── the client side ─────────────────────────────────────────────────────────────────────────

export const decision_access_local_flows = defineDecision({
  id: "access.local-flows",
  title: "The local commands are Core SDK flows over the host's saved state",
  question: "Where does the state of `auth list`, `auth switch`, `auth logout`, `use`, `whoami` and `config telemetry` live, and who raises CLI_STORAGE?",
  options: [
    { label: "sdk-host", text: "The Core SDK's Node host keeps this machine's state in the CLI's settings directory; each command is one flow whose cache steps read or write it and raise CLI_STORAGE." },
    { label: "cli", text: "The CLI keeps the files and calls the SDK only for the network." },
  ],
  chosen: "sdk-host",
  why:
    "A4: the CLI calls one SDK method per command, and the flow is the operation's `implementedBy` (concepts.local-commands). " +
    "The same methods then serve the MCP server's stdio mode and any Node host. A flow cannot call another flow, so " +
    "`auth switch`'s offer to sign in someone else answers the `capxul auth login` argv instead of running it.",
  source: by("A4; books/target/shared/decisions.ts (concepts.local-commands); apps/cli/src/auth/current-session.ts:1"),
  affects: [...LOCAL_FLOWS, ...LOCAL_OPERATIONS, op.operation_auth_logout, op.operation_auth_switch],
});

export const decision_access_schema_catalogue = defineDecision({
  id: "access.schema-catalogue",
  title: "`schema` and `--help` read one catalogue generated from the book",
  question: "Where does `capxul schema` get each command's arguments, flags, output and errors?",
  options: [
    { label: "generated", text: "A catalogue generated from the book's operation records ships in the Core SDK; `schema` and `--help` both read it." },
    { label: "cli-definitions", text: "The CLI's own command definitions, as before." },
  ],
  chosen: "generated",
  why:
    "The operations already hold each command, its returns and its errors; generating the catalogue makes `schema`, " +
    "`--help` and the book agree by construction, which claim 1 asks of `--help`. It is still a local read.",
  source: by("apps/cli/src/commands/schema/catalog.ts:1; apps/docs/factory/operations/schema.yaml (notes)"),
  affects: [fl.flow_client_schema, op.operation_schema],
});

export const decision_access_whoami_signer = defineDecision({
  id: "access.whoami-signer",
  title: "The designed `client.me.signer()` is `client.whoami()`'s signer field",
  question: "The designed whoami names the SDK method `client.me.signer`; the CLI calls one method per command. Which?",
  options: [
    { label: "field", text: "`client.whoami()` answers user, acting-as, Safe, environment and signer; the designed signer is its `signer` field." },
    { label: "two-methods", text: "`whoami` calls `client.me.signer()` and another method for the rest." },
  ],
  chosen: "field",
  why:
    "A4 allows one SDK method per command, and the signer is read from the same saved session as the rest, so splitting " +
    "it adds a method with nothing of its own. An SDK host reads `signer.kind` from the one answer, as the designed text " +
    "intends.",
  source: by("apps/docs/factory/operations/whoami.yaml (designed W9: method client.me.signer)"),
  affects: [fl.flow_client_whoami, op.operation_whoami],
});

export const decision_access_switch_setup_state = defineDecision({
  id: "access.switch-setup-state",
  title: "`auth switch` reads the Safe's setup from the chain",
  question: "`auth switch` answers `setupState`, which is accounts' to know, but access depends on nothing. Where does it come from?",
  options: [
    { label: "chain", text: "access.sessions.current reads the person's Safe: ready when it has code and Companies House is no longer an owner." },
    { label: "saved", text: "The setup state saved on this machine at sign-in." },
    { label: "move", text: "Move `auth switch` to accounts, as `auth login` and `auth verify` were." },
  ],
  chosen: "chain",
  why:
    "The claim is the setup, and it is on chain: Companies House's claim swaps the person's signer in as the Safe's only " +
    "owner. Two reads give the truth without a dependency; a saved value goes stale the moment setup finishes in the " +
    "browser. Moving the command would split the local-session commands across two concepts for one field.",
  source: by("packages/contracts/v4/src/interfaces/ICompaniesHouseClaimer.sol:33; books/target/shared/foundation.ts (concept_accounts)"),
  affects: [ses.rpc_access_sessions_current, fl.flow_client_auth_switch, op.operation_auth_switch],
});

export const decision_access_surface_flows = defineDecision({
  id: "access.surface-flows",
  title: "Flows for the browser and for an agent's SDK host reach the sign-in rpcs",
  question: "Which access flows sign anyone in, now that the CLI's sign-in commands are accounts'?",
  options: [
    { label: "surfaces", text: "A browser sign-in (web app, approval page, consent page) and an agent key session (an SDK host with the agent's key); accounts' CLI flows use the same rpcs." },
    { label: "accounts-only", text: "Only accounts' `auth login` and `auth verify` flows sign in." },
  ],
  chosen: "surfaces",
  why:
    "A person signs approvals and allows assistants in a browser, which needs its own session; an agent's program on the " +
    "Core SDK opens and renews its session with its key, as the designed SDK example shows. Neither is a CLI command, so " +
    "each flow names its surface (P2's rule for non-CLI flows) and no operation implements it.",
  source: by("apps/docs/factory/operations/auth.login.yaml (designed SDK example); packages/sdk-react/src/access/client-connection.tsx:33"),
  affects: [fl.flow_client_auth_browser_sign_in, fl.flow_client_auth_key_session, fl.flow_client_auth_assistants_consent],
});

export const decision_access_wallet_recovery = defineDecision({
  id: "access.wallet-recovery",
  title: "The embedded wallet's recovery session is an access rpc at browser sign-in",
  question: "Who asks Openfort Shield for the encryption session the person's embedded wallet needs in a new browser?",
  options: [
    { label: "sign-in", text: "access.sessions.wallet-recovery, a step of the browser sign-in, so the wallet is ready before any approval." },
    { label: "per-approval", text: "Each approval's signing flow asks when it signs." },
  ],
  chosen: "sign-in",
  why:
    "The backend holds the Shield secrets, and the session belongs to the signed-in person; asking once at sign-in keeps " +
    "the vendor call out of every approval's wait. The CLI and agents sign locally and never ask.",
  source: by("books/target/shared/external.ts (openfort-shield: an access rpc); docs/as-is/archive/access/sessions.ts:365"),
  affects: [ses.rpc_access_sessions_wallet_recovery, fl.flow_client_auth_browser_sign_in, integration_openfort_shield],
});

// ── acceptance, worlds and budgets ──────────────────────────────────────────────────────────

export const decision_access_logout_claim = defineDecision({
  id: "access.logout-claim",
  title: "`auth logout` claim 1 is rewritten as what a black box sees",
  question: "`auth logout` #1 says it \"asks the backend to revoke\" the session, a mechanism. What does the eval check?",
  options: [
    { label: "rewrite", text: "\"It removes the current person's session on this machine, and the backend refuses that session's token afterwards.\"" },
    { label: "verbatim", text: "Keep the line as frozen." },
  ],
  chosen: "rewrite",
  why:
    "P1: a black box cannot see a request being made, only its outcome: `auth list` no longer lists the person, the world " +
    "shows the session revoked and the collector shows its transition. The old system passes the rewrite: its sign-out " +
    "deletes the BetterAuth session, so the token is refused. The old line and its citation are in `was`.",
  source: by("docs/decisions/policy-pack.md#p1 (auth.logout #1 is its example); apps/docs/factory/operations/auth.logout.yaml"),
  affects: [op.operation_auth_logout],
});

export const decision_access_worlds = defineDecision({
  id: "access.worlds",
  title: "Three worlds for access' refusals",
  question: "Which named worlds reach access' refusals, given that most of them are about this machine's files?",
  options: [
    {
      label: "three",
      text:
        "empty-devnet (v4 deployed, no principal, a fresh CLI home); person-signed-in (Dana signed in and current); " +
        "two-people-signed-in (Dana and Sam signed in, Dana current). Each devnet snapshot is taken with the eval " +
        "machine's CLI home, and a CLI_STORAGE refusal makes the state file unreadable or read-only after the restore.",
    },
    { label: "per-refusal", text: "One world per refusal." },
  ],
  chosen: "three",
  why:
    "Every refusal access owns is reached from one of three states of this machine: nobody signed in, one person, two " +
    "people. A file the eval cannot read is a step after the restore, not a world of its own, so the old whoami note " +
    "(the runner cannot make the state unreadable) no longer holds: the harness owns the eval's CLI home.",
  source: by("apps/docs/factory/operations/whoami.yaml (notes: CLI_STORAGE unproven on DevNet)"),
  affects: [
    op.operation_auth_list, op.operation_auth_logout, op.operation_auth_switch, op.operation_use_env,
    op.operation_use_personal, op.operation_whoami, op.operation_schema, op.operation_config_telemetry_on,
    op.operation_config_telemetry_off, op.operation_config_telemetry_status,
  ],
});

export const decision_access_local_budgets = defineDecision({
  id: "access.local-budgets",
  title: "Local commands get a tighter budget than the read class",
  question: "The read class assumes one rpc (600 / 1,200 ms). What budget does a command with no network call get?",
  options: [
    { label: "local", text: "Operation 300 / 600 ms (the CLI's start and one file); its flow 20 / 100 ms." },
    { label: "read-default", text: "Take the read class's default." },
  ],
  chosen: "local",
  why:
    "P5's floor for these commands is the CLI's 300 ms start and a file read; the read default would let a command that " +
    "quietly started calling the network pass. Each override carries its why. `auth logout` and `auth switch` call the " +
    "backend and keep their class (write, chain-read).",
  source: by("docs/decisions/policy-pack.md#p5 (CLI process start 300 ms)"),
  affects: [...LOCAL_FLOWS.filter((f) => f !== fl.flow_client_auth_switch && f !== fl.flow_client_auth_sign_out), ...LOCAL_OPERATIONS],
});

// ── assembly ────────────────────────────────────────────────────────────────────────────────

export const decision_access_email_rule = defineDecision({
  id: "access.email-rule",
  title: "Sign-in normalises a mailbox by the Safe salt's rule and keeps non-ASCII letters",
  question:
    "Sign-in said it normalises the email to ASCII. Accounts' world setup-refused-non-ascii-email signs in with a " +
    "mailbox whose local part is not ASCII, so that the claim can fail with EmailNotNormalized (`account retry` " +
    "INVALID_INPUT). Does sign-in refuse such a mailbox, or let it through for the chain to refuse?",
  options: [
    {
      label: "salt-rule",
      text: "Trim and lowercase, as the Safe salt does; refuse only what is not an address. A non-ASCII mailbox signs in and its claim is refused on chain.",
    },
    { label: "ascii-only", text: "Refuse a non-ASCII mailbox at sign-in with INVALID_INPUT, before any setup." },
  ],
  chosen: "salt-rule",
  why:
    "`waitlist status` says signing in always works, and the old sign-in normalised with normalizeSafeSaltEmail (trim, " +
    "lowercase) and refused nothing more. The salt rule fixes every person's Safe address, so access must apply it " +
    "unchanged. Refusing at sign-in would lock such a person out of every read and leave `account retry`'s frozen " +
    "INVALID_INPUT (EmailNotNormalized) with no world. Accounts' setup-refused-non-ascii-email therefore stays buildable.",
  source: by("packages/protocol/src/evm/safe-email.ts:17; packages/backend/src/access/sessions/reads.ts:104; CompaniesHouseClaimer.sol:189-199; waitlist.status.yaml (notes); account.retry.yaml (designed refusals)"),
  affects: [sign.rpc_access_sign_in_send_code, sign.rpc_access_sign_in_verify_code, d.table_principals, d.table_sign_in_codes],
});
