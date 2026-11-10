// Every judgment the applications design makes, as a decision record. Made by Claude on 8 November
// 2026 under A1-A4 and P1-P10, with the old code (/home/user/factory, integration/factory: old
// applications, old operator's diagnostics, the CLI's `doctor`, `key` and `dev key` commands and the
// SDK's bootstrap) and the as-is book as evidence.

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import { component_backend, concept_access, concept_applications } from "../shared/foundation.ts";
import { error_NETWORK_ERROR, error_PROVIDER_RESPONSE_INVALID, error_WRONG_ENVIRONMENT } from "../shared/vocabulary.ts";
import { table_org_deployments, table_org_members } from "../organizations/data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import {
  event_app_key_transitioned,
  machine_app_key,
  table_applications,
  table_publishable_keys,
  table_quickstart_keys,
} from "./data.ts";
import { rpc_applications_bootstraps_resolve } from "./bootstraps.ts";
import { rpc_applications_health_check } from "./health.ts";
import {
  rpc_applications_keys_create,
  rpc_applications_keys_list,
  rpc_applications_keys_revoke,
  rpc_applications_keys_rotate,
} from "./keys.ts";
import { rpc_applications_quickstarts_mint } from "./quickstarts.ts";
import { workflow_applications_keys_grace } from "./processes.ts";
import {
  flow_client_account_keys_revoke,
  flow_client_account_keys_rotate,
  flow_client_dev_key,
  flow_client_system_health,
  flow_create_capxul_client,
} from "./flows.ts";
import {
  operation_dev_key,
  operation_doctor,
  operation_key_create,
  operation_key_list,
  operation_key_revoke,
  operation_key_rotate,
} from "./operations.ts";

const CLAUDE = "Claude, applications design, 8 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;
const A = "packages/backend/src/applications";
const ASIS = "docs/as-is/archive/applications";

const KEY_RPCS = [rpc_applications_keys_create, rpc_applications_keys_list, rpc_applications_keys_rotate, rpc_applications_keys_revoke];
const KEY_OPERATIONS = [operation_key_create, operation_key_list, operation_key_rotate, operation_key_revoke];

// ── data ────────────────────────────────────────────────────────────────────────────────────

export const decision_applications_owner_tables = defineDecision({
  id: "applications.owner-tables",
  title: "Applications and keys are owner rows, each carrying its own owner",
  question: "How are a person's and an Organization's applications and keys stored under P8?",
  options: [
    {
      label: "owner",
      text: "`applications` and `publishable-keys`, both tenancy `owner` (`owner_kind` person or organization, `owner_id`), the owner on every key row.",
    },
    { label: "by-join", text: "As before: the owner on the application only, a key reaching it through `application_id`." },
    { label: "two-stores", text: "A person's applications and keys apart from an Organization's, each with its own tenant column." },
  ],
  chosen: "owner",
  why:
    "Every key command runs the same way for a person and for an Organization (`--org`), so one pair of tables and one " +
    "set of rpcs serve both, with the `owner` tenancy P8 gives a row either can own. The old key row had no tenant column " +
    "and was scoped through its application, which P8 forbids (tenancy by join); here a key carries its owner, so its " +
    "row-level security needs no join. `owner_id` leads the key and every index with `owner_kind` second, as contacts " +
    "does. The one lookup across owners, a raw key's hash at bootstrap, is a unique crossTenant index.",
  source: by(`${A}/tables.ts:8, :28 (no tenant column on publishableKeys); ${ASIS}/data.ts:90; P8`),
  affects: [table_applications, table_publishable_keys, concept_applications],
});

export const decision_applications_envelope_from_deployment = defineDecision({
  id: "applications.envelope-from-deployment",
  title: "The bootstrap envelope comes from the deployment, not from the key's row",
  question: "Each old application and key row copied the deployment's routing and vendor keys at mint. Keep the copies?",
  options: [
    { label: "deployment", text: "Store no routing or vendor keys: the bootstrap builds the envelope from this deployment's settings when it is called." },
    { label: "copy", text: "Copy the bootstrap metadata onto every application and key, as before." },
  ],
  chosen: "deployment",
  why:
    "A key belongs to one deployment and can only ever be resolved by it, so what it serves is that deployment's settings " +
    "now. The copies were why the old concept needed `backfillMetadata` and `migrateNativeRouting` (repairs that rewrote " +
    "every row when a URL or a vendor key changed) and why a registration made through the old rpc carried placeholder " +
    "routing. With no copies there is nothing to drift and nothing to repair. The envelope is version 2: one backend " +
    "origin replaces the Convex, site and auth URLs, and the indexer URL goes, since the SDK never calls Ponder.",
  source: by(`${A}/model.ts:20 (BootstrapMetadata); ${ASIS}/repairs.ts:64, :174; ${A}/registrations/writes.ts:16`),
  affects: [table_applications, table_publishable_keys, rpc_applications_bootstraps_resolve],
});

export const decision_applications_origins_on_the_application = defineDecision({
  id: "applications.origins-on-the-application",
  title: "Origins belong to the application, and every key follows them",
  question: "Old keys copied their application's origins at mint and kept an origin index. Where do origins live now?",
  options: [
    { label: "application", text: "On the application only; the bootstrap reads them through the key's application, and every key follows a change." },
    { label: "per-key", text: "A copy on each key, and the `publishable-key-origins` index, as before." },
  ],
  chosen: "application",
  why:
    "`--origin` sets the web origins of the app (the frozen text), so they are the app's. The per-key copy meant a key " +
    "made before an origin change kept the old origins, and a rotation's successor took the app's current ones while its " +
    "predecessor kept its own, which no one could see from `key list`. The origin index existed only for sign-in's " +
    "trusted-origin read, which the origin token replaces (applications.origin-token). The bootstrap already reads the " +
    "key, so its application is one more read by primary key.",
  source: by(`${ASIS}/data.ts:144 (publishable-key-origins); ${A}/keys/operations/rotate.ts:35; frozen key.create about`),
  affects: [table_applications, table_publishable_keys, rpc_applications_keys_create, rpc_applications_bootstraps_resolve],
});

export const decision_applications_key_machine = defineDecision({
  id: "applications.key-machine",
  title: "A key's state is a stored status with five named transitions",
  question: "Old keys derived active, grace, expired and revoked at read time from two timestamps. How is it kept now?",
  options: [
    { label: "stored", text: "A `status` column on the key, the machine `app-key` with create, rotate, retire, expire and revoke, and one event." },
    { label: "derived", text: "Derive the state from `revoked_at` and `grace_ends_at` at read time, as before." },
  ],
  chosen: "stored",
  why:
    "P7: every write to a status is a named transition, with the machine's one event. Derived, the end of a grace window " +
    "changed nothing anyone could observe, and the two old readers disagreed for one millisecond at the boundary. `retire` " +
    "is `--grace 0`, which the old code stored as a window ending now. The machine is `app-key` so its event keeps the " +
    "old funnel name, `app_key_transitioned`, now sent by every transition through the outbox instead of by a scheduled " +
    "telemetry action.",
  source: by(`${A}/keys/rules.ts:35, :41; ${A}/rules.ts:93; ${A}/keys/events.ts:60; P7`),
  affects: [machine_app_key, event_app_key_transitioned, table_publishable_keys],
});

export const decision_applications_grace_process = defineDecision({
  id: "applications.grace-process",
  title: "A rotated key's grace window is its own durable process",
  question: "What moves a key from grace to expired when its window ends?",
  options: [
    { label: "process", text: "One workflow per rotated key, started by `rotate`: a timer to `grace_ends_at`, then `expire`; a revoke signals it to end." },
    { label: "sweep", text: "A periodic sweep that expires every grace key past its window." },
    { label: "read-time", text: "No write: every reader treats a grace key past its window as expired." },
  ],
  chosen: "process",
  why:
    "A window is a date, and anything that waits on a date is a process with its own timer (A3, P3); a new sweep is not " +
    "one of P3's crons. Only rotated keys have a window, so most keys never have an instance. The bootstrap and `key list` " +
    "still treat a grace key past `grace_ends_at` as expired, so a timer that fires late never lengthens a window. A " +
    "revoke during the window would otherwise leave the instance waiting up to 30 days, so the revoke rpc signals it.",
  source: by(`${A}/keys/rules.ts:41; frozen key.rotate notes (30 days at most); rules.durable-processes`),
  affects: [workflow_applications_keys_grace, machine_app_key, rpc_applications_keys_revoke, rpc_applications_keys_list],
});

export const decision_applications_key_format = defineDecision({
  id: "applications.key-format",
  title: "Key format, hash and environment stay as they were",
  question: "What does a publishable key look like, what is stored, and when is it `live`?",
  options: [
    {
      label: "keep",
      text: "`cap_pk_test_` or `cap_pk_live_` and 32 Crockford characters (160 random bits); store its SHA-256, prefix and last four; `test` on devnet and staging, `live` on production.",
    },
    { label: "hmac", text: "Store a keyed MAC of the key instead of its hash." },
  ],
  chosen: "keep",
  why:
    "The format is what developers paste into `.env.local` and what the SDK checks before any request, so keeping it " +
    "keeps their apps working with the rebuilt SDK. A random 160-bit value needs no salt or key: a hash cannot be " +
    "reversed or guessed, and a MAC would only add a secret to rotate. The target deploys devnet and staging, so every " +
    "key it mints is `test`; `live` stays on the wire because `key list` shows each key's environment.",
  source: by(`${A}/rules.ts:18, :34; packages/protocol/src/applications/model.ts:41; ${A}/keys/rules.ts:15`),
  affects: [table_publishable_keys, table_quickstart_keys, rpc_applications_keys_create, flow_create_capxul_client],
});

export const decision_applications_quickstart_keys = defineDecision({
  id: "applications.quickstart-keys",
  title: "Quickstart keys are anonymous rows of their own, counted by address",
  question: "`dev key` mints a key with no sign-in. Where does an unowned key live, and how is the mint capped?",
  options: [
    {
      label: "own-table",
      text: "A `global` table of quickstart keys, each with one loopback origin and a keyed hash of the minting address; the mint counts that address's rows in the last hour.",
    },
    { label: "unowned-rows", text: "As before: an unowned `Quickstart <origin>` application and key, plus a per-IP window table." },
    { label: "system-owner", text: "Give quickstart keys a pseudo-owner in `publishable-keys`." },
  ],
  chosen: "own-table",
  why:
    "P8 has no tenant for a row nobody owns: an unowned key in the owner tables would be a hole in their row-level " +
    "security, and a pseudo-owner a tenant that is not one. A quickstart key can never be listed, rotated or revoked, so " +
    "it shares nothing with an owned key but the bootstrap's lookup, which reads both tables by a unique hash. Counting the " +
    "keys an address minted in the last hour replaces the window table, which kept a row per address forever and stored " +
    "the raw address; the hash keeps it unreadable. The route refuses WRONG_ENVIRONMENT outside a devnet or staging, " +
    "where the old one minted a production backend's test key.",
  source: by(`${ASIS}/quickstarts.ts:33 (production test keys); ${A}/quickstarts/rules.ts:11, :45; ${ASIS}/data.ts:175`),
  affects: [table_quickstart_keys, rpc_applications_quickstarts_mint, rpc_applications_bootstraps_resolve, error_WRONG_ENVIRONMENT],
});

export const decision_applications_key_list_pages = defineDecision({
  id: "applications.key-list-pages",
  title: "`key list` pages from the server, newest first by an index",
  question: "The old list read every key of every application and sorted them in memory, in one page. Keep that?",
  options: [
    { label: "pages", text: "One query on (owner, created_at, key_id), a limit and an opaque cursor bound to the owner, as the frozen `next` says." },
    { label: "one-page", text: "Read and sort everything in one page, as before." },
  ],
  chosen: "pages",
  why:
    "The frozen returns name `next`, where the next page starts, which the old code never filled. An index in the list's " +
    "order makes the page one range read, and the key id, a ULID, breaks a tie inside one millisecond, which is the " +
    "frozen claim the old code met by sorting on storage insertion time.",
  source: by(`${A}/keys/reads.ts:43, :61; frozen key.list returns and acceptance line 3`),
  affects: [rpc_applications_keys_list, table_publishable_keys, operation_key_list],
});

// ── the bootstrap ───────────────────────────────────────────────────────────────────────────

export const decision_applications_origin_token = defineDecision({
  id: "applications.origin-token",
  title: "The bootstrap hands the browser a short-lived origin token",
  question:
    "A key lets a web app sign people in, so the backend must accept requests from the key's origins. Sign-in once asked " +
    "applications whether a live key listed the origin. Access now sits below applications. How does the origin reach it?",
  options: [
    {
      label: "token",
      text: "The bootstrap answers a token, Capxul's MAC over the key id, the admitted origin and an expiry five minutes on; the runtime admits that origin while the token is good.",
    },
    { label: "read", text: "The runtime's CORS check reads applications' origins on every request, as sign-in's trusted-origin callback did." },
    { label: "config", text: "Only TRUSTED_ORIGINS: third-party apps cannot sign people in." },
  ],
  chosen: "token",
  why:
    "Access must depend on nothing (concepts.access), so it cannot read applications' tables, and a per-request read " +
    "would put a table lookup on every browser call. The token is checked with no read, and its five minutes match the " +
    "envelope's life, so a revoked or expired key stops working at the app's next bootstrap, as `key revoke` promises " +
    "('Apps that use it stop at their next sign-in'). TRUSTED_ORIGINS still names Capxul's own pages. The old " +
    "envelope's `bsk_` session token, which nothing stored or checked, is gone.",
  source: by(`${A}/keys/operations/trusts-origin.ts:16; ${ASIS}/bootstraps.ts:57 (bsk_ token); frozen key.revoke about`),
  affects: [rpc_applications_bootstraps_resolve, flow_create_capxul_client, rpc_applications_keys_revoke, component_backend, concept_access],
});

export const decision_applications_no_bootstrap_counter = defineDecision({
  id: "applications.no-bootstrap-counter",
  title: "No per-key bootstrap counter; the last use is stamped once a minute",
  question: "The old bootstrap counted every call on the key row (60 a minute) and stamped its last use. Keep both?",
  options: [
    { label: "stamp-only", text: "Keep the last-use stamp, written by one conditional update at most once a minute; drop the per-key counter." },
    { label: "keep", text: "Count every bootstrap on the key row and refuse the 61st in a minute." },
  ],
  chosen: "stamp-only",
  why:
    "`key list` shows when a key was last used, so the stamp stays. The counter made every bootstrap a write and capped a " +
    "real app at 60 browser starts a minute for all its users, which is a defect, not a limit; the protocol's per-origin " +
    "limit was never applied at all. An envelope lasts five minutes and the SDK caches it, so a well-behaved client " +
    "bootstraps rarely, and flooding an unauthenticated route is the deployment edge's to stop, as for every route.",
  source: by(`${A}/bootstraps/rules.ts:16, :46; packages/protocol/src/applications/policy.ts:5, :7`),
  affects: [rpc_applications_bootstraps_resolve, table_publishable_keys],
});

// ── who may manage keys ─────────────────────────────────────────────────────────────────────

export const decision_applications_invoicing_hat = defineDecision({
  id: "applications.invoicing-hat",
  title: "An Organization's keys: any member reads them, the Invoicing hat changes them",
  question: "Who may list, create, rotate and revoke an Organization's keys, and how is it checked?",
  options: [
    {
      label: "hat",
      text: "Read: a current Seat (organizations' members). Write: that Seat's Safe wears the Organization's Invoicing hat now, named by its deployment and worn in indexing's hat wearers.",
    },
    { label: "procedure", text: "Ask organizations through a procedure, as the old code asked `requireIssueInvoicesInTx`." },
  ],
  chosen: "hat",
  why:
    "The frozen `who` lines say 'for an Organization, a member who holds issue invoices' for every change and 'any " +
    "member' for the list. In v4 issuing invoices is the Invoicing officer hat, and applications depends on organizations " +
    "and indexing, so it reads the hat id and its wearers directly, as requests does; a procedure is only for a money " +
    "fact (rules.procedures). A key for someone else's Organization is ROLE_PERMISSION_DENIED before anything is read." + " Review, 11 November 2026: The surviving rule (An Organization's keys: any member reads them, the Invoicing hat changes them) still applies. Removed subjects in its historical evidence are not restored; cut.principle; aaron.one-door; sites.door; portal.plan-page governs their replacement.",
  source: by(`${A}/keys/guards.ts:37; packages/backend/src/organizations/members/reads/permissions.ts:67; frozen key.* who`),
  affects: [...KEY_RPCS, table_org_members, table_org_deployments, table_hat_wearers],
});

// ── what is not rebuilt ─────────────────────────────────────────────────────────────────────

export const decision_applications_registrations_in_keys = defineDecision({
  id: "applications.registrations-in-keys",
  title: "No registrations rpcs: `key create` makes and updates applications",
  question: "Old registrations had a list, a create and an internal register. Port them?",
  options: [
    { label: "fold", text: "Drop the three rpcs; `key create` makes the application it names, or replaces its origins." },
    { label: "keep", text: "Port the registrations list and create as their own rpcs." },
  ],
  chosen: "fold",
  why:
    "P2: no SDK method, CLI command or frozen operation called the registrations list or create, and the internal " +
    "register served only the quickstart mint, the devnet seed and operator scripts, which no longer register " +
    "applications (applications.no-unowned-registrations). `key create --app --origin` is the frozen way to make or " +
    "change an application.",
  source: by(`${ASIS}/registrations.ts:44, :70, :113; ${ASIS}/flows.ts:127 (no SDK method calls them); P2`),
  affects: [rpc_applications_keys_create, table_applications, concept_applications],
});

export const decision_applications_no_unowned_registrations = defineDecision({
  id: "applications.no-unowned-registrations",
  title: "No unowned applications: the devnet seed, host proofs and native clients go",
  question: "The devnet seed, disposable host proofs and the staging CLI's pinned native client registered applications with no owner. Keep them?",
  options: [
    { label: "drop", text: "Every application has an owner; worlds make keys through `key create`; the CLI needs no pinned key." },
    { label: "keep", text: "Keep unowned registrations for the seed, the proofs and the native clients." },
  ],
  chosen: "drop",
  why:
    "P8 has no tenant for them. The devnet seed is replaced by worlds, restored snapshots made by running the frozen " +
    "commands (P8's evals restore worlds). The host-proof applications existed to be retired by the repairs " +
    "(responsibilities.repairs). The pinned native client served the device flow, which is gone (access.no-device-flow), " +
    "and its key value was written in the code.",
  source: by(`${A}/model.ts:34, :46; ${ASIS}/procedures.ts:82; ${ASIS}/repairs.ts:104; operator/fixtures/writes.ts:137`),
  affects: [table_applications, table_publishable_keys, concept_applications],
});

export const decision_applications_no_consent = defineDecision({
  id: "applications.no-consent",
  title: "No application consent table",
  question: "The concept map gives applications a person's consent to an application (old access' `userAppConsents`). Rebuild it?",
  options: [
    { label: "drop", text: "No consent table: nothing in the target writes or reads one." },
    { label: "keep", text: "Port the consent rows and the consented-caller guard into applications." },
  ],
  chosen: "drop",
  why:
    "P2. Its one writer was the native client accept of the device flow, which is not ported (access.no-device-flow), and " +
    "its one reader outside access was operator's probes. An assistant's consent is access's assistant grant, and the " +
    "bootstrap grants no consent and no authority: a person signs in and acts on their own Safe. If a later frozen " +
    "operation needs an application's consent, it lands here, by this concept's map entry.",
  source: by(`docs/as-is/archive/access/data.ts:39; docs/as-is/archive/access/procedures.ts:305; blueprint/access/decisions.ts:171`),
  affects: [concept_applications, concept_access],
});

export const decision_applications_no_door = defineDecision({
  id: "applications.no-door",
  title: "Applications' door has no procedures",
  question: "The old door exported a credential hash, an owned-application read, the native client metadata and an observation hint. Keep any?",
  options: [
    { label: "none", text: "None: no money fact writes applications' tables, and nothing below it may read them." },
    { label: "keep", text: "Port the four door functions as procedures." },
  ],
  chosen: "none",
  why:
    "A procedure is for one money fact (rules.procedures), and a key is not one. The credential hash was a pure function " +
    "access borrowed; access hashes its own secrets. The owned-application read served operator purges, which worlds " +
    "replace. The native client metadata served the device flow (access.no-device-flow). The observation hint had no " +
    "caller. The constants and HTTP helpers the door also exported are the runtime's.",
  source: by(`${ASIS}/procedures.ts:23, :43, :63, :82; ${A}/index.ts:8`),
  affects: [concept_applications],
});

export const decision_applications_dropped = defineDecision({
  id: "applications.dropped",
  title: "Old applications plumbing that is not rebuilt",
  question: "Which other old applications functions have no place in the target?",
  options: [
    {
      label: "drop-or-fold",
      text: "The two CORS preflights (the runtime's), admit-key and record-use (steps of the bootstrap), claim (a step of the mint), issue and revoke-by-id (operator scripts), trusts-origin (applications.origin-token) and emit-transitioned (P7).",
    },
    { label: "keep", text: "Port each as an rpc." },
  ],
  chosen: "drop-or-fold",
  why:
    "Convex split one request into a query, a mutation and an action (P3); on Node the bootstrap and the mint each read " +
    "and write in one transaction. A preflight is an HTTP answer the runtime gives every route. `issue` and " +
    "`revoke-by-id` were run by hand with `convex run` and no frozen operation reaches them (P2). The telemetry action " +
    "is replaced by the transition's event in the outbox (P7, rules.outbox).",
  source: by(`${ASIS}/bootstraps.ts:125, :150, :178; ${ASIS}/keys.ts:253, :283, :322, :347; ${ASIS}/quickstarts.ts:95, :118`),
  affects: [rpc_applications_bootstraps_resolve, rpc_applications_quickstarts_mint, concept_applications],
});

export const decision_applications_health_only = defineDecision({
  id: "applications.health-only",
  title: "Of old operator's diagnostics, only the health check is ported",
  question: "Old diagnostics answered health, the environment, the business clock and a devnet's chain head. Which land here?",
  options: [
    { label: "health", text: "Only the health check, for `doctor --online`, with the deployed commit added." },
    { label: "all", text: "Port all four as public rpcs." },
  ],
  chosen: "health",
  why:
    "P2: `doctor` is the frozen operation that reaches diagnostics, and it calls only health. The environment answer " +
    "reported an e2e auth gate the target does not have; devnet time and its offset are devnet's (`dev time`); the chain " +
    "head is indexing's progress. Health now names the commit as well as the deployment, which is what an operator asks " +
    "after a deploy, and it still reads nothing, so it answers even when a dependency is down.",
  source: by(`docs/as-is/archive/operator/diagnostics.ts:25, :50, :82, :107; frozen doctor notes`),
  affects: [rpc_applications_health_check, flow_client_system_health],
});

// ── operations and flows ────────────────────────────────────────────────────────────────────

export const decision_applications_flows = defineDecision({
  id: "applications.flows",
  title: "Which commands are flows, and one owner input for both accounts",
  question: "Which of the six operations are one rpc, which are Core SDK flows, and how does `--org` reach the SDK?",
  options: [
    {
      label: "split",
      text: "`key create` and `key list` are one rpc each; `key rotate` and `key revoke` (confirm, then one rpc), `doctor` and `dev key` are flows; the owner is an input.",
    },
    { label: "all-rpcs", text: "Every command one rpc, the CLI prompting and writing files itself." },
  ],
  chosen: "split",
  why:
    "A4: the CLI calls one SDK method and the SDK owns every step past the command line. Rotate and revoke ask at a " +
    "terminal before their write, as contacts' guided commands do; doctor composes local reads with two backend calls; " +
    "dev key checks and writes a file around one call. The owner input replaces the old `client.org(id).keys` twin of " +
    "`client.account.keys`. `createCapxulClient` serves the web surfaces and has no operation; its flow is what every " +
    "browser runs first.",
  source: by(`${ASIS}/flows.ts:127; apps/cli/src/commands/key/subcommands/revoke/execute.ts:20; A4`),
  affects: [
    flow_client_account_keys_rotate, flow_client_account_keys_revoke, flow_client_system_health, flow_client_dev_key,
    flow_create_capxul_client, ...KEY_OPERATIONS, operation_doctor, operation_dev_key,
  ],
});

export const decision_applications_dev_key_flow = defineDecision({
  id: "applications.dev-key-flow",
  title: "`dev key` is a flow in the Core SDK's Node-only test entry",
  question: "The frozen note says `dev key` has no public SDK method and its SDK layer stays unmapped. A4 says the CLI calls one SDK method. Which holds?",
  options: [
    { label: "test-entry", text: "A flow in the Core SDK's Node-only test entry, beside the devnet entry: an SDK method, but not one of the public client's." },
    { label: "cli-only", text: "The CLI posts to the mint route itself, as before." },
  ],
  chosen: "test-entry",
  why:
    "A4 and the CLI component: the CLI calls no backend route itself (the old CLI reached around the SDK here, a finding " +
    "of the foundation review). Putting the flow in the Node-only test entry keeps the frozen note true, since no public " +
    "client gains a method, and keeps file writing out of browsers. It works on staging too, so it is not the devnet " +
    "entry, which talks to the supervisor.",
  source: by(`apps/cli/src/commands/dev/key.ts:65; docs/as-is/lane-reports/review-foundation.json (CLI reaches around the SDK); A4`),
  affects: [flow_client_dev_key, operation_dev_key],
});

export const decision_applications_doctor_exit = defineDecision({
  id: "applications.doctor-exit",
  title: "`doctor` exits 124 at a deadline, and a wrong echo is an unusable answer",
  question: "How does `doctor --online` fail at its deadline, and when the backend's answer does not echo the nonce?",
  options: [
    { label: "124-and-invalid", text: "NETWORK_ERROR with mode `timeout` and exit 124 at either deadline; a missing or wrong echo is PROVIDER_RESPONSE_INVALID." },
    { label: "as-before", text: "Exit 124 at a deadline; a wrong echo is PROVIDER_ERROR, as the old CLI said." },
  ],
  chosen: "124-and-invalid",
  why:
    "Decision vocabulary.doctor-deadline-exit leaves NETWORK_ERROR at exit 5 everywhere else and asks this concept to " +
    "book `doctor`'s 124, which its frozen notes and acceptance name: the CLI maps the flow's deadline failure to 124. " +
    "An answer that arrived but does not echo the run's nonce is an answer Capxul cannot use, which is what " +
    "PROVIDER_RESPONSE_INVALID means; PROVIDER_ERROR says the service did not complete, which it did.",
  source: by(`apps/cli/src/commands/doctor/execute.ts:30, :50; apps/cli/src/commands/doctor/internal/probe.ts:48; vocabulary.doctor-deadline-exit`),
  affects: [operation_doctor, flow_client_system_health, error_NETWORK_ERROR, error_PROVIDER_RESPONSE_INVALID],
});

export const decision_applications_budgets = defineDecision({
  id: "applications.budgets",
  title: "Budgets: class defaults, and one override for `doctor`",
  question: "Which budget class does each piece take, and where are the defaults wrong?",
  options: [
    { label: "defaults", text: "Class defaults everywhere: reads `read`, writes and the two HTTP routes `write`, the grace process `background`; `doctor` overrides `read`." },
    { label: "bootstrap-read", text: "Give the bootstrap `read`, since it writes at most once a minute per key." },
  ],
  chosen: "defaults",
  why:
    "P5. The bootstrap is a transaction that may write the stamp, so its server share is a write's. `doctor --online` " +
    "makes two backend calls in sequence, the bootstrap and then the health check at the backend the envelope names, so " +
    "it gets two reads' time (1,000 ms and 2,000 ms); offline it is local and far inside that. `key rotate` and `key " +
    "revoke` keep the write default and exclude the person's confirmation.",
  source: by(`packages/blueprint-engine/src/budgets.ts; docs/decisions/policy-pack.md#p5`),
  affects: [operation_doctor, flow_client_system_health, rpc_applications_bootstraps_resolve, workflow_applications_keys_grace],
});

export const decision_applications_acceptance_rewrites = defineDecision({
  id: "applications.acceptance-rewrites",
  title: "Three acceptance lines that named a mechanism, rewritten as outcomes",
  question: "Which frozen claims name something a black box cannot see, and what do they become?",
  options: [
    {
      label: "rewrite-three",
      text: "`doctor` #3's 'the row' becomes its trace; `key revoke` #3 and `key rotate` #5's 'before restoring a session' become 'before any call, whether or not anyone is signed in here'.",
    },
    { label: "keep", text: "Keep all lines word for word." },
  ],
  chosen: "rewrite-three",
  why:
    "P1. 'The row' is the old backend's telemetry row, which the target replaces with traces; the trace observer sees " +
    "the same mode. Restoring a session is a CLI step no observer sees; what it guaranteed is that a script without " +
    "`--confirm` fails as usage before touching anything, signed in or not. Both rewrites pass against the old system: " +
    "its CLI refused before the session read, so it refused alike with no one signed in. Every other line is word for word.",
  source: by(`frozen doctor acceptance 3; frozen key.revoke acceptance 3; frozen key.rotate acceptance 5; P1`),
  affects: [operation_doctor, operation_key_revoke, operation_key_rotate],
});

export const decision_applications_worlds = defineDecision({
  id: "applications.worlds",
  title: "The worlds applications' refusals and claims are reached from",
  question: "Which named devnet snapshots do the six operations need?",
  options: [
    {
      label: "four-new",
      text: "Reuse access's `empty-devnet` and `person-signed-in`; add `people-with-keys`, `person-at-key-limit`, `org-with-keys` and `quickstart-quota-spent`.",
    },
    { label: "one-world", text: "One large world holding every case." },
  ],
  chosen: "four-new",
  why:
    "`people-with-keys`: two people signed in; the first holds an active key, a key in its grace window and a revoked " +
    "key, two of them made in one millisecond, the second one active key; one quickstart key. `person-at-key-limit`: a " +
    "person holding 20 active keys. `org-with-keys`: the Organization acme with one key; Ivy wears its Invoicing hat, Max " +
    "is a member without it, Olu is outside it, all signed in here. `quickstart-quota-spent`: one address minted 15 " +
    "quickstart keys in the last hour. A world per case keeps each diff small.",
  source: by(`blueprint/access/decisions.ts:430 (access.worlds); frozen key.*, doctor and dev.key refusals`),
  affects: [...KEY_OPERATIONS, operation_doctor, operation_dev_key],
});
