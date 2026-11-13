// Every judgment the target architecture makes, as a decision record (defineDecision). Ids are
// grouped by prefix: components, concepts, dependencies, rules, vocabulary, integrations, contracts,
// environments, system and operations. Each record names the records it affects; the build checks
// every one of those links. docs/decisions/target-architecture.md is the readable account.
//
// Made by Claude on 7 November 2026, under Aaron's accepted decisions A1-A4 and P1-P10, with the old
// system (/home/user/factory, integration/factory) and the as-is book as evidence.

import { defineDecision, type Concept } from "../../packages/blueprint-engine/src/index.ts";
import * as f from "./foundation.ts";
import * as v from "./vocabulary.ts";
import * as x from "./external.ts";

const CLAUDE = "Claude, target architecture, 7 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;

export const decision_contracts_safe_nonce_read = defineDecision({
  id: "contracts.safe-nonce-read",
  title: "Declare the existing Safe transaction nonce getter",
  question: "Which nonce does Board read alongside the Safe's owners and threshold?",
  options: [
    { label: "safe-getter", text: "Declare Safe 1.5.0's nonce() uint256 getter for the same pinned-block read." },
    { label: "derived", text: "Infer a Safe nonce from other transaction counts or indexed events." },
  ],
  chosen: "safe-getter",
  why:
    "Safe 1.5.0 declares uint256 public override nonce; the existing installer and fork test interfaces already expose its view getter. " +
    "Board's live planning needs that Safe transaction nonce, not an account nonce or ERC-4337 nonce. " +
    "This fills the external contract record only: no new provider, policy, historical snapshot or execution proof is introduced.",
  source: "safe-global/safe-smart-account v1.5.0 contracts/Safe.sol:64; packages/contracts/test/utils/Installer/ExternalViews.sol:42; packages/contracts/test/fork/Interfaces.sol:51, 12 November 2026",
  affects: [x.contract_safe, f.concept_board],
});

export const decision_contracts_gate_threshold_read = defineDecision({
  id: "contracts.gate-threshold-read",
  title: "Read the Gate's actual threshold configuration for Board cleanup",
  question: "Which existing contract read exposes the rule needed to evaluate a lapsed-owner removal?",
  options: [
    { label: "gate-config", text: "Expose the verified Gate thresholdConfig tuple and combine it with live owners and signer validity." },
    { label: "safe-threshold", text: "Infer the configured rule from the Safe's current threshold alone." },
  ],
  chosen: "gate-config",
  why:
    "The verified Hats Signer Gate v2 implementation returns one tuple with uint8 thresholdType and uint120 min/target. " +
    "InstallerMoney already reads this getter and computes the configured required signatures against the owner count, capped by that count. " +
    "Safe.getThreshold alone cannot distinguish absolute and proportional configuration after an owner lapses. " +
    "This adds contract-reading parity only; it neither changes the contract nor establishes a historical owner snapshot or Board cleanup proof.",
  source: "Base Sepolia verified HatsSignerGate 0x148057884AC910Bdd93693F230C5c35a8c47CA3b thresholdConfig ABI/source; packages/contracts/src/authority/InstallerMoney.sol:16,305-313, 12 November 2026",
  affects: [x.contract_hats_signer_gate, f.concept_board],
});

export const decision_integrations_indexed_claim = defineDecision({
  id: "integrations.indexed-claim",
  title: "Claim admission requires a real indexed occurrence and current sole signer",
  question: "What proves personal-Safe setup or adoption when it need not send a new transaction?",
  options: [
    { label: "indexed-occurrence", text: "Read the owner-scoped indexed claim, current sole-owner projection and real Ponder progress in one SQL snapshot, with deployment finality." },
    { label: "ownership-only", text: "Trust current chain ownership or an injected claimed boolean without the claim occurrence." },
  ],
  chosen: "indexed-occurrence",
  why:
    "Adoption may use a prior CapxulSafeClaimed rather than a new receipt. Ownership alone does not prove that event or its transaction/block identity. " +
    "The same-Sql provider reads app views, not raw Ponder, and returns the actual occurrence only after readiness, cutoff/finality and current sole-signer checks. " +
    "A missing or lagging occurrence returns pending; unavailable or malformed provider state refuses safely. No separate read may combine a pre-reindex claim with a post-reindex checkpoint. " +
    "This current-ownership admission is not a historical owner/approval snapshot for Board settlement.",
  source: "indexer; accounts setup/adoption provider contract; Core projection PR59, 12 November 2026",
  affects: [x.integration_indexer, f.concept_accounts],
});

export const decision_integrations_claim_signer = defineDecision({
  id: "integrations.claim-signer",
  title: "The personal-Safe service signer exposes only its configured claim role",
  question: "How does account setup recover a lost broadcast answer without signing a second transaction?",
  options: [
    { label: "durable-claim", text: "Accept a stable setup person/attempt key and claim arguments only; commit signed bytes and hash before a single broadcast attempt, then recover that hash." },
    { label: "wallet", text: "Give account setup an unrestricted wallet and let each retry prepare a transaction." },
  ],
  chosen: "durable-claim",
  why:
    "Service keys belong to the backend and on-chain Roles confines the claim key to its configured claimer, namespace and delegatecall. " +
    "The provider never accepts arbitrary targets, data, role or value. A worker-only durable lane serializes the account and keeps signed bytes before broadcast. " +
    "An attempted send, even with an unknown answer or a crash before ingress, is never broadcast again automatically; retries return its existing hash. " +
    "The lane stays busy until a canonical receipt is observed, not just until an RPC answers. A successful receipt must include the expected claim event from Companies House. " +
    "Known claim reverts map to the account vocabulary; unavailable historical revert data remains TRANSACTION_FAILED, never an invented contract refusal. " +
    "No configured service credential or verified on-chain role means no live provider proof; a generic funded wallet cannot substitute for that role.",
  source: "responsibilities.service-lanes; components.service-keys; service-signer; Access claim boundary, 12 November 2026",
  affects: [x.integration_service_signer, f.concept_accounts, x.contract_companies_house_claimer],
});

export const decision_runtime_record_business_instant = defineDecision({
  id: "runtime.record-business-instant",
  title: "Record a supplied business instant in the source transaction",
  question: "How can migrated concept writers date their records without silently retaining host time?",
  options: [
    { label: "explicit-instant", text: "The common record writer accepts an optional epoch-millisecond instant; migrated callers require and supply canonical world time in the same SQL transaction." },
    { label: "database-now", text: "Keep dating every record with the database clock even when its source row uses world time." },
  ],
  chosen: "explicit-instant",
  why:
    "time.real-elapsed excludes host time from product timestamps. Sites supplies the same canonical instant for its row and event, including when the world is stopped. " +
    "The existing record writer retains its source transaction, organization lock, ordering and hash chain. An explicit zero is an instant, not an omitted value. " +
    "Existing five-argument callers retain database-time behavior until separately migrated; the optional parameter does not claim those callers satisfy world-clock acceptance. " +
    "This adds no clock derivation, fallback for migrated callers, schema migration or public route.",
  source: "time.real-elapsed; Sites native frozen-clock regression and integrator event-writer lease, 12 November 2026",
  affects: [f.component_backend],
});

export const decision_runtime_retained_spans = defineDecision({
  id: "runtime.retained-spans",
  title: "Retain completed Effect spans independently of business records",
  question: "What authoritative source proves a server span and its provider children in the selected world?",
  options: [
    { label: "effect-tracer", text: "An Effect tracer retains completed spans with world, build, run and call identity; a restricted diagnostic reader reads those spans." },
    { label: "business-records", text: "Treat arbitrary business records or caller-authored span JSON as tracing evidence." },
  ],
  chosen: "effect-tracer",
  why:
    "A business record cannot establish that a named server span ran. The native Effect span lifecycle supplies ids, parentage, timing and completion. " +
    "Only identifier attributes are retained: no inputs, return values, error messages, bearer, mailbox, memo or suggestion. " +
    "The collector records completion outside the source transaction so a refused or rolled-back RPC remains observable. " +
    "Explicit flush exposes retention failure; it never claims a missing span passed. Provisioning and server/consumer composition remain integrator-owned. " +
    "Host-clock span durations measure system time, not the stopped world's business instant; transition timestamps still come from the authoritative world clock.",
  source: "P6; signals.envelope; Books same-run server/provider span contract, 12 November 2026",
  affects: [f.component_backend, f.system_capxul],
});

export const decision_integrations_mail_transport = defineDecision({
  id: "integrations.mail-transport",
  title: "Mail makes one attempt and leaves durable retry to its caller",
  question: "Where are notice retries and world mail isolation enforced?",
  options: [
    { label: "caller-retry", text: "Mail forwards the caller's exact idempotency key once; notices retries durably and devnet supplies its existing sink." },
    { label: "provider-retry", text: "Mail retries requests and maintains a second retry queue and world sink." },
  ],
  chosen: "caller-retry",
  why:
    "The existing Mail contract has zero retries. Notices owns its three durable attempts and crash replay, so Mail must not multiply them. " +
    "The live Resend adapter checks every staging recipient before making a request and classifies recipient refusal, throttling and unavailability. " +
    "Its transport is injectable for failure validation; local HTTP fault tests are not live Resend conformance. Devnet owns durable sink records, fault spending and world time; no parallel shared sink is created.",
  source: "Shared123 and notices provider handoff, 12 November 2026; integration:mail; devnet.mail-sink; time.world-channels",
  affects: [x.integration_mail],
});

export const decision_runtime_transition_outbox = defineDecision({
  id: "runtime.transition-outbox",
  title: "Committed transition delivery keeps source and consumer transactions separate",
  question: "How does the common runtime outbox carry personal and organization transitions safely?",
  options: [
    { label: "same-connection", text: "Emit on the source transaction's SQL connection; schedule each consumer effect and ACK together in another transaction." },
    { label: "records", text: "Reuse organization financial records or let each concept create its own source outbox." },
  ],
  chosen: "same-connection",
  why:
    "rules.outbox already requires one runtime source. An immutable caller-stable event id deduplicates retries; its properties are exactly the transition's declared event schema. " +
    "Machine, opaque source entity, owner, actor, trace and authoritative world milliseconds are envelope metadata, never extra analytics properties. " +
    "Unlisted admissions need no organization or principal FK. Worker-only delivery records keep each named consumer's SQL effects and ACK atomic, so death before commit rolls both back; later relay retries cannot apply an acknowledged effect twice. " +
    "Handlers schedule durable work, never send mail or perform other network effects inside their ACK transaction. Composition names consumers explicitly rather than a plugin registry.",
  source: "rules.outbox; integrator's isolated runtime lease and Accounts/Requests/Notices/Activity/Board/Books API agreement, 12 November 2026",
  affects: [f.component_backend],
});

export const decision_integrations_surface_gap_audit = defineDecision({
  id: "integrations.surface-gap-audit",
  title: "Remove outside calls with no surviving Core caller",
  question: "Which unused calls survive the Frappe-native cut?",
  options: [
    { label: "remove", text: "Remove unused members, not their integrations or behaviour now owned by Frappe." },
    { label: "invent-callers", text: "Add Core processes solely to consume old calls." },
  ],
  chosen: "remove",
  why:
    "chain-rpc.getTransactionReceipt has no caller: indexing and the bundler receipt path serve settlement. " +
    "chainlink.usdRate lost its price-sync workflow in the books cut; Core keeps the rate call it uses. " +
    "devnet-control.worldRead and worldList duplicate the surviving world rpcs, which read registry rows even while the chain is stopped. " +
    "fde-host.start, pause, resume, retire, send and turn lost their lifecycle and conversation callers in the FDE cut; provision remains reached. " +
    "mail.getReceived and whatsapp.readNumber, subscribeApp and sendMessage belonged to Core CRM conversations; Frappe owns those now. " +
    "posthog.capture and exportTelemetry have no product caller: tracing and the world record are runtime facilities, not new business workflows. " +
    "Removing these 16 members does not remove any operation, refusal or acceptance claim.",
  source: "m1-gaps-surface, 10 November 2026; evidence: lane var/blueprint/findings.json; blueprint/shared/cut.ts; blueprint/devnet/world-rpcs.ts",
  affects: [x.integration_chain_rpc, x.integration_chainlink, x.integration_devnet_control, x.integration_fde_host, x.integration_mail, x.integration_whatsapp, x.integration_posthog],
});

// ── components ──────────────────────────────────────────────────────────────────────────────

export const decision_components_backend = defineDecision({
  id: "components.backend",
  title: "One backend service on Node, with its durable work inside it",
  question: "What runs Capxul's server side: one service, or a service per concept, and where does durable work run?",
  options: [
    { label: "one", text: "One Effect 4 Node service hosts every concept's rpcs, HTTP routes and durable processes (Effect Workflow and Cluster on Postgres)." },
    { label: "per-concept", text: "One service per concept, talking over the network." },
    { label: "split-worker", text: "One request service and a separate worker service for workflows." },
  ],
  chosen: "one",
  why:
    "A1 fixes Effect 4 on Node and A2 fixes Effect Workflow and Cluster on Postgres. Concepts are modules, not services: a " +
    "procedure runs in its invoker's transaction, which only one process and one database can give. Cluster already runs " +
    "the workflow runners inside the same service and spreads them over its instances, so a separate worker adds a deploy " +
    "and a network hop for nothing. If the A2 spike fails, DBOS runs in the same process, so this choice survives it.",
  source: by("A1, A2; the old Convex backend ran 748 functions as one deployment"),
  affects: [f.component_backend],
});

export const decision_components_postgres = defineDecision({
  id: "components.postgres",
  title: "One Postgres with an app schema and a Ponder schema",
  question: "How are the concepts' tables, Ponder's tables, the workflow state and files laid out in Postgres?",
  options: [
    { label: "two-schemas", text: "One database: `app` (concept tables with RLS, workflow state, outbox, files) and `ponder` (Ponder-owned, read through views)." },
    { label: "two-databases", text: "Separate databases for the app and for Ponder, joined by the application." },
    { label: "schema-per-concept", text: "One schema per concept plus Ponder's." },
  ],
  chosen: "two-schemas",
  why:
    "A1 says one Postgres with Ponder on it, and P8 reads chain facts through views joined to the Safe-ownership table, " +
    "which needs both in one database. Ponder rebuilds its own schema on a reindex, so it must be separate from the app's " +
    "and nothing in `app` may hold a foreign key into it. A schema per concept adds nothing the book's boundary rules do " +
    "not already check, and makes every procedure's transaction span schemas for no gain.",
  source: by("A1; P8; apps/indexer/ponder.config.ts:96 (Ponder already ran on Postgres)"),
  affects: [f.component_postgres, f.component_ponder, f.concept_indexing],
});

export const decision_components_ponder = defineDecision({
  id: "components.ponder",
  title: "Ponder writes its schema; Capxul reads it in Postgres, never over HTTP",
  question: "How do the backend and clients read indexed chain facts, and does Ponder call the backend?",
  options: [
    { label: "views", text: "The backend reads Ponder's tables as views in the same Postgres; Ponder serves only health and metrics and calls nothing." },
    { label: "sql-http", text: "Keep Ponder's `/sql/db` and `/sql/live` HTTP endpoints, authorized by a session claim, read by the backend and the SDK." },
  ],
  chosen: "views",
  why:
    "The old indexer authorized every query against a signed `safes` claim it verified with the backend's JWKS, so the " +
    "indexer depended on the backend and the backend on the indexer: a component cycle. With views in the same Postgres, " +
    "row-level security does the scoping (P8), the SDK reads through rpcs, and Ponder depends only on the chain and " +
    "Postgres. The SQL-over-HTTP path also forced compiled query shapes to authorize; views need none.",
  source: by("apps/indexer/src/auth.ts:145-176; apps/indexer/src/query-authorization.ts; P8"),
  affects: [f.component_ponder, f.component_backend, f.component_core_sdk],
});

export const decision_components_bundler_paymaster = defineDecision({
  id: "components.bundler-paymaster",
  title: "Bundler and paymaster are one component, called only by the backend",
  question: "Is the bundler a separate component from the paymaster, and may the SDK call it?",
  options: [
    { label: "one-backend-only", text: "One component (the AA gateway on staging, alto with the mock paymaster on a devnet); only the backend calls it." },
    { label: "two", text: "Book the bundler and the paymaster as two components, as the old book did." },
    { label: "sdk-calls", text: "Let the SDK send its own UserOperations to the bundler after signing." },
  ],
  chosen: "one-backend-only",
  why:
    "Staging serves both behind one URL and one token, and the backend reads no gateway secret but that URL, so two records " +
    "would describe one thing. Sending stays server-side because the approval's durable process must own the one send and " +
    "its lookup (K4: one send per signed operation), and the paymaster's token must not ship in a client. A4 gives the SDK " +
    "signing, not sending.",
  source: by("packages/aa-gateway/README.md:12-42; apps/docs/factory/components/bundler.yaml; K4 in docs/as-is/payments.md"),
  affects: [f.component_bundler_paymaster, f.component_core_sdk, f.concept_approvals, x.integration_bundler],
});

export const decision_components_core_sdk = defineDecision({
  id: "components.core-sdk",
  title: "The Core SDK owns every flow and all signing, and calls only the backend",
  question: "What does the Core SDK depend on, and where do multi-step operations and signatures live?",
  options: [
    { label: "backend-only", text: "Flows and signing in the SDK (A4); it reaches only the backend's rpcs, never the indexer, the chain or the bundler." },
    { label: "direct-reads", text: "Keep the old SDK's direct indexer reads for balances and history." },
  ],
  chosen: "backend-only",
  why:
    "A4 accepts the first half. The second follows from P8: a direct indexer read needs its own authorization, which is " +
    "what built the old component cycle; an rpc over a Safe-scoped view gets tenancy from row-level security for free. One " +
    "path also gives one span tree per operation (P6).",
  source: by("A4; packages/sdk/src/indexing/ponder/reads.ts:203 (the old direct read)"),
  affects: [f.component_core_sdk, f.component_react_sdk],
});

export const decision_components_cli = defineDecision({
  id: "components.cli",
  title: "The CLI calls exactly one SDK method per command",
  question: "May the CLI orchestrate several SDK calls, or call the backend itself?",
  options: [
    { label: "one-method", text: "Each command calls one Core SDK method; the CLI parses, prompts, prints and exits, nothing else." },
    { label: "orchestrate", text: "Keep the CLI's own helpers that compose SDK and protocol calls." },
  ],
  chosen: "one-method",
  why:
    "A4. The old CLI held about 20k lines of orchestration that duplicated the SDK, imported the protocol package in 64 " +
    "files and called the backend Site directly in three places. With one method per command, the operation's " +
    "`implementedBy` is that method's flow or rpc, and the React app and the MCP server get the same behaviour.",
  source: by("A4; docs/mission/findings.md (CLI orchestration); apps/cli/src/auth/native-grant-cleanup.ts:45"),
  affects: [f.component_cli, f.component_mcp_server],
});

export const decision_components_react_sdk = defineDecision({
  id: "components.react-sdk",
  title: "The React SDK projects the Core SDK and nothing else",
  question: "Does the React SDK get its own transport or logic?",
  options: [
    { label: "projection", text: "Hooks over Core SDK flows and live rpcs; no transport and no logic of its own." },
    { label: "own-transport", text: "Keep a React-side subscription transport, as the old Convex hooks had." },
  ],
  chosen: "projection",
  why:
    "One client implementation keeps one span tree and one error mapping. Live rpcs replace the 27 Convex subscriptions, " +
    "so React needs no transport of its own. The approval page is built on it.",
  source: by("docs/mission/findings.md: the SDK uses 27 live subscriptions over convex/browser"),
  affects: [f.component_react_sdk],
});

export const decision_components_mcp_server = defineDecision({
  id: "components.mcp-server",
  title: "The MCP server is a Core SDK host like the CLI",
  question: "How does the MCP server reach Capxul?",
  options: [
    { label: "sdk-host", text: "Its tools call Core SDK methods with the person's OAuth grant, like the CLI." },
    { label: "backend-direct", text: "Its tools call the backend's rpcs directly." },
  ],
  chosen: "sdk-host",
  why: "Its tools are the same operations as CLI commands, so they should be the same flows; the OAuth grant is access' and reaches it through the SDK.",
  source: by("apps/mcp/README.md:3; the old MCP server's 11 tools over the SDK"),
  affects: [f.component_mcp_server],
});

export const decision_components_devnet = defineDecision({
  id: "components.devnet",
  title: "The devnet is a component: a supervisor with a real Postgres",
  question: "Is the devnet a component, and what database does it run?",
  options: [
    { label: "supervisor-postgres", text: "A supervisor process that boots the stack, deploys v4, snapshots worlds and clocks; a real Postgres server from a pinned binary." },
    { label: "pglite", text: "Keep the old devnet's PGlite for the indexer, and give the backend its own store." },
    { label: "docker", text: "Run the stack in Docker Compose." },
  ],
  chosen: "supervisor-postgres",
  why:
    "Eval worlds are snapshots of the chain, the database and Ponder together, so something must own them: the supervisor. " +
    "The backend and Ponder share one Postgres with row-level security, which PGlite cannot serve to two processes; Docker " +
    "is not available in the swarmD sandboxes the spec targets. A pinned Postgres binary boots in seconds.",
  source: by("packages/devnet/README.md:21-66 (no Docker, PGlite in the slot); docs/spec/40-capxul-team.md (the devnet spike)"),
  affects: [f.component_devnet, f.environment_devnet, x.integration_devnet_control],
});

export const decision_components_graph = defineDecision({
  id: "components.graph",
  title: "The component graph has no cycle",
  question: "Which component depends on which?",
  options: [
    {
      label: "dag",
      text:
        "chain, postgres: none; ponder: chain, postgres; bundler-paymaster: chain; backend: postgres, ponder, chain, " +
        "bundler-paymaster; core-sdk: backend; react-sdk, cli, mcp-server: core-sdk; devnet: everything it boots.",
    },
    { label: "as-is", text: "Keep the old edges: the indexer fetching the backend's JWKS and the SDK reading the indexer." },
  ],
  chosen: "dag",
  why:
    "The old backend read the indexer and the indexer fetched the backend's keys: a cycle the as-is build reports. Reading " +
    "Ponder in Postgres removes the indexer's edge to the backend. The Core SDK's devnet entry reaches the supervisor " +
    "through an integration, not a component edge, so a staging client depends on nothing devnet.",
  source: by("docs/as-is/archive/shared/foundation.ts (component cycle); docs/as-is/payments.md (17 cycle problems)"),
  affects: [
    f.component_chain, f.component_postgres, f.component_ponder, f.component_bundler_paymaster, f.component_backend,
    f.component_core_sdk, f.component_react_sdk, f.component_cli, f.component_mcp_server, f.component_devnet,
  ],
});

export const decision_components_files = defineDecision({
  id: "components.files",
  title: "Stored files live in Postgres",
  question: "Where do uploaded files (logos, photos, verification documents) live without Convex file storage?",
  options: [
    { label: "postgres", text: "In Postgres, behind a BlobStore service, with media's size limits (24 MB at most)." },
    { label: "object-store", text: "An S3-compatible bucket as an eleventh component." },
  ],
  chosen: "postgres",
  why:
    "A1 says one Postgres, and the files are few and small: logos, photos and identity documents of at most 24 MB. A " +
    "bucket would add a component, a secret and a second thing to snapshot in every devnet world. The BlobStore service " +
    "makes a move to a bucket a layer change if volume ever needs it.",
  source: by("apps/docs/factory/operations/verify.start.yaml (24 MB limit); docs/mission/findings.md (13 file storage uses)"),
  affects: [f.component_postgres, f.concept_media],
});

// ── concepts ────────────────────────────────────────────────────────────────────────────────

export const decision_concepts_map = defineDecision({
  id: "concepts.map",
  title: "23 target concepts in one dependency order",
  question: "How many concepts, and in what order, so that every old responsibility lands once and nothing loops?",
  options: [
  {
    "label": "current-scope",
    "text": "The built foundation dependency graph, not the historical count of 23, is the concept map. Contacts, projects and HR business records move to sites through the door; chain agreements stay in payments; plugs owns chain-to-site projection. Parked equity and hosted FDE work do not impose active build layers."
  },
  {
    "label": "historical",
    "text": "The former answer to concepts.map is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: The built foundation dependency graph, not the historical count of 23, is the concept map. Contacts, projects and HR business records move to sites through the door; chain agreements stay in payments; plugs owns chain-to-site projection. Parked equity and hosted FDE work do not impose active build layers. Authority: cut.principle; aaron.one-door; sites.door; portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; cut.principle; aaron.one-door; sites.door; portal.plan-page",
  affects: [...f.CONCEPTS],
});

export const decision_concepts_access = defineDecision({
  id: "concepts.access",
  title: "Access keeps sign-in and sessions and moves to the bottom",
  question: "What does access own, and how does it get to depend on nothing?",
  options: [
    { label: "bottom", text: "Principals, sessions, sign-in, assistant grants and gates; the waitlist, referrals, consent and the indexer scope leave it." },
    { label: "as-is", text: "Keep access as it was, importing accounts, applications, organizations, parties and profiles." },
  ],
  chosen: "bottom",
  why:
    "Every concept asks access who is calling, so it must depend on nothing. The old imports were for what moves out: the " +
    "indexer read scope needed the person's and Organization's Safes (now row-level security), the waitlist's earned invites " +
    "needed live Safes (now accounts, from the chain), and consent needed applications (now applications'). An agent signs " +
    "in by key; that is proved on chain (`AgentOwner.agentOf` and the Safe's owners through chain-rpc), so access needs no " +
    "agents table. Feature gates stay: 39 frozen refusals in 30 operations of six areas name FEATURE_NOT_AVAILABLE, so they sit " +
    "below everything; a gate for an Organization keys on its id as a value. The commands that sign in and then report " +
    "the account's setup are accounts' flows (operations.sign-in-in-accounts). The device flow's native client grants are " +
    "not ported (concepts.no-device-flow-or-consent).",
  source: by("docs/as-is/archive/shared/foundation.ts (access imports 5 concepts); packages/backend/src/access/README.md:3"),
  affects: [f.concept_access, v.error_FEATURE_NOT_AVAILABLE],
});

export const decision_concepts_media = defineDecision({
  id: "concepts.media",
  title: "Media stays, and owners point at files",
  question: "Merge media into its users, or keep it, and which way do its links point?",
  options: [
    { label: "keep-inverted", text: "Keep media as the file store at the bottom; logos, photos and verification documents point at media's files." },
    { label: "merge", text: "Merge media into parties (photos) and organizations (logos)." },
  ],
  chosen: "keep-inverted",
  why:
    "Three concepts use files (parties' photos, organizations' logos, banking's identity documents), so a file store under " +
    "all of them is simpler than three copies. The old media imported organizations, permissions and profiles to bind an " +
    "image to its owner; inverting the link removes all three edges.",
  source: by("docs/as-is/archive/shared/foundation.ts (media imports 3 concepts); apps/docs/factory/operations/org.create.yaml (logo)"),
  affects: [f.concept_media, f.concept_parties, f.concept_organizations, f.concept_banking],
});

export const decision_concepts_parties = defineDecision({
  id: "concepts.parties",
  title: "Parties is the directory and absorbs profiles",
  question: "What does parties own, and where do profiles, contacts, verification and engagements go?",
  options: [
    { label: "directory", text: "Parties owns Parties, handles, Safes, owners, profiles and resolution; contacts, verification and engagements leave." },
    { label: "as-is", text: "Keep parties with contacts, verification and engagements, and keep profiles separate." },
  ],
  chosen: "directory",
  why:
    "A profile is a person's own Party seen by others: its display name is what a counterparty sees, so it belongs with the Party (old profiles was one `identities` table linked to the person's Party). Contacts need an Organization's membership, which sits above parties, so they move up (concepts.contacts). Verification is Bridge's KYC for bank rails only, so it moves to banking. Engagements were what payroll runs paid; v4 Agreements replace them. What remains is the one thing everyone below organizations needs: a name, the Safe it routes money to, and who owns that Safe. Review, 11 November 2026: Confirmed concepts.parties; original choice retained.",
  source: by("packages/backend/src/profiles/README.md:3; apps/docs/factory/operations/verify.start.yaml; ADR-0022"),
  affects: [f.concept_parties, f.concept_contacts, f.concept_banking],
});

export const decision_concepts_parties_scope = defineDecision({
  id: "concepts.parties-scope",
  title: "Parties' directory is the Safe-ownership table P8 scopes by",
  question: "Which table says whose Safe is whose, for the row-level security on chain views?",
  options: [
    { label: "parties", text: "Parties' directory (Safe, owner kind, owner id) is the scope; indexing's views join it." },
    { label: "indexing", text: "A separate safe-owners table in indexing, written by accounts, agents and organizations." },
    { label: "chain-derived", text: "Derive ownership from chain events alone." },
  ],
  chosen: "parties",
  why:
    "Every Safe a tenant owns already has a Party (a person's, an agent's, an Organization's) with its owner, so a second " +
    "table would be a copy that can disagree. Chain events alone cannot say which Organization id a company Safe is. With " +
    "the scope in parties, indexing depends on parties and nothing below indexing needs it.",
  source: by("P8 (Safe-ownership table, owner tenancy); apps/indexer/src/auth.ts:145 (old Safe-claim scope)"),
  affects: [f.concept_parties, f.concept_indexing],
});

export const decision_concepts_indexing = defineDecision({
  id: "concepts.indexing",
  title: "Indexing keeps its name and owns every chain view",
  question: "Who owns Ponder's tables in the book, and what is left of old indexing?",
  options: [
    { label: "one-owner", text: "Indexing owns every chain-tenancy view and no workflow; drift reconcile goes; the added-token scan goes to books." },
    { label: "per-concept", text: "Each concept owns the views of its contract (payments the PaymentSent view, budgets the Budgets views...)." },
    { label: "rename-chain", text: "As one-owner, renamed `chain`." },
  ],
  chosen: "one-owner",
  why:
    "Ponder is one app with one schema, and the views are read across concepts: Hats wearers by board, budgets, books, " +
    "requests, applications and organizations; Transfers by payments and activity. Per-concept ownership would force the " +
    "dependency order to follow the contracts' call graph and still need Hats at the bottom. Old indexing's drift " +
    "reconcile existed because Convex copied chain rows; nothing copies them now (P3 lists drift only while it is " +
    "needed). The added-token scan leaves too (concepts.books-token-scan). The name stays: `chain` is already the " +
    "component, and the old name already meant chain facts.",
  source: by("packages/backend/src/indexing/README.md:3; P3 (scan added tokens stays; indexer drift while needed)"),
  affects: [f.concept_indexing],
});

export const decision_concepts_approvals = defineDecision({
  id: "concepts.approvals",
  title: "New concept: approvals, every UserOperation from a person's own Safe",
  question: "Where do building, sponsoring, signing, sending and following a person's UserOperation live?",
  options: [
    { label: "approvals", text: "One low concept owns every approval and its one send, opened by the concept that prepares it." },
    { label: "per-concept", text: "Each concept keeps its own executions (payments, permissions, accounts, organizations), as the old code did." },
    { label: "platform", text: "A shared library outside the book, with each concept owning its rows." },
  ],
  chosen: "approvals",
  why:
    "v4 D1 makes every action a UserOperation from a personal Safe: payments, hat grants, Board approvals, agent changes, " +
    "budget spends, agreements, equity. The old system spread this over payments' `moneyExecutions` (read at 19 sites by " +
    "its neighbours), accounts' approvals and lanes, and borrowed executions, and that sharing was one of the import loops. " +
    "One concept gives one approval page, one `dev approve`, one sponsorship and send path that keeps K4 (one send per " +
    "signed operation) and K6 (only chain proof ends an attempt), and one place for `bud:` on chain-submit. It is " +
    "'approvals' because that is the product's word: 'opens your approval in the browser'.",
  source: by("docs/as-is/payments.md (moneyExecutions read at 19 sites; K4, K6); docs/planning/protocol-v4/architecture.md (D1)"),
  affects: [f.concept_approvals, f.concept_payments, f.concept_accounts, x.integration_bundler],
});

export const decision_concepts_accounts = defineDecision({
  id: "concepts.accounts",
  title: "Accounts keeps the personal Safe and gains admission",
  question: "What does accounts own once approvals, agents and balances leave, and where do the waitlist and referrals go?",
  options: [
    { label: "way-in", text: "Accounts owns admission (waitlist, referrals), the personal Safe's setup and test-network grants." },
    { label: "admission-concept", text: "A separate admission concept for the waitlist and referrals." },
    { label: "access", text: "Keep the waitlist and referrals in access." },
  ],
  chosen: "way-in",
  why:
    "A referrer earns an invite when the person they referred gets a live Safe, so referrals need Safe claims: in access " +
    "that would put access above accounts and break the bottom. Counting claims from the chain (CapxulSafeClaimed) lets " +
    "accounts own both without a loop. Admission and the Safe's setup are one journey (join, be admitted, set up your Safe), " +
    "so a separate concept would be a boundary inside one flow. Approvals, agents and balance reads leave for their own concepts.",
  source: by("apps/docs/factory/operations/referral.invite.yaml (earned invites); packages/backend/src/accounts/README.md:3"),
  affects: [f.concept_accounts, f.concept_access, f.concept_agents, f.concept_activity],
});

export const decision_concepts_agents = defineDecision({
  id: "concepts.agents",
  title: "New concept: agents, split from accounts",
  question: "Do agents stay in accounts?",
  options: [
    { label: "split", text: "Agents is its own concept above the Board, because an Organization can own an agent." },
    { label: "keep", text: "Keep agents in accounts." },
  ],
  chosen: "split",
  why:
    "With `--org` a Director makes the Organization the agent's owner, and every later change is then a Board proposal, " +
    "so agents must depend on board. Accounts must sit below organizations (a founder must be admitted and set up first). " +
    "Both cannot hold in one concept. AgentOwner is also its own v4 contract with its own lifecycle.",
  source: by("apps/docs/factory/operations/agent.create.yaml (designed: with --org, a Director); AgentOwner.sol"),
  affects: [f.concept_agents, f.concept_accounts, f.concept_board],
});

export const decision_concepts_organizations = defineDecision({
  id: "concepts.organizations",
  title: "Organizations keeps the workspace; Directors and equity leave",
  question: "What stays in organizations, the old 30k-line reference concept?",
  options: [
  {
    "label": "current-scope",
    "text": "Organizations owns identity, members, invitations, deployment and setup. Setup provisions a hosted company site through sites; it does not run optional-head connection or hosted-FDE setup. Board authority remains in board and parked equity is not folded back into organizations."
  },
  {
    "label": "historical",
    "text": "The former answer to concepts.organizations is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Organizations owns identity, members, invitations, deployment and setup. Setup provisions a hosted company site through sites; it does not run optional-head connection or hosted-FDE setup. Board authority remains in board and parked equity is not folded back into organizations. Authority: cut.principle; aaron.one-door; sites.door; portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; cut.principle; aaron.one-door; sites.door; portal.plan-page",
  affects: [f.concept_organizations, f.concept_board, f.concept_activity],
});

export const decision_concepts_board = defineDecision({
  id: "concepts.board",
  title: "New concept: board, the Directors, proposals and officer hats",
  question: "Where do Directors, the threshold, Board proposals and the officer hats live?",
  options: [
    { label: "board", text: "One board concept above organizations; officer hat grants and revokes are Board proposals there." },
    { label: "organizations", text: "Keep them in organizations." },
    { label: "permissions", text: "Keep officer hats in a permissions concept." },
  ],
  chosen: "board",
  why:
    "v4 makes every officer permission a hat granted by a Board batch (CAP-1101), and a Board proposal is one company Safe " +
    "transaction approved by Directors' own approveHash. Grants, Director changes and every other concept's Board batches " +
    "share that one machine, so it is one concept. It reads members from organizations. An invitation's offered grants " +
    "become one Board proposal that budgets opens through `board.propose` (operations.member-invite-in-budgets), so " +
    "organizations never depends on board.",
  source: by("apps/docs/factory/operations/org.member.grant.yaml, org.proposal.approve.yaml (designed)"),
  affects: [f.concept_board, f.concept_organizations],
});

export const decision_concepts_budgets = defineDecision({
  id: "concepts.budgets",
  title: "New concept: budgets, from allowances, departments and ceilings",
  question: "Where do spending allowances, departments and payout ceilings live under v4?",
  options: [
    { label: "budgets", text: "One budgets concept: allowances and departments are both v4 budgets, with office hats and ceilings." },
    { label: "split", text: "Allowances in permissions and departments in payroll, as the old code had them." },
  ],
  chosen: "budgets",
  why:
    "The designed text says it directly: 'A spending allowance becomes a small budget under a hat the member wears', and a department is a top or child budget. Both are one v4 contract (Budgets), one tree and one authority rule (the wearer of the budget's hat or of any above it). Keeping them apart would duplicate the tree and its authority check. Review, 11 November 2026: Confirmed concepts.budgets; original choice retained.",
  source: by("apps/docs/factory/operations/org.allowance.create.yaml, org.department.create.yaml (designed)"),
  affects: [f.concept_budgets],
});

export const decision_concepts_permissions = defineDecision({
  id: "concepts.permissions-dissolved",
  title: "Old permissions is dissolved",
  question: "What happens to old permissions (allowances, managePeople, assignments, Roles commands, receipts)?",
  options: [
    { label: "dissolve", text: "Allowances to budgets, managePeople to board's People hat, assignments and receipts to indexing's chain views, Roles commands gone." },
    { label: "keep", text: "Keep a permissions concept over hats." },
  ],
  chosen: "dissolve",
  why:
    "On v4, Capxul 'reads the permission only from Hats', and a spending allowance is a budget. The Zodiac Roles commands " +
    "were the pre-v4 way to change permissions; v4 uses Roles only for the payout role the install wires (P9 drops the " +
    "rest). The receipt-verified record existed because Convex copied chain state; indexing's views are that record now.",
  source: by("packages/backend/src/permissions/README.md:3; org.member.grant.yaml (designed); P9"),
  affects: [f.concept_budgets, f.concept_board, f.concept_indexing],
});

export const decision_concepts_payroll = defineDecision({
  id: "concepts.payroll",
  title: "Superseded by payroll.scope: Frappe HR's payroll beside the agreements",
  question: "What does payroll own on v4, and do payroll runs survive?",
  options: [
    {
      label: "payroll-scope",
      text:
        "As payroll.scope decides under aaron.frappe-shape: Frappe HR's payroll (Employees, Salary Components, Salary " +
        "Structures and their Assignments, Payroll Entries and Salary Slips) beside the v4 Agreements; saved groups and " +
        "terms stay dropped; departments stay budgets'.",
    },
    { label: "agreements", text: "The earlier choice: payroll owns v4 Agreements only; runs, items and saved groups are dropped; departments go to budgets." },
    { label: "keep-runs", text: "Keep payroll runs and rosters as batches of payments." },
  ],
  chosen: "payroll-scope",
  why:
    "Superseded by payroll.scope. This record first chose agreements only: no frozen operation made, listed or showed a " +
    "payroll run, so by P2 runs had no caller. aaron.frappe-shape and aaron.erp-on-capxul made payroll Frappe HR's from " +
    "an Organization's first day, which gives runs their caller: the SDK flows of payroll.hr-surface. A run is not old " +
    "payroll's run: it pays through `payments.prepare-command` and follows `payment_transitioned` " +
    "(payroll.pays-through-payments), and posts its accrual through books' door, so the old settle-run procedure stays " +
    "gone and neither payments nor books depends on payroll (dependencies.payments-payroll, dependencies.books-payroll).",
  source: by("payroll.scope; aaron.frappe-shape; blueprint/baseline/operations.ts (payroll area: agreements only); P2; packages/backend/src/payroll/tables.ts:167"),
  affects: [f.concept_budgets, f.concept_payments, f.concept_books],
});

export const decision_concepts_books = defineDecision({
  id: "concepts.books",
  title: "Books gains annotations and prices",
  question: "Where do activity's annotations and the Chainlink price sync go?",
  options: [
  {
    "label": "current-scope",
    "text": "Books retains chain money facts, activity annotations and Chainlink prices. An annotation still classifies a money row and prices still value it. The editable chart, Journal Entry and GL Entry are ERPNext documents on the site, not duplicate Core business tables; plugs projects the money facts to them."
  },
  {
    "label": "historical",
    "text": "The former answer to concepts.books is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Books retains chain money facts, activity annotations and Chainlink prices. An annotation still classifies a money row and prices still value it. The editable chart, Journal Entry and GL Entry are ERPNext documents on the site, not duplicate Core business tables; plugs projects the money facts to them. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [f.concept_books, f.concept_activity, x.integration_chainlink],
});

export const decision_concepts_activity = defineDecision({
  id: "concepts.activity",
  title: "Activity is the read model at the top",
  question: "What is activity once its annotations leave, and where do balances and `address` go?",
  options: [
    { label: "top-read-model", text: "Activity reads payments, indexing, budgets, books and documents to serve the feed, balances and `address`." },
    { label: "accounts", text: "Balances and `address` stay in accounts." },
  ],
  chosen: "top-read-model",
  why:
    "A balance answers for whoever you act as, a person or an Organization, and its 'available' amount needs pending " +
    "payments; a feed row shows its account and documents. Only a concept above payments, books and organizations can " +
    "read all of that, and nothing needs to read activity back. In accounts, balances would pull accounts above payments.",
  source: by("apps/docs/factory/operations/balance.yaml, address.yaml; packages/backend/src/activity/README.md:3"),
  affects: [f.concept_activity, f.concept_accounts],
});

export const decision_concepts_documents = defineDecision({
  id: "concepts.documents",
  title: "Documents retains hash evidence, not site payroll ownership",
  question: "Where does documents sit, and how does it know who may read a document?",
  options: [
    { label: "current-scope", text: "Core documents retains canonical chain-backed bytes, hash stamps, verification and participant admissions. Retained money subjects supply participants at storage time, so documents need not read its subjects. Payroll runs and Salary Slips belong to Frappe HR on the company site, not a Core payroll concept using documents.store. Site printing and export use Print Format through the door; held site payments carry the canonical hash defined by plugs.document-canon without duplicating payroll documents in Core." },
    { label: "historical", text: "The former payroll dependency is obsolete. Its original specification is preserved in docs/cut-archive/decision-review-history.json as evidence, not implementation authority." },
  ],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: K2 still explains atomic storage of retained chain document evidence and caller-supplied participants, not ownership of site business records. Under cut.documents and aaron.frappe-native, Frappe HR owns payroll documents and printing goes through the door. A site payment's canonical hash binds its draft without requiring a Core payroll document or procedure dependency. This rewrites the earlier unchanged confirmation in response to F-1.1.",
  source: "The coordinator, m1-old-decisions round 2; cut.documents; plugs.document-canon; aaron.frappe-native; K2 in docs/as-is/payments.md",
  affects: [f.concept_documents, f.concept_payments, f.concept_requests],
});

export const decision_concepts_contacts = defineDecision({
  id: "concepts.contacts",
  title: "New concept: contacts, split from parties",
  question: "Where does the address book live?",
  options: [
  {
    "label": "current-scope",
    "text": "There is no active Core contacts concept or private replicated address book. Contact, Address and CRM documents live on the company site and are reached through the door under projected site roles. Core parties remains the identity/Safe directory and banking owns saved bank accounts."
  },
  {
    "label": "historical",
    "text": "The former answer to concepts.contacts is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: There is no active Core contacts concept or private replicated address book. Contact, Address and CRM documents live on the company site and are reached through the door under projected site roles. Core parties remains the identity/Safe directory and banking owns saved bank accounts. Authority: cut.contacts; sites.crm; plugs.roles-follow-hats.",
  source: "The coordinator, round 2, m1-old-decisions; cut.contacts; sites.crm; plugs.roles-follow-hats",
  affects: [f.concept_contacts, f.concept_parties, f.concept_banking],
});

export const decision_concepts_payments = defineDecision({
  id: "concepts.payments",
  title: "Payments keeps the ledger and is born from chain facts too",
  question: "What does payments own once executions leave, and how do payments Capxul did not prepare appear?",
  options: [
    { label: "ledger", text: "Commands, routes, settlement, reversal, dated payments, Movements, and Payments born from indexed PaymentSent facts." },
    { label: "prepared-only", text: "Only payments Capxul prepared; other money movements are left to each concept." },
  ],
  chosen: "ledger",
  why:
    "On v4 every movement of money ends in one `PaymentSent` (architecture.md: one way money leaves), whoever starts it: an " +
    "agreement collection, an escrow payout, `Budgets.execute`, a round payment. Settling from that one event gives one " +
    "settlement path (fixing M2 and M3), one place that writes book facts (K10) and one ledger activity can read. A payment " +
    "Capxul prepared is matched by its command; any other is born from the fact. Payroll, requests and equity then never " +
    "need to write a Payment, which is what kept them in loops with payments.",
  source: by("docs/planning/protocol-v4/architecture.md (one way money leaves); docs/as-is/payments.md (M2, M3, M4, K10)"),
  affects: [f.concept_payments, x.contract_payments],
});

export const decision_concepts_banking = defineDecision({
  id: "concepts.banking",
  title: "Banking gains verification and saved bank accounts",
  question: "Where do Bridge verification and saved bank accounts live?",
  options: [
    { label: "banking", text: "Both in banking, with every other Bridge call." },
    { label: "parties", text: "Verification and destinations stay in parties." },
  ],
  chosen: "banking",
  why:
    "Verification is Bridge's KYC and KYB and gates only bank transfers ('identity verification for bank transfers'); saved " +
    "bank accounts are Bridge external accounts used only by bank payouts and encrypted with banking's record key. In " +
    "banking, every Bridge call and every Bridge secret is in one concept. A business verification invitation " +
    "(`inv_kyb_`) is banking's too; `invite accept` routes to it by id.",
  source: by("apps/docs/factory/operations/verify.start.yaml, bank.accounts.add.yaml, invite.accept.yaml"),
  affects: [f.concept_banking, f.concept_parties, x.integration_bridge],
});

export const decision_concepts_requests = defineDecision({
  id: "concepts.requests",
  title: "Requests gains the bank deposit match",
  question: "Who owns `bank match`, which links a deposit to the request it paid?",
  options: [
    { label: "requests", text: "Requests: it marks its request paid and marks the deposit matched through a banking procedure." },
    { label: "banking", text: "Banking: it marks the deposit and drives the request through a requests procedure." },
  ],
  chosen: "requests",
  why:
    "A request is paid by a Payment, an escrow or a bank deposit: the means are below it, and the request reacts to them. " +
    "With the match in requests, requests depends on payments and banking and neither depends on requests. The deposit " +
    "and the request it paid are one money fact (what the money was for), so the deposit side is a procedure.",
  source: by("apps/docs/factory/operations/bank.match.yaml; docs/as-is/archive/shared/foundation.ts (banking-requests loop)"),
  affects: [f.concept_requests, f.concept_banking],
});

export const decision_concepts_applications = defineDecision({
  id: "concepts.applications",
  title: "Applications stays separate, above organizations, with health",
  question: "Merge applications into access, and where do consent and the deployment health check go?",
  options: [
    { label: "above-organizations", text: "Applications above organizations, owning apps, keys, origins, bootstrap, quickstart keys and health; no consent table." },
    { label: "merge-access", text: "Merge applications into access." },
  ],
  chosen: "above-organizations",
  why:
    "An Organization's publishable key needs the Invoicing hat ('For an Organization, a member who holds issue " +
    "invoices'), so applications must sit above organizations; access must sit below everything. Merging them would make " +
    "a loop. A person's consent to an application would be the application's record, but nothing in the target writes " +
    "one: its only writer was the device flow (concepts.no-device-flow-or-consent). `doctor --online` checks the " +
    "deployment and the app key, which is what bootstrap already describes, so health lives here.",
  source: by("apps/docs/factory/operations/key.create.yaml, doctor.yaml; docs/as-is/archive/shared/foundation.ts (access-applications loop)"),
  affects: [f.concept_applications, f.concept_access],
});

export const decision_concepts_notices = defineDecision({
  id: "concepts.notices",
  title: "New concept: notices, every email after a change",
  question: "Who sends the emails that follow a change (invitations, requests, dated payments, agreements, referrals)?",
  options: [
    { label: "notices", text: "One notices concept at the top: one workflow per notice kind, triggered by the source concept's transition." },
    { label: "each-concept", text: "Each concept sends its own email from an outbox workflow." },
  ],
  chosen: "notices",
  why:
    "P3 makes each notification an after-commit workflow fed by the outbox, one per notice kind. Putting them in one concept " +
    "gives one place for templates, recipients and delivery records (which `dev mail notices` reads), and keeps every " +
    "money concept free of mail. It sits at the top because it reads the facts of the concepts it tells about. The " +
    "sign-in code stays in access: sending it is the operation itself, not a notice after one.",
  source: by("P3 (about 20 notifications); docs/as-is/payments.md (R8: notices sent once per Payment); operator noticeDeliveries"),
  affects: [f.concept_notices, x.integration_mail],
});

export const decision_concepts_devnet = defineDecision({
  id: "concepts.devnet",
  title: "Devnet replaces operator",
  question: "What happens to old operator's tools (diagnostics, receipt holds, proof identities, faucet, fixtures, probes, mail sink, notice records)?",
  options: [
    { label: "devnet", text: "A devnet concept for devnet-only tools; the faucet to accounts, diagnostics to applications' health, probes dropped, notice records to notices." },
    { label: "operator", text: "Keep an operator concept in every environment." },
  ],
  chosen: "devnet",
  why:
    "P2 sends operator probes to a devnet concept with devnet-only rpcs, and P8 moves test tables there. The faucet must " +
    "also work on staging (`dev fund`), so it is accounts' test-network grant. Tenancy probes existed to test tenancy by " +
    "hand; P8's generated `tbl:<t>/tenancy` evals replace them. The devnet's tables are what the integrations' fakes use, " +
    "so no production concept depends on devnet.",
  source: by("P2, P8; packages/backend/src/operator/README.md:3; apps/docs/factory/operations/dev.fund.yaml"),
  affects: [f.concept_devnet, f.concept_accounts, f.concept_applications, f.concept_notices],
});

export const decision_concepts_local_commands = defineDecision({
  id: "concepts.local-commands",
  title: "Commands that touch only this machine are booked under access",
  question: "Which concept designs `schema`, `use env`, `use personal`, `config telemetry`, `auth list` and `whoami`?",
  options: [
    { label: "access", text: "Access: they read or write the client's own session and environment state, as Core SDK flows with local steps." },
    { label: "cli-concept", text: "A `cli` concept for client-only commands." },
  ],
  chosen: "access",
  why:
    "A4 makes each of them one SDK method too. They are about who and where the client is (the current person, the " +
    "environment, consent to telemetry, what the CLI can do), which is access' question on the client side. A concept " +
    "with no tables and no rpcs would be an empty concept.",
  source: by("A4; apps/docs/factory/operations/whoami.yaml, use.env.yaml, schema.yaml"),
  affects: [f.concept_access],
});

export const decision_concepts_line_budgets = defineDecision({
  id: "concepts.line-budgets",
  title: "No line budgets on concepts yet",
  question: "Should the concept records carry `lines` budgets now?",
  options: [
    { label: "later", text: "Leave `lines` unset; each concept's design sets its budget from its own records." },
    { label: "now", text: "Set budgets now from the old lines less the plumbing." },
  ],
  chosen: "later",
  why:
    "A line budget is only as good as the design under it, and the per-concept designs have not been written. The old lines are mostly plumbing (about two thirds of an area is ceremony, and 166 files are emit, intent, load or record), so they would anchor the numbers on the system being replaced, the same objection P5 made to per-operation budgets. Review, 11 November 2026: Confirmed concepts.line-budgets; original choice retained.",
  source: by("docs/mission/findings.md (two thirds ceremony); P3 (166 plumbing files); P5 option A"),
  affects: [...f.CONCEPTS],
});

// ── dependencies: the old loops, cut one by one ─────────────────────────────────────────────

export const decision_dependencies_organizations_permissions = defineDecision({
  id: "dependencies.organizations-permissions",
  title: "Budgets and board depend on organizations, never the reverse",
  question: "The old organizations and permissions imported each other (76 and 37 imports). Which way does the target point?",
  options: [
    { label: "up", text: "Budgets and board depend on organizations; organizations reads hats from indexing, never from them." },
    { label: "down", text: "Organizations depends on budgets and board." },
  ],
  chosen: "up",
  why:
    "Organizations needs to know whether an inviter wears the People hat, which is a chain fact (indexing) plus the hat id " +
    "in its own deployment record. Budgets and board need the company Safe, the members and the hat ids, which are " +
    "organizations'. The one place the old code went down, an invitation offering grants, becomes the invite flow's second " +
    "step: budgets proposes the grants for the invitation through the Board (operations.member-invite-in-budgets).",
  source: by("docs/mission/findings.md (organizations-permissions, 76 and 37 imports); org.member.invite.yaml (designed)"),
  affects: [f.concept_organizations, f.concept_budgets, f.concept_board],
});

export const decision_dependencies_accounts_payments = defineDecision({
  id: "dependencies.accounts-payments",
  title: "Payments depends on accounts; accounts never reads payments",
  question: "The old accounts and payments imported each other (21 each). Which way does the target point?",
  options: [
    { label: "payments-up", text: "Payments reads accounts; claim escrows waiting for a person are found from indexing's escrow views." },
    { label: "accounts-up", text: "Accounts reads payments, for the escrows and balances." },
  ],
  chosen: "payments-up",
  why:
    "Payments needs whether the sender and the recipient have live Safes (pay directly, or into a claim escrow). Accounts " +
    "needed payments only for balances (now activity), sending approved operations (now approvals) and the claim escrows to " +
    "collect at setup, which are chain facts (EscrowDeployed with the person's Safe as owner, payments.general-escrow). So accounts reads indexing.",
  source: by("docs/mission/findings.md (accounts-payments, 21 imports each); account.retry.yaml (designed: collects claim escrows)"),
  affects: [f.concept_accounts, f.concept_payments],
});

export const decision_dependencies_payments_payroll = defineDecision({
  id: "dependencies.payments-payroll",
  title: "Payroll depends on payments to pay a run; payments never depends on payroll",
  question: "Old payments called payroll's settle-run inside its settlement, and payroll built payments. Which way now?",
  options: [
  {
    "label": "current-scope",
    "text": "Payments never calls a Core payroll settle-run procedure. Frappe HR requests a held payment through plugs; Core owns the command, signature and chain settlement, and the service delivers the result back to the site. Agreement collections remain chain Payments, not Core salary runs."
  },
  {
    "label": "historical",
    "text": "The former answer to dependencies.payments-payroll is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Payments never calls a Core payroll settle-run procedure. Frappe HR requests a held payment through plugs; Core owns the command, signature and chain settlement, and the service delivers the result back to the site. Agreement collections remain chain Payments, not Core salary runs. Authority: cut.payroll; cut.agreements-in-payments; plugs.held-payment.",
  source: "The coordinator, round 2, m1-old-decisions; cut.payroll; cut.agreements-in-payments; plugs.held-payment",
  affects: [f.concept_payments],
});

export const decision_dependencies_books_payroll = defineDecision({
  id: "dependencies.books-payroll",
  title: "Archived: Payroll posts a run's accrual through books' door; books never reads p",
  question:
    "A run Capxul computed must credit Payroll Payable and the deductions' liabilities when it is submitted, and take them back when it is cancelled (books.payroll-accrual). Which way does the edge between books and payroll point?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive the Core payroll-to-books accrual procedure edge: Frappe HR submits and cancels its own runs and posts their accrual on the site. No Core run submission invokes books.record-payroll-accrual. Core retains chain money facts and plugs delivers their settlement to the site."
  },
  {
    "label": "historical",
    "text": "The former answer to dependencies.books-payroll is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive the Core payroll-to-books accrual procedure edge: Frappe HR submits and cancels its own runs and posts their accrual on the site. No Core run submission invokes books.record-payroll-accrual. Core retains chain money facts and plugs delivers their settlement to the site. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [f.concept_books, f.concept_payments],
});

export const decision_dependencies_payments_requests = defineDecision({
  id: "dependencies.payments-requests",
  title: "Requests depends on payments; the paid notice goes through the outbox",
  question: "Old payments and requests called into each other at a request's birth and at settlement. Which way now?",
  options: [
    { label: "requests-up", text: "Requests invokes `payments.prepare-command` to pay from the inbox and follows `payment_transitioned` for paid." },
    { label: "payments-up", text: "Payments reads the request and drives its state at settlement." },
  ],
  chosen: "requests-up",
  why:
    "A request is the receivable; a Payment is one way to pay it. The payment of a request and the Payment are one money " +
    "fact, so the request's rpc births the command through a payments procedure. The request's paid state and its notice " +
    "may lag a second (P4's own example of the outbox), so they follow the Payment's transition.",
  source: by("P4 (requests.schedule-paid-notice to the outbox); docs/as-is/payments.md (a birth owned by two concepts)"),
  affects: [f.concept_requests, f.concept_payments],
});

export const decision_dependencies_payments_banking = defineDecision({
  id: "dependencies.payments-banking",
  title: "Banking depends on payments for bank payouts",
  question: "Old payments drove banking's payout and banking drove the Payment's in-transit states. Which way now?",
  options: [
    { label: "banking-up", text: "Banking births the payout's Payment through `payments.prepare-command` and follows it; the payout machine holds in-transit, delivered and returned." },
    { label: "payments-up", text: "Payments drives the payout as part of the Payment's own states." },
  ],
  chosen: "banking-up",
  why:
    "The money leaves the Safe in one `Payments.send` to Bridge's deposit address; that Payment settles on chain like any " +
    "other. What happens at the bank afterwards (in transit, delivered, returned) is Bridge's, so it is the payout's " +
    "machine (K13 kept, on banking's side). Payments then never needs banking, and a return arrives as a new deposit.",
  source: by("docs/as-is/payments.md (K13; payments drives other concepts' state machines); bank.pay.yaml (designed)"),
  affects: [f.concept_banking, f.concept_payments],
});

export const decision_dependencies_books = defineDecision({
  id: "dependencies.books-below-money",
  title: "Books sits below payments and banking, which write its money facts",
  question: "Which way do books and payments point, and how is a settled Payment's book fact written?",
  options: [
    { label: "below", text: "Payments and banking depend on books and write a money fact's book fact through its procedure, in the same transaction." },
    { label: "consumer", text: "Books depends on payments and consumes `payment_transitioned` through the outbox." },
  ],
  chosen: "below",
  why:
    "ADR-0042 decision 1 (accepted) and P4 put a book fact in the caller's transaction so a fact is never lost or doubled, and K10 says a settled Payment always has its book facts. Books needs nothing from payments: its facts carry what they record. The old code had the door (`recordSettledPaymentInTx`) and never used it; the target imports only the door. Review, 11 November 2026: Confirmed dependencies.books-below-money; original choice retained.",
  source: by("ADR-0042 decision 1; P4; docs/as-is/payments.md (K10, 0 door imports)"),
  affects: [f.concept_books, f.concept_payments, f.concept_banking],
});

export const decision_dependencies_activity_books = defineDecision({
  id: "dependencies.activity-books",
  title: "Activity reads books; books never reads activity",
  question: "Old activity and books imported each other. Which way now?",
  options: [
  {
    "label": "current-scope",
    "text": "Activity reads books annotations and prices; books never reads activity. Activity does not read a parallel Core chart: editable accounts and ledger reports belong to ERPNext through the door."
  },
  {
    "label": "historical",
    "text": "The former answer to dependencies.activity-books is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why: "Review, 11 November 2026: Activity reads books annotations and prices; books never reads activity. Activity does not read a parallel Core chart: editable accounts and ledger reports belong to ERPNext through the door. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [f.concept_activity, f.concept_books],
});

export const decision_dependencies_proposals = defineDecision({
  id: "dependencies.board-below-proposers",
  title: "Every concept that needs the Board depends on board",
  question: "Budgets, payments, payroll, agents and equity all make Board batches. Which way do they point?",
  options: [
    { label: "proposers-up", text: "They depend on board and open a proposal in their own transaction; they follow `proposal_transitioned`." },
    { label: "board-up", text: "Board depends on them and builds their batches." },
  ],
  chosen: "proposers-up",
  why:
    "The concept that knows the intent (a department, a Board payment, an org-owned agent's freeze) builds the calls; the Board only collects approvals and executes. If board built them it would depend on every money concept. A proposal and the intent it carries are one fact (rules.procedures), so opening it is a procedure. Review, 11 November 2026: Confirmed dependencies.board-below-proposers; original choice retained.",
  source: by("org.department.create.yaml, payment.send.yaml (--as-directors), agent.create.yaml (designed)"),
  affects: [f.concept_board, f.concept_budgets, f.concept_payments, f.concept_agents],
});

export const decision_dependencies_approvals = defineDecision({
  id: "dependencies.approvals-low",
  title: "Approvals sits low, under every chain-writing concept",
  question: "Which concepts depend on approvals, and what does approvals depend on?",
  options: [
    { label: "low", text: "Approvals depends on access and indexing only; every concept that writes the chain from a person's Safe depends on it." },
    { label: "high", text: "Approvals above the concepts whose operations it carries, reading their intents." },
  ],
  chosen: "low",
  why:
    "An approval needs only its owner (access: a person's Safe is a pure function of their email; an agent's is on its " +
    "principal) and chain proof (indexing). It carries a summary for the approval page, given by the concept that opens it, " +
    "so it never reads its openers. Accounts, organizations, board, agents, budgets, payments, payroll and equity open " +
    "approvals.",
  source: by("docs/as-is/payments.md (moneyExecutions shared by permissions, requests, accounts)"),
  affects: [f.concept_approvals],
});

export const decision_dependencies_registration = defineDecision({
  id: "dependencies.parties-registration",
  title: "Organizations and agents register their Party at birth",
  question: "An Organization's and an agent's handle must be unique across both and route money to their Safe. Who writes it, and when?",
  options: [
    { label: "procedure", text: "The birth transaction invokes `parties.register` (handle, Safe, owner); a taken handle fails the birth." },
    { label: "flow-steps", text: "The SDK flow reserves the handle with a parties rpc first, then creates the Organization or agent." },
    { label: "own-handles", text: "Organizations and agents keep their own handles; resolution reads both." },
  ],
  chosen: "procedure",
  why:
    "The frozen text says a taken handle creates no Organization, and an invalid logo leaves no Organization or setup row: " +
    "the birth is all or nothing. A handle and the Safe it routes money to are one money fact (a wrong binding sends money " +
    "to the wrong Safe), so this is a procedure under rules.procedures. A flow step first would leave reserved handles with " +
    "no owner; separate handle tables cannot share one unique index. The company Safe's address is known before it is " +
    "minted (`companySafeAddressFor`).",
  source: by("org.create.yaml (refusals, acceptance); ADR-0022 (one Party per handle); CompanySafeMinter.sol:134"),
  affects: [f.concept_parties, f.concept_organizations, f.concept_agents, x.contract_company_safe_minter],
});

export const decision_dependencies_notices = defineDecision({
  id: "dependencies.notices-top",
  title: "Notices depends on what it tells about; nothing depends on notices",
  question: "Which way do notices and the concepts that cause emails point?",
  options: [
    { label: "notices-up", text: "Notices depends on accounts, organizations, board, budgets, payments, payroll, banking, requests and equity; their transitions trigger it." },
    { label: "senders-up", text: "Each concept depends on notices and invokes it." },
  ],
  chosen: "notices-up",
  why:
    "An email may lag its change and must never roll it back, so it is an outbox consumer (P3, P4), and the consumer " +
    "depends on the producer. Only devnet (the mail sink) sits above it.",
  source: by("P3; P4 (notices to the outbox)"),
  affects: [f.concept_notices],
});

// ── rules every target concept follows ──────────────────────────────────────────────────────

export const decision_rules_procedures = defineDecision({
  id: "rules.procedures",
  title: "A procedure only for one money fact, read narrowly",
  question: "P4 allows a cross-concept write in one transaction only for the same money fact. What counts?",
  options: [
    {
      label: "money-fact",
      text:
        "A fact about money moved, reserved, routed or owned: a Payment and its book fact or document; a chain write and the " +
        "approval or proposal that carries it; a name and the Safe it routes money to; a deposit and the request it paid; " +
        "a Payment command another concept births. Everything else goes through the outbox.",
    },
    { label: "payments-only", text: "Only payments and books writing together." },
    { label: "any-atomic", text: "Any write the caller wants atomic." },
  ],
  chosen: "money-fact",
  why:
    "The test is P4's: if the two writes disagreed at a commit, could money move, or be owned, that Capxul's records do not " +
    "account for? An approval opened without its intent would let a person sign a money movement with no Payment; a " +
    "proposal without its intent would execute a budget nobody recorded; a handle bound to the wrong Safe misroutes " +
    "payments. A notice, a projection or telemetry can lag and be rebuilt, so it never qualifies. Each procedure's `about` " +
    "names its fact, and the build's `notice-in-transaction` rule, when it lands, refuses one that is only a notice. One " +
    "authority fact is admitted beside them, `accounts.admit` (procedures.accounts-admit), because neither a procedure " +
    "for money nor the outbox can carry it.",
  source: by("P4 option D; ADR-0042 decision 1"),
  affects: [
    f.concept_approvals, f.concept_board, f.concept_parties, f.concept_documents, f.concept_books, f.concept_payments,
    f.concept_banking, f.concept_accounts,
  ],
});

export const decision_rules_outbox = defineDecision({
  id: "rules.outbox",
  title: "The outbox and the telemetry relay are runtime, not booked records",
  question: "Are the outbox table and the relay that sends events to PostHog concept records?",
  options: [
    { label: "runtime", text: "The runtime writes each transition's event to an outbox row in its transaction; one generic relay delivers them; a reaction is a workflow triggered by the transition." },
    { label: "booked", text: "Book an outbox table and a relay workflow in some concept." },
  ],
  chosen: "runtime",
  why:
    "P3 and P7 make telemetry the runtime's job ('telemetry is never a workflow') and every reaction a workflow whose " +
    "trigger is the transition. Booking the outbox in a concept would make every concept depend on it, and the generic " +
    "relay has no domain behaviour to specify.",
  source: by("P3 (one generic outbox relay); P7 (the outbox delivers it)"),
  affects: [f.component_backend, x.integration_posthog],
});

export const decision_rules_durable_processes = defineDecision({
  id: "rules.durable-processes",
  title: "Which objects are long-lived and get one durable process each",
  question: "A3 gives each long-lived business object one durable process. Which objects are they?",
  options: [
    {
      label: "list",
      text:
        "An approval, a Payment (one process for its command and its date: payments.one-process-per-payment), a Board " +
        "proposal, an Organization's setup, a personal Safe's setup, an agreement, a request, an invitation, a bank payout, " +
        "a verification, an agent change and a round (equity). Added by their designers: an assistant grant " +
        "(access.assistant-grant-process), an identity document (media.document-process), a budget change " +
        "(budgets.one-process-per-change), and an equity install, grant, sale and vote (equity.processes).",
    },
    { label: "workflows-only", text: "Only what P3's three-part test calls a workflow, with no instance per object." },
  ],
  chosen: "list",
  why:
    "Each waits on something outside a request (a signature, the chain, a date, a person, Bridge) and must survive a " +
    "crash: P3's test holds for each, and A3 says the process owns its machine. Short-lived rows (a contact, a book " +
    "account, an annotation) change only inside rpcs and have no process. The concept designer may add objects, never drop " +
    "one of these without a decision. The list was brought up to date with the designs on 8 November 2026: payments " +
    "folded the payment command's and the dated payment's processes into one per Payment, with its own decision, and " +
    "four designers added objects that wait on a person, the chain or a date.",
  source: by("A3 (time); P3 (the three-part test); assembly, 8 November 2026: access, media, budgets, equity and payments decisions"),
  affects: [
    f.concept_approvals, f.concept_payments, f.concept_board, f.concept_organizations, f.concept_accounts, 
    f.concept_requests, f.concept_banking, f.concept_agents, f.concept_access, f.concept_media,
    f.concept_budgets,
  ],
});

// ── vocabulary ──────────────────────────────────────────────────────────────────────────────

export const decision_vocabulary_kept = defineDecision({
  id: "vocabulary.kept",
  title: "Keep every code the frozen book names",
  question: "Which old error codes does the target keep without question?",
  options: [
    { label: "named", text: "Every code named in a frozen refusal (top-level or designed), a mistake's fix or an acceptance line." },
    { label: "refusals-only", text: "Only codes named in refusals." },
  ],
  chosen: "named",
  why:
    "P10 rung 1: refusal codes are surface, and the book wins. A code named in a mistake's fix (PROFILE_NOT_FOUND, " +
    "OTP_EXPIRED, WORK_DIED, ENVIRONMENT_NOT_CHOSEN, CANCELLED) is what a person is told to expect, so it is surface too. " +
    "That keeps 32 old codes named in refusals and these 5; with the 5 new equity codes and the 5 kept unnamed ones the " +
    "target has 47 codes, from the old 50.",
  source: by("blueprint/baseline/operations.ts (refusal and fix scan, 7 November 2026)"),
  affects: [v.error_PROFILE_NOT_FOUND, v.error_OTP_EXPIRED, v.error_WORK_DIED, v.error_ENVIRONMENT_NOT_CHOSEN, v.error_CANCELLED],
});

export const decision_vocabulary_new_equity = defineDecision({
  id: "vocabulary.new-equity-codes",
  title: "Add the five codes the frozen equity refusals name",
  question: "The frozen book names CONSENT_MISSING, INSUFFICIENT_FUNDS, NOT_VESTED, RESERVED_MATTER and ROUND_CLOSED, which the old code never defined. Add them?",
  options: [
    { label: "add", text: "Add all five with the designed text's exit 2, class state." },
    { label: "merge", text: "Map them onto WRONG_STATE and INSUFFICIENT_BALANCE." },
  ],
  chosen: "add",
  why:
    "They are refusal codes in the frozen surface (P10 rung 1), from designed v4 text that was never built (equity was " +
    "NOT BUILT on the old devnet). Merging them would change what the frozen commands answer. INSUFFICIENT_FUNDS stays " +
    "apart from INSUFFICIENT_BALANCE because `shares exercise` names it.",
  source: by("blueprint/baseline/operations.ts (shares.exercise, org.round.*, invest.*, org.board.director.add designed refusals)"),
  affects: [v.error_CONSENT_MISSING, v.error_INSUFFICIENT_FUNDS, v.error_NOT_VESTED, v.error_RESERVED_MATTER, v.error_ROUND_CLOSED],
});

export const decision_vocabulary_exits = defineDecision({
  id: "vocabulary.exit-codes",
  title: "Exit codes: the designed text where it names one, else the old CLI",
  question: "One code has one exit. Where the designed refusals and the old CLI disagree, which wins?",
  options: [
    { label: "designed-then-old", text: "The designed text's exit where it names the code; the old `exitClass` otherwise; a tie goes to the class rule (input refusals exit 2)." },
    { label: "old", text: "Keep every old exit code." },
    { label: "by-class", text: "Recompute every exit from the class." },
  ],
  chosen: "designed-then-old",
  why:
    "P10 rung 1 makes exit codes surface, with the designed v4 text first; it names exits for 22 codes and moves five from " +
    "6 to 2 (INSUFFICIENT_BALANCE, VERIFICATION_REQUIRED, PAYROLL_BUDGET_EXCEEDED, INVALID_RECIPIENT, TOKEN_NOT_SUPPORTED). " +
    "Two outliers are settled: INVALID_INPUT is 2 (27 designed refusals) not 1 (one, waitlist.invites.grant), and " +
    "TOKEN_NOT_SUPPORTED is 2 (one 2, one 6; it is an input refusal). Recomputing every exit would change codes no text asked to change.",
  source: by("blueprint/baseline/operations.ts (designed refusal exits); apps/cli/src/runtime/errors.ts:216-225 (exitClass)"),
  affects: [
    v.error_INSUFFICIENT_BALANCE, v.error_VERIFICATION_REQUIRED, v.error_PAYROLL_BUDGET_EXCEEDED, v.error_INVALID_RECIPIENT,
    v.error_TOKEN_NOT_SUPPORTED, v.error_INVALID_INPUT,
  ],
});

export const decision_vocabulary_classes = defineDecision({
  id: "vocabulary.classes",
  title: "Use ADR-0039's auth and permission classes; one class per code",
  question: "The old code had no auth or permission class and four codes classed by mode. What do target codes carry?",
  options: [
    { label: "classes", text: "NOT_AUTHENTICATED is auth; ROLE_PERMISSION_DENIED and BELOW_THRESHOLD are permission; by-mode codes get one class and carry the mode in details." },
    { label: "as-is", text: "Keep the old classes, with by-mode resolved at run time." },
  ],
  chosen: "classes",
  why:
    "The book's error record has one class, and ADR-0039's classes include auth and permission, which say who acts better " +
    "than `input` and `state` did. A failure mode (timeout, refused, revert) is a detail of one occurrence, not of the " +
    "code, so it travels in `details.mode` and in the span's attributes (P6).",
  source: by("ADR-0039; packages/protocol/src/errors/classes.ts:34-120"),
  affects: [v.error_NOT_AUTHENTICATED, v.error_ROLE_PERMISSION_DENIED, v.error_BELOW_THRESHOLD, v.error_PROVIDER_ERROR, v.error_NETWORK_ERROR],
});

export const decision_vocabulary_provider_error = defineDecision({
  id: "vocabulary.provider-error",
  title: "PROVIDER_ERROR keeps both meanings the frozen book gives it",
  question: "The frozen book names PROVIDER_ERROR for 'cannot be reached' and for 'refuses the call'. Split it?",
  options: [
    { label: "one-code", text: "One code, class provider-unavailable, retryable; `details.mode: refused` marks a refusal." },
    { label: "split", text: "Add PROVIDER_REFUSED for refusals." },
  ],
  chosen: "one-code",
  why:
    "`verify start`, `verify status` and `bank settle` name PROVIDER_ERROR for both, and refusal codes are surface (P10). " +
    "The common case is unavailability, so that is its class. A malformed answer keeps its own code (PROVIDER_RESPONSE_INVALID).",
  source: by("verify.start.yaml, verify.status.yaml, bank.settle.yaml refusals"),
  affects: [v.error_PROVIDER_ERROR, v.error_PROVIDER_RESPONSE_INVALID],
});

export const decision_vocabulary_drop_email = defineDecision({
  id: "vocabulary.drop-email-delivery-failed",
  title: "Drop EMAIL_DELIVERY_FAILED; a mail failure is PROVIDER_ERROR",
  question: "Keep EMAIL_DELIVERY_FAILED?",
  options: [
    { label: "drop", text: "Drop it: notices send after the commit and retry durably; the sign-in code's failure is the mail provider's, PROVIDER_ERROR." },
    { label: "keep", text: "Keep it for any request that sends mail." },
  ],
  chosen: "drop",
  why:
    "No frozen text names it. In the target no request waits on an email except the sign-in code, whose failure is a " +
    "provider failure like any other; every other email is a notices workflow, whose failures are its delivery records.",
  source: by("blueprint/baseline/operations.ts (0 mentions); concepts.notices"),
  affects: [v.error_PROVIDER_ERROR, f.concept_notices],
});

export const decision_vocabulary_drop_player = defineDecision({
  id: "vocabulary.drop-player-not-found",
  title: "Drop PLAYER_NOT_FOUND",
  question: "Keep PLAYER_NOT_FOUND, Openfort's missing player?",
  options: [
    { label: "drop", text: "Drop it: Openfort's player is not a Capxul concept; a missing person is NOT_AUTHENTICATED or PROFILE_NOT_FOUND." },
    { label: "keep", text: "Keep it." },
  ],
  chosen: "drop",
  why: "No frozen text names it, and it leaks a vendor's word into the product's vocabulary.",
  source: by("blueprint/baseline/operations.ts (0 mentions); packages/protocol/src/errors/codes.ts:32"),
  affects: [v.error_NOT_AUTHENTICATED, v.error_PROFILE_NOT_FOUND],
});

export const decision_vocabulary_drop_account_not_found = defineDecision({
  id: "vocabulary.drop-account-not-found",
  title: "Drop ACCOUNT_NOT_FOUND; an unknown id is INVALID_INPUT",
  question: "Keep ACCOUNT_NOT_FOUND?",
  options: [
    { label: "drop", text: "Merge into INVALID_INPUT, which the frozen refusals already use for an id that names nothing." },
    { label: "keep", text: "Keep a not-found code." },
  ],
  chosen: "drop",
  why:
    "No frozen text names it; the frozen refusals answer an unknown or unreadable id with INVALID_INPUT throughout. The " +
    "old E5 problem (not found and not yours look alike) is a privacy property worth keeping: a caller learns nothing " +
    "about another tenant's ids.",
  source: by("blueprint/baseline/operations.ts (0 mentions); docs/as-is/payments.md (E5)"),
  affects: [v.error_INVALID_INPUT],
});

export const decision_vocabulary_drop_claimed_by_other = defineDecision({
  id: "vocabulary.drop-account-claimed-by-other-signer",
  title: "Drop ACCOUNT_CLAIMED_BY_OTHER_SIGNER; it is WRONG_STATE",
  question: "Keep ACCOUNT_CLAIMED_BY_OTHER_SIGNER?",
  options: [
    { label: "drop", text: "Merge into WRONG_STATE, as the designed `account retry` refusal does." },
    { label: "keep", text: "Keep it." },
  ],
  chosen: "drop",
  why: "The designed text answers 'The Safe is already claimed by another signer' with WRONG_STATE (CompaniesHouseClaimer's SwapRefused).",
  source: by("apps/docs/factory/operations/account.retry.yaml (designed refusals)"),
  affects: [v.error_WRONG_STATE],
});

export const decision_vocabulary_drop_env_missing = defineDecision({
  id: "vocabulary.drop-env-missing",
  title: "Drop ENV_MISSING; configuration is checked at boot",
  question: "Keep ENV_MISSING for a request that meets a missing setting?",
  options: [
    { label: "drop", text: "Drop it: every layer reads its configuration when the service starts, and a missing setting stops the boot." },
    { label: "keep", text: "Keep it." },
  ],
  chosen: "drop",
  why:
    "With Effect layers, configuration is read when the layer is built, so a missing setting is a failed boot (`env:<env>/boot`) " +
    "and never reaches a caller. The old code met it at run time, where it was misread as an outage (old R3).",
  source: by("docs/as-is/payments.md (R3: ENV_MISSING classified as provider_failure)"),
  affects: [f.component_backend, f.environment_staging],
});

export const decision_vocabulary_drop_signer_rejected = defineDecision({
  id: "vocabulary.drop-signer-rejected",
  title: "Drop SIGNER_REJECTED; a declined approval is CANCELLED",
  question: "Keep SIGNER_REJECTED for a person who declines to sign?",
  options: [
    { label: "drop", text: "Merge into CANCELLED, as the frozen fixes say ('a rejection with CANCELLED')." },
    { label: "keep", text: "Keep it beside CANCELLED." },
  ],
  chosen: "drop",
  why: "Three frozen fixes say a rejected approval ends with CANCELLED; nothing names SIGNER_REJECTED.",
  source: by("blueprint/baseline/operations.ts:5491, 17895, 18220"),
  affects: [v.error_CANCELLED, x.integration_openfort],
});

export const decision_vocabulary_drop_stale_epoch = defineDecision({
  id: "vocabulary.drop-stale-epoch",
  title: "Drop STALE_EPOCH",
  question: "Keep STALE_EPOCH for a request based on stale data?",
  options: [
    { label: "drop", text: "Drop it: the frozen text answers a stale revision with INVALID_INPUT and a changed state with WRONG_STATE." },
    { label: "keep", text: "Keep it." },
  ],
  chosen: "drop",
  why: "`service revise` refuses a changed revision with INVALID_INPUT; no frozen text names STALE_EPOCH.",
  source: by("apps/docs/factory/operations/service.revise.yaml (refusals)"),
  affects: [v.error_INVALID_INPUT, v.error_WRONG_STATE],
});

export const decision_vocabulary_drop_actor_stopped = defineDecision({
  id: "vocabulary.drop-actor-stopped",
  title: "Drop ACTOR_STOPPED; a frozen agent's refusal is WRONG_STATE",
  question: "Keep ACTOR_STOPPED for a stopped account or Organization?",
  options: [
    { label: "drop", text: "Merge into WRONG_STATE: a frozen agent or a stopped Organization is a state that does not allow the request." },
    { label: "keep", text: "Keep it." },
  ],
  chosen: "drop",
  why: "No frozen text names it, and on v4 a frozen agent is refused by AgentOwner on chain, which surfaces as a state refusal.",
  source: by("blueprint/baseline/operations.ts (0 mentions); AgentOwner.sol (freeze)"),
  affects: [v.error_WRONG_STATE],
});

export const decision_vocabulary_keep_unnamed = defineDecision({
  id: "vocabulary.keep-unnamed",
  title: "Keep five unnamed codes the runtime needs",
  question: "UNKNOWN, TRANSACTION_FAILED, PROVIDER_RESPONSE_INVALID, NOT_IMPLEMENTED and CLI_DEFECT are named by no frozen text. Keep them?",
  options: [
    { label: "keep", text: "Keep all five, each for one case nothing else covers." },
    { label: "drop", text: "Drop them and fold every case into the named codes." },
  ],
  chosen: "keep",
  why:
    "UNKNOWN is the one defect code every unexpected failure maps to. TRANSACTION_FAILED is a revert on chain, which no " +
    "refusal names but every chain write can meet. PROVIDER_RESPONSE_INVALID marks an answer that will not change on retry, " +
    "which PROVIDER_ERROR (retryable) would misstate. NOT_IMPLEMENTED is what a frozen command answers until it is built " +
    "(the low-priority equity area will be last), and it leaves when the last one is built. CLI_DEFECT is exit 1 in the " +
    "CLI's frozen exit table.",
  source: by("blueprint/baseline/operations.ts (0 mentions each); apps/cli/src/runtime/errors.ts:34 (CLI_DEFECT exit 1)"),
  affects: [v.error_UNKNOWN, v.error_TRANSACTION_FAILED, v.error_PROVIDER_RESPONSE_INVALID, v.error_NOT_IMPLEMENTED, v.error_CLI_DEFECT],
});

export const decision_vocabulary_no_concept_errors = defineDecision({
  id: "vocabulary.shared-only",
  title: "All error codes are shared; no concept defines its own",
  question: "May a concept define an error code in its own folder, as old organizations, payroll and permissions did?",
  options: [
    { label: "shared", text: "Every code lives in shared/vocabulary.ts; a new one needs a shared decision." },
    { label: "per-concept", text: "Each concept owns its codes." },
  ],
  chosen: "shared",
  why:
    "The CLI's exit table, the SDK's error union and the refusal evals all enumerate one list, and an old concept's codes " +
    "(PAYROLL_BUDGET_EXCEEDED) are now raised by another (budgets). One file makes a duplicate code impossible.",
  source: by("packages/protocol/src/errors/codes.ts:62-78 (codes assembled from 16 concept tables)"),
  affects: [v.error_PAYROLL_BUDGET_EXCEEDED, v.error_CHILDREN_EXCEED_PARENT, v.error_AUTHORISED_EXCEEDED],
});

// ── integrations ────────────────────────────────────────────────────────────────────────────

export const decision_integrations_set = defineDecision({
  id: "integrations.set",
  title: "Eleven integrations, two of them new",
  question: "Which outside systems are Effect services in the target?",
  options: [
    {
      label: "eleven",
      text:
        "chain-rpc, bundler, indexer, bridge, mail, openfort, openfort-shield, chainlink, posthog, service-signer and " +
        "devnet-control; chain-evidence folds into indexer; roles becomes a contract.",
    },
    { label: "as-is", text: "Keep the old integration folders (chain-rpc, chain-evidence, ponder, mail, openfort, bridge, roles, chainlink, companies-house)." },
  ],
  chosen: "eleven",
  why:
    "The bundler is no longer reached through chain-rpc: it has its own failures and its own budget class. Old " +
    "chain-evidence checked receipts beside the indexed facts; with one settlement path, a transaction's facts are read " +
    "from Ponder's tables together (indexer). The service keys (Companies House, the Budgets executor, the escrow " +
    "relayer, the faucet) were scattered across concepts and an integration folder; one service gives one send-once " +
    "rule. Openfort has a backend half (Shield's recovery session) and a client half (the signer), on different " +
    "components. The devnet's control socket is an outside system to the Core SDK.",
  source: by("docs/as-is/archive/shared/external.ts; docs/mission/findings.md (10 integrations, 186 functions)"),
  affects: [
    x.integration_chain_rpc, x.integration_bundler, x.integration_indexer, x.integration_bridge, x.integration_mail,
    x.integration_openfort, x.integration_openfort_shield, x.integration_chainlink, x.integration_posthog,
    x.integration_service_signer, x.integration_devnet_control,
  ],
});

export const decision_integrations_timeouts = defineDecision({
  id: "integrations.timeouts",
  title: "Timeouts and p95s come from the budget classes, not the old 30 s",
  question: "How are each call's timeout, retries and p95 set?",
  options: [
    { label: "from-budgets", text: "From P5's hop table, so a call fits its rpc's class default; money-moving calls are never retried blindly." },
    { label: "as-is", text: "Keep the old 30 s per attempt and up to four nodes." },
  ],
  chosen: "from-budgets",
  why:
    "A chain-read operation has p95 2,000 ms (P5), so a 30 s attempt cannot be inside it; one eth_call is 400 ms p95, so " +
    "1.5 s per attempt and three nodes keep the worst case near the class. Vendor calls are 2 s p95 at 10 s timeout. A " +
    "send (bundler, service signer) has no retry: its answer can be lost after it took effect, so the rule is look up, " +
    "never resend (K4, CAP-1097). Mail retries in the notices workflow, not in the call.",
  source: by("P5 (hop table, class defaults); docs/as-is/archive/shared/external.ts (NODE: 30 s, 4 nodes); K4"),
  affects: [x.integration_chain_rpc, x.integration_bundler, x.integration_bridge, x.integration_mail, x.integration_service_signer],
});

export const decision_integrations_indexer = defineDecision({
  id: "integrations.indexer",
  title: "The indexer is a service for what depends on Ponder's progress",
  question: "Ponder's tables are in the same Postgres. Why an integration at all, and what are its calls?",
  options: [
  {
    "label": "current-scope",
    "text": "Indexed table reads and progress-dependent calls are distinct: head, awaitBlock and factsOf must time out or fail visibly when the chain reader lags. Ponder is the reader in every environment, worlds included (aaron.postgres-and-ponder); unavailable progress never becomes a successful empty result."
  },
  {
    "label": "historical",
    "text": "The former answer to integrations.indexer is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Indexed table reads and progress-dependent calls are distinct: head, awaitBlock and factsOf must time out or fail visibly when the chain reader lags. Ponder is the reader in every environment, worlds included (aaron.postgres-and-ponder); unavailable progress never becomes a successful empty result. Authority: devnet.lean-world; plugs.event-order; plugs.reversal-not-deletion.",
  source: "The coordinator, round 2, m1-old-decisions; devnet.lean-world; plugs.event-order; plugs.reversal-not-deletion",
  affects: [x.integration_indexer, f.concept_indexing],
});

export const decision_integrations_posthog = defineDecision({
  id: "integrations.posthog",
  title: "PostHog only through the connector gateway, and nothing waits on it",
  question: "How does the product reach PostHog?",
  options: [
    { label: "gateway", text: "Through the connector gateway, which holds the key: the outbox relay's events, the runtime's telemetry and the flag sync." },
    { label: "direct", text: "Directly with a project token in the backend." },
  ],
  chosen: "gateway",
  why:
    "The task fixes 'PostHog through the gateway' and Y4 has another thread building it; the key then never sits in the " +
    "backend's secrets. Every PostHog call is on a background path (relay, export, flag sync), so `balance` #3's 'answers " +
    "without waiting on PostHog' holds by construction.",
  source: by("docs/decisions/README.md (Y4); docs/spec/40-capxul-team.md (PostHog connector gateway)"),
  affects: [x.integration_posthog],
});

export const decision_integrations_signer = defineDecision({
  id: "integrations.openfort",
  title: "Openfort is the person's signer in the Core SDK; agents sign locally",
  question: "Where does signing happen, and which signers are outside systems?",
  options: [
    { label: "sdk-signer", text: "The Core SDK's Signer service: Openfort in a browser, the agent's own key or a dev signer locally; only Openfort is an integration." },
    { label: "backend-signer", text: "The backend signs for people with a custodial key." },
  ],
  chosen: "sdk-signer",
  why:
    "A4 gives all signing to the Core SDK, and the v4 design keeps the person's key out of Capxul's hands. An agent's key " +
    "is on the agent's machine (`CAPXUL_PRIVATE_KEY` or a file). Only Openfort is an outside system with failures to map.",
  source: by("A4; whoami.yaml (designed: how the account signs); packages/sdk/src/signing/signer.ts:47"),
  affects: [x.integration_openfort, x.integration_openfort_shield, f.component_core_sdk],
});

// ── contracts ───────────────────────────────────────────────────────────────────────────────

export const decision_contracts_set = defineDecision({
  id: "contracts.v4-set",
  title: "The v4 contracts plus the third-party contracts v4 wires",
  question: "Which contracts does the target book record (P9: v4 only)?",
  options: [
    {
      label: "v4-and-wired",
      text:
        "The 15 v4 address-book contracts (Escrow and its factory counted separately) and the third-party contracts the v4 " +
        "install wires and the product calls: Safe, Safe4337Module, MultiSendCallOnly, EntryPoint v0.7, Roles 2.1, Hats, " +
        "the Hats Signer Gate v2, Hats Elections and ERC-20.",
    },
    { label: "capxul-only", text: "Only Capxul's own v4 contracts." },
  ],
  chosen: "v4-and-wired",
  why:
    "P9 drops V2, V3, CapxulEscrow, PayrollDepartments and the rest. The third-party contracts are not pre-v4: v4's " +
    "architecture lists Hats, the Signer Gate and Roles as its authority group, and every approval goes through the " +
    "EntryPoint and the Safe module. Without them the book could not name the calls the designed text makes (approveHash, " +
    "mintHat, claimSignerFor). The libraries are left out: no frozen operation calls them. Hats Elections was left out " +
    "at first and is in since the assembly (contracts.hats-elections): the designed shareholder votes call it through the " +
    "Governor.",
  source: by("P9; packages/protocol/src/evm/protocol-v4-addresses.ts:12-30; docs/planning/protocol-v4/architecture.md"),
  affects: [
    x.contract_companies_house_claimer, x.contract_company_safe_minter, x.contract_installer, x.contract_payments,
    x.contract_budgets, x.contract_agreements, x.contract_escrow_factory, x.contract_escrow, x.contract_agent_owner,
    
    x.contract_safe, x.contract_safe_4337_module, x.contract_multi_send_call_only, x.contract_entry_point,
    x.contract_roles, x.contract_hats, x.contract_hats_signer_gate, x.contract_erc20,
  ],
});

export const decision_contracts_addresses = defineDecision({
  id: "contracts.addresses",
  title: "Addresses: the devnet deployment now, staging when it is deployed",
  question: "Which addresses do contract records carry?",
  options: [
    { label: "devnet-now", text: "The devnet deployment from the v4 address book; staging's after the fresh deployment; none for per-company proxies and per-escrow contracts." },
    { label: "old-staging", text: "Reuse old staging's addresses." },
  ],
  chosen: "devnet-now",
  why:
    "v4 is deployed only on the devnet today, and P9 gives the new staging a fresh deployment with nothing migrated, so " +
    "old staging's addresses (V2 and V3) must not appear. A Safe, a company's Roles and Gate, and each escrow are proxies " +
    "with one address each, so their records carry none; the clone contracts carry their implementation's.",
  source: by("packages/protocol/src/evm/protocol-v4-addresses.ts:39-60 (devnet only); P9"),
  affects: [x.contract_safe, x.contract_roles, x.contract_hats_signer_gate, x.contract_escrow, x.contract_erc20, f.environment_staging],
});

export const decision_contracts_functions = defineDecision({
  id: "contracts.functions",
  title: "Record the functions the designed calls name, and the events concepts follow",
  question: "Which functions and events go on each contract record?",
  options: [
    { label: "used", text: "Every function a frozen designed `call` names, the views a write must read first, and every event a concept must follow." },
    { label: "full-abi", text: "The full ABI of each contract." },
  ],
  chosen: "used",
  why:
    "The build reports a function nothing calls and an event nothing consumes as gaps, so recording only what the product " +
    "uses makes those gaps meaningful: each one left after the concept designs is either a missing design or a contract " +
    "function the product does not need. Admin and wiring functions (configure, setAgreements, setUp) belong to the " +
    "install, which the Installer's batches build. A call one contract makes to another inside a call the product makes " +
    "(Budgets.commit inside Agreements.offer, Budgets.payReserved inside Agreements.collect, Captable.forcedTransfer " +
    "inside Exits.buy, Captable.setConversionPrice inside Rounds.close) is the callee's business and is left out. The " +
    "designed text's `Budgets.setOffice` is v4's `setHat` (IBudgets.sol:203), recorded under that name.",
  source: by("blueprint/baseline/operations.ts (designed.call), scanned again on 8 November 2026; old as-is gap `uncalled-function` (18)"),
  affects: [x.contract_budgets, x.contract_agreements, x.contract_installer, x.contract_hats, x.contract_safe],
});

// ── environments ────────────────────────────────────────────────────────────────────────────

export const decision_environments_devnet = defineDecision({
  id: "environments.devnet",
  title: "The devnet runs everything on one machine, with worlds as snapshots",
  question: "What does the devnet environment run, and how fast must it boot?",
  options: [
    { label: "whole-stack", text: "All ten components on loopback; worlds are supervisor snapshots; boot from a golden snapshot within 2 minutes." },
    { label: "partial", text: "A devnet without Ponder or the MCP server, as the old one booted without the indexer." },
  ],
  chosen: "whole-stack",
  why:
    "Every machine eval runs on a devnet as a black box (spec 30), and settlement is now triggered by Ponder's events, so " +
    "a devnet without Ponder could not settle a payment. The 2-minute boot is the spec 40 spike's exit criterion.",
  source: by("docs/spec/30-capxul-evals.md; docs/spec/40-capxul-team.md (boot within 2 min); packages/devnet/README.md:130"),
  affects: [f.environment_devnet],
});

export const decision_environments_staging = defineDecision({
  id: "environments.staging",
  title: "A new staging: fresh v4, nothing migrated, host chosen at the spine",
  question: "What is the new staging?",
  options: [
    { label: "new", text: "A new standing environment with a fresh v4 deployment on Base Sepolia, no migration from old staging, its host chosen at the spine." },
    { label: "reuse", text: "Upgrade old staging in place." },
  ],
  chosen: "new",
  why:
    "P9 drops pre-v4 entirely, and old staging runs V2 and V3. Y3 leaves the host to the spine, so the record names what " +
    "runs and what it needs, not where. Turning old staging off is Aaron's irreversible step (P9) and is not taken here.",
  source: by("P9; docs/decisions/README.md (Y3)"),
  affects: [f.environment_staging],
});

// ── system ──────────────────────────────────────────────────────────────────────────────────

export const decision_system_actors = defineDecision({
  id: "system.actors",
  title: "Actors as v4 has them",
  question: "Which actors does the target system list?",
  options: [
    { label: "v4", text: "The old actors, with ai-seat folded into agent, system-job renamed system, and office-holder covering every hat wearer." },
    { label: "as-is", text: "Keep the old list unchanged." },
  ],
  chosen: "v4",
  why:
    "The designed text replaces `--ai` with `--agent` ('The Seat is held by an agent'), so an AI Seat is an agent with a " +
    "Seat. A workflow acts for no caller, whatever started it, so 'system' covers crons, timers, chain events and transitions.",
  source: by("org.member.invite.yaml (designed: --agent replaces --ai); docs/as-is/archive/shared/foundation.ts (actors)"),
  affects: [f.system_capxul],
});

// ── operations ──────────────────────────────────────────────────────────────────────────────

export const decision_operations_owners = defineDecision({
  id: "operations.owners",
  title: "Each frozen operation has one owning concept; an area spreads over several",
  question: "Which concept designs each of the 215 frozen operations?",
  options: [
    { label: "by-area-with-exceptions", text: "Each area maps to a concept; an operation whose behaviour belongs to another concept goes there (OPERATION_OWNERS)." },
    { label: "by-area", text: "Every operation stays with its area's concept." },
  ],
  chosen: "by-area-with-exceptions",
  why:
    "Areas are how people find commands, not concepts (the operation record says so). 134 operations sit in their area's primary concept (AREA_CONCEPTS) and 81 move with their behaviour: agents, session and local commands out of accounts; `doctor` and keys to applications; verification and `contact bank add` to banking; invitations and members to organizations, `invite accept` to banking, allowances and `org member invite` to budgets and votes to equity out of governance; requests, services, the inbox, contacts, documents, `address` and `balance` out of payments, with `contact get` to banking; `activity annotate` to books; `bank match` to requests; `org department pay` to payments; `dev fund` to accounts, `dev key` to applications. The map is typed against every frozen id, so none can be missed, and every concept but media, parties, indexing, approvals and notices owns at least one operation. The rule behind each exception: an operation's flow sits in a concept that depends on every concept whose rpcs it composes (operations.sign-in-in-accounts, operations.member-invite-in-budgets, operations.invite-accept-in-banking, operations.contact-get-in-banking); every devnet-only operation is devnet's (operations.dev-mail-notices-in-devnet). Review, 11 November 2026: Confirmed operations.owners; original choice retained.",
  source: by("blueprint/baseline/operations.ts (215 operations, 11 areas); OPERATION_OWNERS in blueprint/shared/foundation.ts"),
  affects: [...f.CONCEPTS],
});

// ── review of the map against the frozen operations (8 November 2026) ─────────────────────────
// A second pass read every frozen operation's `who` and designed `call` against its owner's
// `dependsOn`. These records settle what that pass found.

const REVIEW = "Claude, target architecture review, 8 November 2026";
const reviewed = (evidence: string) => `${REVIEW}; evidence: ${evidence}`;

export const decision_concepts_books_token_scan = defineDecision({
  id: "concepts.books-token-scan",
  title: "Books scans the tokens an Organization adds; indexing has no workflow",
  question: "P3 keeps the scan of tokens added at run time. Which concept owns it, given that only books knows which tokens were added?",
  options: [
  {
    "label": "current-scope",
    "text": "Books owns scanning tokens explicitly added to its asset list, because it knows the add block and the company Safe. The scanner writes idempotent outside-money facts; indexing remains the chain read model, not a second owner of the added-token list."
  },
  {
    "label": "historical",
    "text": "The former answer to concepts.books-token-scan is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Books owns scanning tokens explicitly added to its asset list, because it knows the add block and the company Safe. The scanner writes idempotent outside-money facts; indexing remains the chain read model, not a second owner of the added-token list. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [f.concept_books, f.concept_indexing, x.integration_chain_rpc],
});

export const decision_procedures_accounts_admit = defineDecision({
  id: "procedures.accounts-admit",
  title: "One authority procedure: an invitation admits its invitee to the beta",
  question:
    "`org member invite` 'admits the invitee to the beta with no second welcome email'. Admission is accounts', the " +
    "invitation organizations', and accounts sits below organizations. How is the admission written?",
  options: [
    { label: "procedure", text: "Organizations' invitation rpc invokes `accounts.admit` in its own transaction." },
    { label: "outbox", text: "Accounts follows `invitation_transitioned` (it would have to depend on organizations: a cycle)." },
    { label: "admission-in-access", text: "Move admission back to access, below both, and invoke `access.admit` from accounts and organizations." },
    { label: "derived", text: "Compute admission at the gate from invitations (the gate would have to read organizations)." },
  ],
  chosen: "procedure",
  why:
    "P4 sends a lagging change to the outbox only when the consumer can depend on the producer; here it cannot, and a " +
    "flow step cannot do it either, because accounts could not check that the caller really invited that email. An " +
    "invitation and the admission it carries must never disagree at a commit: an invitee who got the invitation but is " +
    "still waiting cannot take the Seat. So it is one fact, of authority rather than money, and the one procedure that " +
    "is not a money fact; its `about` begins `Authority fact:`. Admission stays in accounts with referrals, because a " +
    "spent invite and the friend it admits are one write there. The beta gate is checked only above accounts (setting " +
    "up the Safe, the faucet, `org create`, `referral invite`); the old hold at profile onboarding (old profiles, now " +
    "parties, below accounts) moves to the Safe's setup, which already refuses a waiting person. Aaron accepted it. A " +
    "second invoker came with the ruling that waiting money admits its recipient as an invitation does: payments' " +
    "`escrow` step invokes it for a claim escrow's mailbox (`via` escrow; accounts.money-waiting-admits), for the same " +
    "reason, since accounts sits below payments too. A third came with aaron.fde-anyone: organizations' " +
    "`org fde guest add` invokes it for the guest it names (`via` fde-guest; organizations.fde-guests), so the guest " +
    "can sign in to ask.",
  source: reviewed("org.member.invite.yaml (acceptance), org.create.yaml ('a founder on the beta waitlist is refused'); access/waitlist/guards.ts:49; P4"),
  affects: [f.concept_accounts, f.concept_organizations, f.concept_parties, f.concept_payments, decision_rules_procedures],
});

export const decision_operations_sign_in = defineDecision({
  id: "operations.sign-in-in-accounts",
  title: "`auth login` and `auth verify` are accounts' flows over access' rpcs",
  question: "Both commands end by reporting whether the account is set up, which is accounts'. Which concept owns their flows?",
  options: [
    { label: "accounts", text: "Accounts: the flow sends and checks the code through access' rpcs, then reads the Safe's setup state." },
    { label: "access", text: "Access, with the setup state left out." },
  ],
  chosen: "accounts",
  why:
    "'Like auth login, it returns the setup link if your account is not ready yet' is frozen surface (P10 rung 1). A flow " +
    "may compose only rpcs of concepts its own concept depends on, and access depends on nothing, so the flow sits in " +
    "accounts, which is the person's way in. Sessions, codes, the send cooldown and an agent's key challenge stay access' rpcs.",
  source: reviewed("auth.login.yaml, auth.verify.yaml (notes); A4"),
  affects: [f.concept_accounts, f.concept_access],
});

export const decision_operations_member_invite = defineDecision({
  id: "operations.member-invite-in-budgets",
  title: "`org member invite` is budgets' flow, because its grants include allowances",
  question:
    "An invitation is organizations'; the grants it offers (officer hats, existing allowances, a new allowance) are one " +
    "Board proposal. Which concept owns the operation's flow and the proposal of the grants?",
  options: [
    {
      label: "budgets",
      text:
        "Budgets: the flow creates the invitation through organizations' rpc, then budgets' rpc plans every grant (officer " +
        "hat mints from the deployment's hat ids; an allowance's hat, and for a new one `Hats.createHat` and " +
        "`Budgets.createChildBudget` with its budgets row), opens one proposal (`board.propose`) and binds it to the " +
        "invitation (`organizations.bind-invitation-grants`). Budgets also proposes taking the hats back when an offer " +
        "ends with them on chain.",
    },
    { label: "board", text: "Board, as first decided: board's flow proposes the grants through its own rpc." },
    { label: "existing-only", text: "Board, with invitations narrowed to officer hats and existing allowances; a new allowance waits for `org allowance create --assign-to`." },
    { label: "organizations", text: "Organizations, calling board's rpc (organizations would depend on board, and board on organizations: a cycle)." },
  ],
  chosen: "budgets",
  why:
    "Revised in the 8 November adversarial review. The frozen text offers 'existing spending allowances, a new spending " +
    "allowance or Manage allowances with the invitation', and the designed call is one Board batch with 'the allowance's " +
    "`Hats.createHat`, `Budgets.createChildBudget` and `Hats.mintHat`'. Planning an allowance (its parent, its hat, " +
    "CHILDREN_EXCEED_PARENT, its budgets row) is budgets' alone, and board sits below budgets, so board's flow could not " +
    "compose it; the budgets designer had to narrow the frozen offer to existing allowances " +
    "(budgets.invitation-allowance-offers), which P10 rung 1 does not allow. Budgets is the lowest concept that depends on " +
    "organizations, board and its own allowances, and it already opens Board proposals for allowances " +
    "(`org allowance assign`). Officer hat mints are two Hats calls built from hat ids organizations already holds. Board " +
    "keeps `org member grant` and `org member revoke`; an invitation's grants, and taking them back, have one owner. The " +
    "request key makes a repeat return the same invitation and the same proposal.",
  source: reviewed(
    "org.member.invite.yaml (about; designed call); blueprint/budgets/decisions.ts (budgets.invitation-allowance-offers); " +
      "blueprint/organizations/procedures.ts (organizations.bind-invitation-grants)",
  ),
  affects: [f.concept_budgets, f.concept_board, f.concept_organizations],
});

export const decision_operations_invite_accept = defineDecision({
  id: "operations.invite-accept-in-banking",
  title: "`invite accept` is banking's flow, because it routes business verification",
  question: "`invite accept` accepts an Organization invitation, or for an `inv_kyb_` id starts the person's verification with `--input`. Which concept owns the flow?",
  options: [
    { label: "banking", text: "Banking: the flow sends an `inv_kyb_` id to its own verification rpc and every other id to organizations' accept rpc." },
    { label: "organizations", text: "Organizations, which cannot reach banking's verification (banking depends on organizations)." },
    { label: "kyb-in-organizations", text: "Make business verification invitations organizations', passing the person's KYC answers through it." },
  ],
  chosen: "banking",
  why:
    "The CLI calls one SDK method per command (A4), so the routing is one flow, in a concept that depends on both. " +
    "Banking is the lowest such concept. Keeping a person's verification answers out of organizations matters more than " +
    "where a two-branch flow sits; the Organization invitation's rpcs and state stay organizations'.",
  source: reviewed("invite.accept.yaml (about: 'For a business invitation (an ID starting inv_kyb_), it starts your verification')"),
  affects: [f.concept_banking, f.concept_organizations],
});

export const decision_dependencies_agent_seats = defineDecision({
  id: "dependencies.agent-seats",
  title: "A removed agent's Seats end from the chain event",
  question: "`agent remove`: 'the backend ends its Seats'. Seats are organizations', agents sits above organizations. How?",
  options: [
    { label: "chain-event", text: "Organizations' workflow, triggered by AgentOwner's `AgentRemoved`, ends every Seat the agent's Safe holds." },
    { label: "procedure", text: "Agents invokes an organizations procedure in the removal's transaction." },
  ],
  chosen: "chain-event",
  why:
    "The removal is final only when `AgentOwner.remove` lands, so the Seats must follow the chain, not the request: a " +
    "procedure at prepare time would end Seats for a removal that never lands. A chain-event trigger needs only " +
    "organizations' existing dependency on indexing.",
  source: reviewed("agent.remove.yaml (designed call); AgentOwner.sol (AgentRemoved)"),
  affects: [f.concept_organizations, f.concept_agents, x.contract_agent_owner],
});

// ── where every old area went ───────────────────────────────────────────────────────────────

export const decision_responsibilities_landings = defineDecision({
  id: "responsibilities.landings",
  title: "Every old concept area lands in a target concept, or is dropped by a decision",
  question: "How is it shown that every responsibility of the 17 old concepts lands somewhere?",
  options: [
    { label: "typed-map", text: "OLD_AREAS in shared/landings.ts: each of the old concepts' area folders, the target concepts it lands in, and the decision that put it there." },
    { label: "prose", text: "Each target concept's `about` names what it absorbs." },
  ],
  chosen: "typed-map",
  why:
    "A concept's `about` says what it absorbs, but nothing checks that the old list is covered. The map lists all 91 area folders under packages/backend/src/<concept>/, plus the root files of documents and parties, and every entry names a decision record, so a dropped responsibility is a judgment a reviewer can find. The map is not a record: the build follows its decisions' `affects`. Review, 11 November 2026: Confirmed responsibilities.landings; original choice retained.",
  source: reviewed("ls packages/backend/src/<concept>/ at 0d2be303e"),
  affects: [...f.CONCEPTS],
});

export const decision_responsibilities_summaries = defineDecision({
  id: "responsibilities.summaries",
  title: "Old accounts' summaries: deposit instructions to activity, the rest by surface",
  question: "Old `accounts.summaries` served `home`, `me`, the 'needs you' list and deposit instructions. Where do they go?",
  options: [
    { label: "activity", text: "Deposit instructions become activity's `address`; `home`, `me` and 'needs you' come back only as flows for a named surface (P2)." },
    { label: "accounts", text: "Keep a summaries area in accounts." },
  ],
  chosen: "activity",
  why:
    "`address` is the only frozen operation they back (`client.account.profile.depositInstructions`), and it reads for " +
    "whoever you act as, which is activity's. `home` composed treasuries, payroll runs and activity items in one action; " +
    "no frozen operation calls it, so P2 deletes it until the web app names it, and then it is a react-surface flow over " +
    "activity's, approvals' and requests' reads.",
  source: reviewed("address.yaml (sdk); docs/as-is/archive/accounts/summaries.ts:1-12; P2"),
  affects: [f.concept_activity, f.concept_accounts],
});

export const decision_responsibilities_overlays = defineDecision({
  id: "responsibilities.overlays",
  title: "Old activity's overlays are dropped",
  question: "Old activity added Convex overlays to indexed chain rows. Keep them?",
  options: [
    { label: "drop", text: "Drop: the feed reads Ponder's views and payments' rows in one Postgres, so there is nothing to overlay." },
    { label: "keep", text: "Keep an overlay table in activity." },
  ],
  chosen: "drop",
  why: "The overlay joined two stores (Convex rows on top of the indexer's answer). With one Postgres the join is a query.",
  source: reviewed("packages/backend/src/activity/overlays/; components.ponder"),
  affects: [f.concept_activity],
});

export const decision_responsibilities_repairs = defineDecision({
  id: "responsibilities.repairs",
  title: "Old applications' repairs are dropped",
  question: "Old applications had operator-only repair mutations run by hand with `convex run`. Port them?",
  options: [
    { label: "drop", text: "Drop: no frozen operation reaches them (P2); a data repair is a migration, not an rpc." },
    { label: "keep", text: "Port them as devnet-only rpcs." },
  ],
  chosen: "drop",
  why: "They mended rows the old shapes let go wrong (disposable proofs). Nothing is migrated from old staging (P9), and the target's generated migrations and tenancy evals cover what they guarded.",
  source: reviewed("docs/as-is/archive/applications/repairs.ts:1-6; P2; P9"),
  affects: [f.concept_applications],
});

export const decision_responsibilities_operator_proof_tools = defineDecision({
  id: "responsibilities.operator-proof-tools",
  title: "Old operator's proof identities, fixtures and receipt hold are dropped",
  question: "Old operator peeked at sign-in codes and Safes, seeded identities and fixtures, purged accounts and held receipts for acceptance runs. Port them?",
  options: [
    { label: "worlds", text: "Drop them: eval worlds are built by running operations as the devnet's fixed identities and saved as snapshots; codes are read from the mail sink; a held receipt is the bundler fake's fault switch." },
    { label: "devnet-rpcs", text: "Port each as a devnet-only rpc." },
  ],
  chosen: "worlds",
  why:
    "They wrote other concepts' rows from outside (the as-is book's write-boundary findings), which no target rule " +
    "allows. A world made by real operations is the black-box baseline spec 30 asks for, and the supervisor restores it " +
    "in seconds. No frozen operation reaches them.",
  source: reviewed("packages/backend/src/operator/README.md:3-20; docs/as-is/archive/operator/identities.ts, fixtures.ts, receipts.ts"),
  affects: [f.concept_devnet, f.component_devnet],
});

export const decision_responsibilities_keepers = defineDecision({
  id: "responsibilities.keepers",
  title: "'Manage books' is the Books officer hat",
  question: "Old books listed its keepers (who holds Manage books). What is that on v4?",
  options: [
  {
    "label": "current-scope",
    "text": "Manage books means the on-chain Books hat, granted and revoked through board and read from hat wearers, never a keepers table. Its site permissions are the versioned hat-to-role projection; granting a Frappe role by hand cannot confer chain authority."
  },
  {
    "label": "historical",
    "text": "The former answer to responsibilities.keepers is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why: "Review, 11 November 2026: Manage books means the on-chain Books hat, granted and revoked through board and read from hat wearers, never a keepers table. Its site permissions are the versioned hat-to-role projection; granting a Frappe role by hand cannot confer chain authority. Authority: cut.books; plugs.repoint-money-fact; plugs.late-and-closed.",
  source: "The coordinator, round 2, m1-old-decisions; cut.books; plugs.repoint-money-fact; plugs.late-and-closed",
  affects: [f.concept_books, f.concept_board],
});

export const decision_responsibilities_destinations = defineDecision({
  id: "responsibilities.destinations",
  title: "Receiving destinations stay in parties; the Solana cleanup is dropped",
  question: "Old parties' destinations included internal report and remove operations for unused Solana wallets. Keep them?",
  options: [
    { label: "drop-cleanup", text: "Destinations stay with the Party; the Solana report and removal are dropped." },
    { label: "keep", text: "Port all destination operations." },
  ],
  chosen: "drop-cleanup",
  why: "The two internal operations clean up old rows on a network the target does not serve; nothing is migrated (P9) and no frozen operation calls them (P2).",
  source: reviewed("packages/backend/src/parties/README.md:124-128"),
  affects: [f.concept_parties],
});

export const decision_responsibilities_roles = defineDecision({
  id: "responsibilities.roles",
  title: "Old organizations' invitable roles list is dropped",
  question: "Old organizations listed 'the roles a member can be invited into'. What is that on v4?",
  options: [
    { label: "drop", text: "Drop: on v4 an invitation offers the three officer hats and the Organization's allowances, which budgets' invite flow reads and `--preview` shows." },
    { label: "keep", text: "Keep a roles read in organizations." },
  ],
  chosen: "drop",
  why: "The roles were pre-v4 Zodiac Roles shapes (P9). No frozen operation calls the read.",
  source: reviewed("packages/protocol/src/organizations/operations.ts:174-182; org.member.invite.yaml (designed)"),
  affects: [f.concept_organizations, f.concept_board],
});

export const decision_responsibilities_service_lanes = defineDecision({
  id: "responsibilities.service-lanes",
  title: "Old accounts' service-key lanes become the service signer",
  question: "Old accounts kept the Companies House key's sender lane (one send in flight). Where does that go?",
  options: [
    { label: "integration", text: "Into the service-signer integration: one send in flight per key, signed bytes recorded before broadcast." },
    { label: "accounts", text: "Keep the lane table in accounts." },
  ],
  chosen: "integration",
  why: "Every service key (claim, tier, Budgets executor, escrow relayer, faucet) needs the same rule, and only one of them is accounts'.",
  source: reviewed("docs/as-is/archive/accounts/lanes.ts:1-7 (CAP-1097); integrations.set"),
  affects: [x.integration_service_signer, f.concept_accounts],
});

// ── each concept's dependencies, one reason per edge ────────────────────────────────────────
// The reasons are typed against each concept's `dependsOn`: an edge with no reason, or a reason
// for an edge that does not exist, does not compile. The decisions above settle the contested
// directions; these say why each remaining edge is needed at all.

type DepIds<C extends { readonly dependsOn: readonly { readonly id: string }[] }> = C["dependsOn"][number]["id"];

/** Each concept's edges and their reasons, as the records below state them (for the readable account). */
export const DEPENDENCY_REASONS: Record<string, Readonly<Record<string, string>>> = {};

const dependencies = <const C extends Concept>(
  concept: C,
  reasons: { readonly [D in DepIds<C>]: string },
) => {
  DEPENDENCY_REASONS[concept.id] = reasons;
  return defineDecision({
    id: `dependencies.of-${concept.id}`,
    title: `What ${concept.title.toLowerCase()} depends on, and why`,
    question: `Which concepts must ${concept.id} read or invoke, and does each edge point the right way?`,
    options: [
      {
        label: "as-booked",
        text: concept.dependsOn.length ? `Depend on ${concept.dependsOn.map((d) => d.id).join(", ")}.` : "Depend on nothing.",
      },
      { label: "fewer", text: "Drop an edge and reach that concept's facts another way (an event, the chain, a value passed in)." },
    ],
    chosen: "as-booked",
    why: concept.dependsOn.length
      ? Object.entries(reasons as Record<string, string>).map(([d, why]) => `${d}: ${why}`).join(" ")
      : "Every concept asks it who is calling, so it depends on nothing (concepts.access).",
    source: reviewed("blueprint/baseline/operations.ts (who and designed call of each owned operation); OPERATION_OWNERS"),
    affects: [concept, ...concept.dependsOn],
  });
};

export const decision_dependencies_of_access = dependencies(f.concept_access, {});
export const decision_dependencies_of_media = dependencies(f.concept_media, {
  access: "who uploaded a file, and that only they or its owner may read it.",
});
export const decision_dependencies_of_parties = dependencies(f.concept_parties, {
  access: "a person's Party and profile are their principal's, and only they edit them.",
  media: "a profile photo points at a stored file.",
});
export const decision_dependencies_of_indexing = dependencies(f.concept_indexing, {
  parties: "every chain view is scoped by joining parties' directory of Safes and their owners (P8).",
});
export const decision_dependencies_of_approvals = dependencies(f.concept_approvals, {
  access: "an approval belongs to a principal, whose Safe is its sender.",
  indexing: "an approval ends only on chain proof: the UserOperationEvent on its nonce.",
});
export const decision_dependencies_of_accounts = dependencies(f.concept_accounts, {
  access: "admission, setup and sign-in are a principal's; the sign-in flows call access' code and session rpcs.",
  parties: "the person's Party gets its Safe at setup; `dev fund --org` resolves an Organization's handle to its Safe.",
  indexing: "Safe claims (CapxulSafeClaimed) earn referral invites, and the claim escrows waiting for a person are chain facts.",
  approvals: "collecting the claim escrows at setup is an approval from the person's Safe.",
});
export const decision_dependencies_of_organizations = dependencies(f.concept_organizations, {
  access: "the caller of every rpc.",
  media: "an Organization's logo points at a stored file.",
  parties: "the Organization's Party is registered at birth; an invitee is resolved by email, handle or Party.",
  indexing: "hat wearers, the minter's and Installer's events, and AgentRemoved, which ends an agent's Seats.",
  approvals: "the founder's install batch is an approval from the founder's Safe.",
  accounts: "the founder must be admitted with a claimed Safe, and an invitation admits its invitee (procedures.accounts-admit).",
});
export const decision_dependencies_of_board = dependencies(f.concept_board, {
  access: "the caller of every rpc.",
  parties: "a Director or a grantee is named by handle or email and resolved to their Safe.",
  indexing: "Director hat wearers, the company Safe's owners, threshold and approvals, and ExecutionSuccess.",
  approvals: "each Director's approveHash, and the founder's batches, are approvals from their own Safes.",
  organizations: "the company Safe, its members and hat ids, and the invitation whose grants it proposes.",
});
export const decision_dependencies_of_agents = dependencies(f.concept_agents, {
  access: "the owner is a principal, and the agent signs in through access with its key.",
  parties: "an agent registers its Party (handle and Safe) at birth.",
  indexing: "AgentOwner's events say what became of each change.",
  approvals: "a person-owned agent's change is an approval from the owner's Safe.",
  accounts: "a person must have a claimed Safe to own an agent.",
  organizations: "with `--org` the owner is the Organization's Safe, acted for by a Director.",
  board: "every change to an Organization-owned agent is a Board proposal.",
});
export const decision_dependencies_of_budgets = dependencies(f.concept_budgets, {
  access: "the caller of every rpc.",
  parties: "a holder or wearer is named by email or an agent's `@handle` and resolved to their Party and Safe; lists name them (dependencies.budgets-parties).",
  indexing: "Budgets' tree, amounts and spends, and each budget hat's wearers, are chain views.",
  approvals: "an office holder's change is an approval from their own Safe.",
  organizations: "the company Safe, members, hat ids from the install, and the invitations whose grants it proposes.",
  board: "top budgets, payout ceilings, allowance hats and an invitation's grants are Board batches.",
});
export const decision_dependencies_of_books = dependencies(f.concept_books, {
  access: "the caller of every rpc.",
  indexing: "the Transfers, PaymentSent facts and Safe balances it reconciles against, and the Books hat's wearers.",
  organizations: "books are an Organization's, and the Books hat id is in its deployment.",
});
export const decision_dependencies_of_documents = dependencies(f.concept_documents, {
  access: "the reader of a document.",
  parties: "a document's participants are Parties, given when it is stored.",
  indexing: "a payslip's Organization side is read only by a wearer of its People hat (documents.payslip-readers).",
  organizations: "an Organization participant's members may read its documents.",
});
export const decision_dependencies_of_contacts = dependencies(f.concept_contacts, {
  access: "the owner of a personal address book.",
  parties: "a contact names a Party, or a handle, email or address that resolves to one.",
  indexing: "only the People hat's wearers, read from Hats, edit an Organization's book and CRM (contacts.members-write).",
  organizations: "an Organization's book is acted on by its members.",
});
export const decision_dependencies_of_payments = dependencies(f.concept_payments, {
  access: "the payer.",
  parties: "the recipient is resolved to a Party and its Safe.",
  indexing: "PaymentSent, Transfers, escrow and Budgets events settle, reverse and birth Payments.",
  approvals: "a personal or budget payment is an approval from the payer's Safe.",
  accounts: "whether the sender and recipient have claimed Safes decides a direct send or a claim escrow, and money waiting in one admits its recipient through accounts.admit (accounts.money-waiting-admits).",
  organizations: "an `--org` payment's Organization and its company Safe.",
  board: "`--as-directors` payments and a company-owned claim escrow's refund are Board proposals.",
  budgets: "which budget pays, what it has left and who may spend from it.",
  books: "a settled Payment writes its book fact in its own transaction (books.record-money-fact).",
  documents: "a Payment's document is stored at its birth (documents.store).",
});
export const decision_dependencies_of_banking = dependencies(f.concept_banking, {
  access: "the caller of every rpc.",
  media: "verification documents are stored files.",
  parties: "bank details are per Party and currency, and a deposit lands in a Party's Safe.",
  indexing: "the token Transfer a bank deposit becomes, and Director hat wearers for a business's people.",
  approvals: "the payer signs a bank payout's approval: an agent with its own key at once (dependencies.payers-sign-and-name-budgets).",
  organizations: "who may manage an Organization's banking, and the routing of `invite accept`.",
  budgets: "`bank pay --from` names the budget an Organization pays from by its key, and who may spend from it.",
  books: "a bank deposit writes its book fact in its own transaction.",
  contacts: "a saved bank account may belong to a contact, and `contact get` reads the entry before its accounts.",
  payments: "a bank payout's money leaves as a Payment born through payments.prepare-command.",
});
export const decision_dependencies_of_requests = dependencies(f.concept_requests, {
  access: "the caller of every rpc.",
  parties: "the issuer and the payer are Parties.",
  indexing: "an invoice escrow's events pay a checkout request.",
  approvals: "the payer signs an inbox payment's approval: an agent with its own key at once (dependencies.payers-sign-and-name-budgets).",
  organizations: "an Organization's requests need the Invoicing hat; its inbox is read by members.",
  budgets: "`inbox pay --from` names the budget an Organization pays from by its key, and who may spend from it.",
  documents: "a request's invoice document is stored at issue.",
  payments: "paying from the inbox births a command; a request's paid state follows payment_transitioned.",
  banking: "a matched deposit is marked through banking.match-deposit.",
});
export const decision_dependencies_of_applications = dependencies(f.concept_applications, {
  access: "the caller of every rpc: a person owns their own applications and keys.",
  indexing: "the Invoicing hat's wearers may manage an Organization's keys.",
  organizations: "an Organization's applications, and its Invoicing hat id.",
});
export const decision_dependencies_of_activity = dependencies(f.concept_activity, {
  access: "the reader.",
  parties: "the counterparties a row names.",
  indexing: "Transfers and Safe balances.",
  organizations: "whether the reader may read an Organization's activity.",
  budgets: "what an Organization's budgets have left, for `available`.",
  books: "a row's account and memo, and USD prices.",
  documents: "the documents a row carries.",
  payments: "Payments, pending payments and Movements.",
});
export const decision_dependencies_of_notices = dependencies(f.concept_notices, {
  access: "the sender address and a recipient's principal.",
  parties: "a recipient's mailbox.",
  indexing: "who wears a budget's hat when a notice about its money is sent (notices.recipients).",
  accounts: "referral invites and admissions.",
  organizations: "invitations sent, resent and expiring.",
  board: "a proposal waiting for a Director.",
  budgets: "an allowance assigned to a member, at its amount once the assign executes (dependencies.notices-budgets).",
  payments: "a dated payment due or failed, and money received.",
  banking: "a business verification invitation and a payout returned.",
  requests: "a request issued, paid or declined.",
});
export const decision_dependencies_of_devnet = dependencies(f.concept_devnet, {
  access: "`dev approve` signs in as another person, and `dev gates set` writes gates.",
  approvals: "`dev approve` signs an approval with the dev signer.",
  organizations: "`dev gates set` for an Organization needs its membership.",
  notices: "`dev mail notices` reads notices' delivery records (operations.dev-mail-notices-in-devnet).",
  plugs: "a world's chain events reach every company's site through the plugs' outbox, on the world's one clock.",
  sites: "a world holds each company's site, which follows the world's clock and is saved and restored with it (devnet.site-follows-world).",
});

// ── adversarial review of the architecture (8 November 2026) ────────────────────────────────
// A third pass read the map against the frozen surface, the policies and what the first concept
// designers could not build within it. Each record settles one change it made to the shared
// records; operations.member-invite-in-budgets, above, was revised by the same pass.

const ADVERSARIAL = "Claude, adversarial architecture review, 8 November 2026";
const adversarial = (evidence: string) => `${ADVERSARIAL}; evidence: ${evidence}`;

export const decision_operations_dev_mail_notices = defineDecision({
  id: "operations.dev-mail-notices-in-devnet",
  title: "`dev mail notices` is devnet's, reading notices' delivery records",
  question: "`dev mail notices` answers only on a local devnet. May notices, a production concept, own it?",
  options: [
    { label: "devnet", text: "Devnet owns it and depends on notices to read the delivery records; notices owns the records and no operation." },
    { label: "notices", text: "Notices owns it, as first decided, because the delivery records are notices'." },
  ],
  chosen: "devnet",
  why:
    "P2 gives devnet-only rpcs to the devnet concept, the devnet environment says devnet-only rpcs are the devnet " +
    "concept's, and CONVENTIONS rule 7 says they live there. `dev mail notices` refuses WRONG_ENVIRONMENT off a local " +
    "devnet, so in notices it would put a devnet-only rpc in a concept staging runs, the case P2's `devnet-in-production` " +
    "rule exists to refuse. Reading another concept's table needs only the dependency, and devnet sits at the top, so " +
    "the edge makes no cycle (dependencies.notices-top already put devnet above notices).",
  source: adversarial("dev.mail.notices.yaml (refusals: WRONG_ENVIRONMENT); P2 (devnet concept, devnet-in-production); environment_devnet"),
  affects: [f.concept_devnet, f.concept_notices, f.environment_devnet],
});

export const decision_operations_contact_get = defineDecision({
  id: "operations.contact-get-in-banking",
  title: "Archived: `contact get` is banking's flow, because it returns the contact's bank",
  question: "`contact get` returns `bankAccounts`, which banking owns, and contacts sits below banking. Which concept owns it?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive the composition over contacts.book.get: that rpc is removed. The door reads Frappe Contact/Address; banking remains the owner of masked bank accounts by Party. The cut classification, not this old Core flow, carries contact.get reachability."
  },
  {
    "label": "historical",
    "text": "The former answer to operations.contact-get-in-banking is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive the composition over contacts.book.get: that rpc is removed. The door reads Frappe Contact/Address; banking remains the owner of masked bank accounts by Party. The cut classification, not this old Core flow, carries contact.get reachability. Authority: cut.contacts; sites.crm; plugs.roles-follow-hats.",
  source: "The coordinator, round 2, m1-old-decisions; cut.contacts; sites.crm; plugs.roles-follow-hats",
  affects: [f.concept_banking, f.concept_contacts],
});

export const decision_dependencies_budgets_parties = defineDecision({
  id: "dependencies.budgets-parties",
  title: "Budgets depends on parties",
  question:
    "Budgets' commands name people: `--holder <email>` 'the person or AI', `--member`, `--assign-to`, and lists that show " +
    "who wears each hat. Budgets had no edge to parties. Is one needed?",
  options: [
    { label: "parties", text: "Add parties: resolve an email or an agent's `@handle` to its Party and Safe, and name a wearer's Safe." },
    { label: "through-seats", text: "Resolve only through organizations' Seats and access' principals by email." },
  ],
  chosen: "parties",
  why:
    "A Seat carries a Party and a principal, not a mailbox or a handle. A person's email reaches their principal through " +
    "access, but an agent is named by its `@handle`, which is parties' namespace, and a hat wearer is shown by the name " +
    "its Safe's Party has. Every other concept that names people (board, payments, payroll, equity) already depends on " +
    "parties. Parties sits far below budgets, so the edge makes no cycle.",
  source: adversarial("org.department.holder.add.yaml (`<email>`: the person or AI); org.allowance.assign.yaml (`--member`); blueprint/organizations/data.ts (org-members)"),
  affects: [f.concept_budgets, f.concept_parties],
});

export const decision_dependencies_payers = defineDecision({
  id: "dependencies.payers-sign-and-name-budgets",
  title: "Requests and banking depend on approvals and budgets",
  question:
    "`inbox pay` and `bank pay` birth a Payment through payments.prepare-command, which opens its approval. Their flows " +
    "must then let the payer sign, and `--from` names the budget an Organization pays from. Requests and banking depended " +
    "on neither approvals nor budgets. What do they need?",
  options: [
    { label: "both-edges", text: "Add approvals and budgets to both: the flow reads and signs the approval, and the rpc resolves `--from` by the budget's key and checks who may spend." },
    { label: "page-and-chain-id", text: "No edges: a person always signs on the approval page, and `--from` takes the budget's chain id read from indexing." },
    { label: "payments-proxies", text: "Payments re-exposes the approval and resolves budget keys for its invokers." },
  ],
  chosen: "both-edges",
  why:
    "The frozen surface needs both. 'An AI with its own key signs at once': an agent payer signs in the flow (A4), which " +
    "calls approvals' rpcs, as every other paying concept's flow does. The designed examples name budgets by key (`bank " +
    "pay ... --from office-costs`, `inbox pay ... --from operations`) and print the budget's name and what it has left, " +
    "which only budgets holds. The requests designer recorded both as open problems and fell back to the approval page " +
    "and chain ids (requests.inbox-pay-approval, requests.inbox-pay-funding); a proxy in payments would duplicate approvals " +
    "and budgets inside the ledger. Both concepts sit below payments, so neither edge makes a cycle.",
  source: adversarial(
    "inbox.pay.yaml, bank.pay.yaml (designed flags and examples); blueprint/requests/decisions.ts; " +
      "blueprint/approvals/flows.ts ('every operation that opens an approval composes approvals' rpcs')",
  ),
  affects: [f.concept_requests, f.concept_banking, f.concept_approvals, f.concept_budgets],
});

export const decision_dependencies_notices_budgets = defineDecision({
  id: "dependencies.notices-budgets",
  title: "Notices depends on budgets, for the allowance email",
  question: "'Once a v4 assign executes, the member is emailed the allowance at its amount now.' Notices did not depend on budgets. Who sends it?",
  options: [
    { label: "notices-budgets", text: "Add budgets to notices: one notice workflow follows budgets' change transition and reads the allowance." },
    { label: "board-proposal", text: "Notices follows board's proposal_transitioned and reads nothing of budgets." },
  ],
  chosen: "notices-budgets",
  why:
    "Only budgets knows that a proposal carried an allowance assign, to whom and on which budget; a Board proposal does " +
    "not say. Notices sends every email and depends on what it tells about (dependencies.notices-top), and budgets sits " +
    "below it. The budgets designer asked for this edge (budgets.notices-need-budgets).",
  source: adversarial("org.allowance.assign.yaml (acceptance 5); blueprint/budgets/decisions.ts (budgets.notices-need-budgets)"),
  affects: [f.concept_notices, f.concept_budgets],
});

export const decision_integrations_sponsor_refusals = defineDecision({
  id: "integrations.sponsor-refusals",
  title: "A sponsorship simulation's budget reverts answer with the budget codes",
  question:
    "The bundler's `sponsor` mapped Budgets' `OverBudget` to INSUFFICIENT_BALANCE and every Zodiac Roles revert to " +
    "ROLE_PERMISSION_DENIED. Which codes do the frozen refusals give these reverts?",
  options: [
    {
      label: "frozen-codes",
      text:
        "As the designed refusals name them: `OverBudget` and Roles' AllowanceExceeded (the payout ceiling) are " +
        "PAYROLL_BUDGET_EXCEEDED, `BudgetIsClosed` WRONG_STATE, `ChildrenExceedParent` CHILDREN_EXCEED_PARENT, " +
        "`AmountBelowUse` AMOUNT_BELOW_USE; Budgets' `NotAuthorised` and every other Roles or Gate revert stay " +
        "ROLE_PERMISSION_DENIED, and a token's shortfall INSUFFICIENT_BALANCE.",
    },
    { label: "as-was", text: "Keep balance, authority and revert as the only three codes a simulation can answer." },
  ],
  chosen: "frozen-codes",
  why:
    "The designed refusals of `payment send`, `payment retry`, `org department pay`, `bank pay`, `inbox pay` and the " +
    "agreement offers name the contract error beside the code: `OverBudget(id, left, requested)`; Roles " +
    "`AllowanceExceeded` is PAYROLL_BUDGET_EXCEEDED, and `BudgetIsClosed(id)` is WRONG_STATE (P10 rung 1). Concepts read " +
    "`leftOf` before birth (K3), so the simulation is the backstop for a race; a backstop that answers a budget shortfall " +
    "as the Safe's balance, or the payout ceiling as a missing hat, tells the payer the wrong fix. K18 already says Roles " +
    "refusals are authority refusals; the ceiling is the one Roles status the frozen text calls a budget refusal. " +
    "PAYROLL_BUDGET_EXCEEDED's message now covers a spend as well as an offer or a raise.",
  source: adversarial(
    "payment.send.yaml, org.department.pay.yaml, bank.pay.yaml, inbox.pay.yaml (designed refusals, `contract`); " +
      "packages/contracts/v4/src/interfaces/IBudgets.sol:105-117; docs/as-is/payments.md (K18)",
  ),
  affects: [x.integration_bundler, v.error_PAYROLL_BUDGET_EXCEEDED, v.error_WRONG_STATE, v.error_CHILDREN_EXCEED_PARENT, v.error_AMOUNT_BELOW_USE, x.contract_budgets, x.contract_roles],
});

export const decision_components_service_keys = defineDecision({
  id: "components.service-keys",
  title: "A4's 'all signing' is the actor's; Capxul's service keys sign in the backend",
  question:
    "A4 gives the Core SDK all signing. The frozen designed text has Capxul's own keys sign some transactions: Companies " +
    "House's claim role and tier key, Budgets' executor, the escrow relayer and the faucet. Where do they sign?",
  options: [
    { label: "backend", text: "In the backend's service-signer integration: each key does one job on chain, never for a person or an agent." },
    { label: "sdk", text: "In the Core SDK, with the service keys shipped to clients." },
    { label: "none", text: "Drop every service-key transaction and have the actor's own Safe send each one." },
  ],
  chosen: "backend",
  why:
    "A4 is about the actor's authority: every flow and every signature a person or an agent gives is the SDK's, and the " +
    "backend never holds their keys (integrations.openfort). The service keys are Capxul's own, held in the operator's " +
    "store, and the designed text names them ('Companies House's claim role, held by a Capxul service key in " +
    "Infisical'; the tier key sends `Installer.deployMoney`; Budgets' executor runs a dated payment on its day). A client " +
    "cannot hold them, and the actor's own Safe cannot replace them: the claim exists because the person has no Safe yet, " +
    "and a dated payment is sent when nobody is there. Each key can do only its one job on chain, and the integration " +
    "keeps one send in flight per key (responsibilities.service-lanes).",
  source: adversarial("A4; account.retry.yaml, org.create.yaml, payment.send.yaml (designed `signs`); integration service-signer"),
  affects: [x.integration_service_signer, f.component_backend, f.component_core_sdk],
});

export const decision_contracts_test_token_mint = defineDecision({
  id: "contracts.test-token-mint",
  title: "The test tokens' open `mint` is recorded on the ERC-20 record",
  question: "`dev fund` and the welcome grant mint test money. The ERC-20 record had no `mint`. Record it?",
  options: [
    { label: "mint-on-erc20", text: "Add `mint(address,uint256)` to the ERC-20 record, for the test networks' synthetic tokens only." },
    { label: "separate-contract", text: "A separate test-token contract record." },
  ],
  chosen: "mint-on-erc20",
  why:
    "On devnet and Base Sepolia the admitted assets are Capxul's synthetic test tokens, which anyone may mint; the " +
    "faucet key calls `mint` through the service signer. It is not a Protocol v4 contract, but neither is any ERC-20, " +
    "and P9 is about the protocol, so the one ERC-20 record carries it with its test-only scope; production tokens have " +
    "no such function and production refuses `dev fund`. The accounts designer left its rpc's `chain` empty waiting for " +
    "this (accounts.faucet).",
  source: adversarial("packages/contracts/src/TestMoneyToken.sol:22; packages/protocol/src/evm/test-assets.ts:17; blueprint/accounts/decisions.ts (accounts.faucet)"),
  affects: [x.contract_erc20, f.concept_accounts],
});

export const decision_vocabulary_doctor_exit = defineDecision({
  id: "vocabulary.doctor-deadline-exit",
  title: "`doctor`'s exit 124 is the command's, not NETWORK_ERROR's",
  question: "The frozen `doctor` exits 124 with NETWORK_ERROR when its online check passes its deadline. One code has one exit (5). Which wins?",
  options: [
    { label: "command-exit", text: "NETWORK_ERROR keeps exit 5; `doctor` alone exits 124 on its own deadline, as its frozen notes and acceptance say." },
    { label: "code-exit", text: "Change NETWORK_ERROR to 124 everywhere." },
  ],
  chosen: "command-exit",
  why:
    "The 124 is the timeout convention of one command (`timeout(1)`), written into `doctor`'s notes and an acceptance " +
    "line, so it is frozen surface (P10 rung 1); every other NETWORK_ERROR exits 5 by the old exit table. Moving the " +
    "code's exit would change every other command's. The applications designer books the override on the operation.",
  source: adversarial("doctor.yaml (notes, acceptance: 'it exits 124 and keeps the SDK's failure'); apps/cli/src/commands/doctor/execute.ts:34"),
  affects: [v.error_NETWORK_ERROR, f.concept_applications],
});

// ── assembly of the concept designs (8 November 2026) ───────────────────────────────────────
// The concept designers reported what they needed from the shared records, or where the shared
// records no longer said what their designs do (docs/decisions/assembly-items.md). Each record
// settles one such item; rules.durable-processes, concepts.access, concepts.applications and
// contracts.v4-set, above, were brought up to date in place by the same pass.

const ASSEMBLY = "Claude, target assembly (shared records), 8 November 2026";
const assembly = (evidence: string) => `${ASSEMBLY}; evidence: ${evidence}`;

export const decision_concepts_no_device_flow_or_consent = defineDecision({
  id: "concepts.no-device-flow-or-consent",
  title: "Access keeps assistant grants only; applications keeps no consent",
  question:
    "Access dropped the device flow's native client grants (access.no-device-flow) and applications dropped the consent " +
    "table (applications.no-consent). The shared records still named both, a JWKS route and the MCP exchange secret. What do they say now?",
  options: [
    {
      label: "align",
      text:
        "Align them: access owns sessions, sign-in, assistant grants and gates; applications owns no consent; the backend " +
        "serves no JWKS and admits a browser origin by the bootstrap's origin token; MCP_EXCHANGE_SECRET leaves both environments.",
    },
    { label: "keep", text: "Keep the shared wording and let the concept decisions override it." },
  ],
  chosen: "align",
  why:
    "The shared records are what every designer reads first, and a map that names records no concept builds misleads " +
    "them. Both drops follow P2: no client starts a device request (the CLI keeps its v1 grant records only to delete " +
    "them), and the consent table's one writer was the device flow's accept. Access finds an opaque session or assistant " +
    "token by its hash in the request's own transaction (access.sessions, access.assistants), so nothing needs a JWKS, " +
    "and the MCP server passes the person's token through the Core SDK with no exchange. The daily client-grant sweep P3 " +
    "keeps is access' daily sweep of sessions, codes and ended assistant grants. The origin token is applications.origin-token's.",
  source: assembly(
    "blueprint/access/decisions.ts (access.no-device-flow, access.sessions, access.assistants); applications.no-consent, applications.origin-token; apps/cli/src/auth/native-grant-cleanup.ts:5",
  ),
  affects: [
    f.concept_access, f.concept_applications, f.component_backend, f.component_mcp_server, f.environment_devnet,
    f.environment_staging,
  ],
});

export const decision_rules_transaction_width = defineDecision({
  id: "rules.transaction-width",
  title: "sys:tx-width counts the procedures an rpc invokes itself",
  question:
    "P4's sys:tx-width allows at most 3 procedures from at most 2 other concepts in one transaction. Does a procedure a " +
    "door invokes inside itself (board.propose opening approvals.open) count against the rpc that invoked the door?",
  options: [
    {
      label: "direct",
      text:
        "Count what one run of the rpc or workflow invokes itself; where its branches invoke different doors (approvals.open " +
        "for a person, board.propose for an Organization), its widest branch. A procedure's own invocations count against " +
        "that procedure, held to the same limit. A wider transaction needs the invoking concept's decision record.",
    },
    { label: "nested", text: "Count every procedure the transaction runs, nested ones included." },
  ],
  chosen: "direct",
  why:
    "The rule bounds what one concept couples into its transaction, and an invoker cannot change what a door does inside: " +
    "board.propose always opens its first approval. Counting that against every proposer (budgets, payroll, payments, " +
    "agents, equity) would push each to split one money fact over two transactions, which P4 exists to prevent. The door " +
    "is bounded on its own (board.propose: one procedure of one concept). An rpc's `invokes` lists every branch's doors, " +
    "so agents' create and sweep list three concepts but run two (agents.transaction-width). P4 allows a wider one with " +
    "a decision record: payments.birth-width is that record for payments' prepare and propose (parties, documents, and " +
    "approvals or board). Equity's Board-matter prepares are within the rule.",
  source: assembly("docs/decisions/policy-pack.md (P4: sys:tx-width, 'a wider one needs a decision record'); agents.transaction-width; payments.birth-width; parties.resolve-recipient"),
  affects: [f.concept_payments, f.concept_agents, f.concept_board, f.concept_approvals],
});

export const decision_rules_process_wakeups = defineDecision({
  id: "rules.process-wakeups",
  title: "The runtime wakes a waiting process by the key its event carries",
  question:
    "Approvals waits for Ponder's UserOperationEvent at (chain, sender, nonce) and for its opener's withdrawal; payments, " +
    "budgets, payroll and equity wait on approval_transitioned and proposal_transitioned. What delivers an event to the " +
    "one instance waiting for it?",
  options: [
    {
      label: "runtime-key",
      text:
        "The runtime. A transition's outbox event wakes each instance whose wait names it and whose key its props carry " +
        "(the opener and subject on approval_transitioned and proposal_transitioned); an indexed chain event wakes one by " +
        "the key Ponder's row carries (chain, sender, nonce; a payment id). The book names the wait and, in its `key`, what " +
        "wakes it and by which properties.",
    },
    { label: "reactor", text: "One reacting workflow per event finds the waiting instance by a table read and signals it." },
    { label: "poll", text: "Each waiting instance polls the tables it waits on." },
  ],
  chosen: "runtime-key",
  why:
    "A3 makes each long-lived object one process that owns its machine, and a wait is its own span, never system time. " +
    "A reactor per event would add a workflow for every wait, and a poll spends system time and lags by its interval. " +
    "Effect Workflow resumes an instance through a durable deferred it can address, so the runtime keeps the map from an " +
    "event's key to that address, fed by the outbox relay and by Ponder's progress (integration indexer). The A2 spike " +
    "must prove both, including a transition a procedure writes in another concept's transaction (approvals.withdraw). " +
    "The key is now a field of the wait (rules.admissions-and-wait-keys): each entry names its carriers (an event, a " +
    "chain event, Ponder's row, a signal, or the instance's own call) and the properties they carry, the build checks " +
    "each property against the carrier, and `wfl:<workflow>/wake/<wait>` is the eval the runtime must pass.",
  source: assembly("A2, A3; blueprint/approvals/processes.ts (by-sender-nonce wait); payments.carrier-waits; budgets.one-process-per-change; approvals' and payments' assembly items"),
  affects: [f.component_backend, x.integration_indexer, f.concept_approvals, f.concept_payments],
});

export const decision_rules_global_tenancy = defineDecision({
  id: "rules.global-tenancy",
  title: "A global table has no tenant and is written only through its own concept",
  question:
    "CONVENTIONS said a `global` table is written only by the system (prices, flags). Parties' directory is `global` but " +
    "written through parties' procedures and rpcs at a person's or an Organization's request (parties.directory-tenancy). Which holds?",
  options: [
    {
      label: "owning-concept",
      text:
        "`global`: no tenant column; every row may be read by every tenant and holds nothing private; written only by the " +
        "owning concept's own procedures, rpcs and workflows, never directly by a tenant. Prices, flags and the directory of Parties.",
    },
    { label: "system-only", text: "Only the system writes a global table; the directory needs another tenancy." },
  ],
  chosen: "owning-concept",
  why:
    "Row-level security keeps a tenant's rows from other tenants; a global row belongs to none, so what matters is who " +
    "writes it and that nothing private is in it. Every target write goes through its concept's records anyway (P4), so " +
    "'only the system' and 'only the owning concept' differ only in whether a caller's request may cause the write. The " +
    "directory's tenancy stays flagged for Aaron's data-model review (W1) in parties.directory-tenancy; this record only " +
    "stops the conventions contradicting it.",
  source: assembly("blueprint/parties/decisions.ts (parties.directory-tenancy); P8; blueprint/CONVENTIONS.md rule 3"),
  affects: [f.concept_parties, f.component_postgres],
});

export const decision_vocabulary_declined_preview = defineDecision({
  id: "vocabulary.declined-preview-cancelled",
  title: "Declining a terminal preview ends CANCELLED in every command",
  question:
    "The frozen pages say a declined preview writes nothing, not what it exits with. The old CLI answered CLI_USAGE " +
    "(exit 2); contacts answers CANCELLED (exit 130, contacts.decline-is-cancelled). One rule for every command?",
  options: [
    {
      label: "cancelled",
      text:
        "A 'no' to a terminal preview ends CANCELLED (exit 130) and writes nothing, in every command; a script without " +
        "`--confirm` stays CLI_USAGE, as the frozen mistakes say.",
    },
    { label: "per-concept", text: "Each concept chooses." },
    { label: "usage", text: "CLI_USAGE, as the old `confirmWrite` did." },
  ],
  chosen: "cancelled",
  why:
    "The frozen book is silent (P10 rung 5: the code is evidence), and one CLI must answer one way. A 'no' is the " +
    "person's choice, not a usage mistake, and CANCELLED already says the command stopped before it finished and nothing " +
    "was sent, as a declined approval ends (vocabulary.drop-signer-rejected). Scripts pass `--confirm` and never see the " +
    "question, so no script's exit changes. A command whose approval page is its confirmation refuses `--confirm` and has " +
    "no terminal question to decline.",
  source: assembly("blueprint/contacts/decisions.ts (contacts.decline-is-cancelled); apps/cli/src/commands/org/internal/write.ts:57; frozen contact.add, request.issue, service.create acceptance"),
  affects: [v.error_CANCELLED, v.error_CLI_USAGE, f.component_cli],
});

export const decision_integrations_chain_rpc_live_reads = defineDecision({
  id: "integrations.chain-rpc-live-reads",
  title: "chain-rpc serves every read of the chain as it is now",
  question:
    "chain-rpc's about limited it to reads before a write, an agent's sign-in and the token scan. Notices reads a company " +
    "Safe's owners and live figures when it sends (notices.chain-reads); payroll, budgets and equity read live views for a show. Within it?",
  options: [
    {
      label: "live",
      text:
        "Yes: any view whose answer is the chain's state now, which Ponder holds late or not at all, read when a concept " +
        "needs it as of now: before a write, for a show a person waits on, or when a notice is sent.",
    },
    { label: "pre-write-only", text: "Keep chain-rpc to reads before a write; every other read through indexing's views." },
  ],
  chosen: "live",
  why:
    "A fact that happened is Ponder's, read through indexing's views; state as of now (a budget's left, what an agreement " +
    "has released, a balance, a Safe's owners) is a view call, which is what chain-rpc answers within its node-read " +
    "timeout and p95. Notices has no indexing edge and should not gain one for a recipient list (dependencies.notices-top). " +
    "What stays: chain-rpc never replaces an indexed fact (a settlement, a claim) and scans history only for books' " +
    "added-token window.",
  source: assembly("blueprint/notices/decisions.ts (notices.chain-reads, notices.recipients); payroll.live-reads; budgets.chain-is-the-record; the chain-rpc callers in blueprint"),
  affects: [x.integration_chain_rpc, f.concept_notices],
});

export const decision_integrations_bridge_bank_details_read = defineDecision({
  id: "integrations.bridge-bank-details-read",
  title: "Bridge gains a read of one virtual account; no payout cancel, no remove",
  question:
    "Bridge had no read of one virtual account, so banking rewrote `bank settle` #1-#4 and could not keep 'It writes " +
    "nothing to Bridge when Bridge's answer is unusable'. It has no cancel for an unfunded transfer, and a remove nothing calls. Change which?",
  options: [
    {
      label: "read",
      text:
        "Add `readBankDetails` (one virtual account: status, deposit token, details), as the old client's readVirtualAccount; " +
        "add no cancel; drop `removeBankAccount`.",
    },
    { label: "read-and-cancel", text: "Add the read and a `cancelPayout` for an unfunded transfer." },
    { label: "none", text: "Add neither, and keep banking's rewrites." },
  ],
  chosen: "read",
  why:
    "A frozen claim is never weakened: `bank settle` #4 is an outcome a black box sees (the Bridge fake records no update " +
    "when the first answer is unusable), and without a read the target can only promise less. The old settle read the " +
    "account, checked it, wrote, then read it back (settle.ts:39-46); the read has the shape of getVerification and takes " +
    "the same numbers and failures. A cancel is not needed: no frozen line asks for one, an unfunded transfer lapses at " +
    "Bridge, and `bank pay`'s 'nothing is sent' for a changed account is kept by withdrawing the unsigned approval " +
    "(banking now depends on approvals), not by a call to Bridge. `removeBankAccount` goes: the old client never deleted " +
    "an external account at Bridge, and removing a saved account calls Bridge no more than it did (banking.not-ported).",
  source: assembly("packages/backend/src/banking/bank-details/external.ts:34, 154; bank-details/operations/settle.ts:39-46; integrations/bridge/service.ts (no delete); frozen bank.settle, bank.pay; banking.not-ported"),
  affects: [x.integration_bridge, f.concept_banking],
});

export const decision_contracts_hats_view_hat = defineDecision({
  id: "contracts.hats-view-hat",
  title: "Hats' `viewHat` is recorded; `getNextId` is not",
  question:
    "Budgets plans a new hat's id from indexing's hats, which can lag the chain (budgets.hat-planning). Record " +
    "`Hats.getNextId` or `viewHat` so the plan reads the chain now?",
  options: [
    { label: "view-hat", text: "Record `viewHat`, which v4's IHats declares: a hat's supply, modules, `lastHatId` and whether it is active." },
    { label: "get-next-id", text: "Record `getNextId(admin)` from the deployed Hats contract." },
    { label: "none", text: "Record neither; plan from indexing alone." },
  ],
  chosen: "view-hat",
  why:
    "The contract records hold what v4 calls (contracts.v4-set): v4's IHats lists viewHat and not getNextId, and the " +
    "Installer itself reads viewHat. The next child's id is the admin's id with `lastHatId + 1` at the child's level, so " +
    "viewHat at the chain head gives what getNextId would. Neither closes the race the budgets designer names (a hat made " +
    "under the same admin between proposal and execution); v4 has no guard, and budgets applies a change only on its " +
    "indexed effect with the planned hat (budgets.one-process-per-change), so a shifted id never reads as applied.",
  source: assembly("packages/contracts/v4/src/interfaces/external/IHats.sol:111; authority/InstallerElections.sol:24; blueprint/budgets/decisions.ts (budgets.hat-planning)"),
  affects: [x.contract_hats, f.concept_budgets],
});

// ── target assembly (builder) ───────────────────────────────────────────────────────────────

const builder = (evidence: string) => `Claude, target assembly (builder), 8 November 2026; evidence: ${evidence}`;

export const decision_rules_surfaces_and_wait_events = defineDecision({
  id: "rules.surfaces-and-wait-events",
  title: "Flows name their surfaces; waits name the chain events that end them",
  question:
    "Three groups asked for the schema to say what the book could only say in prose: twelve flows serve the approval " +
    "page, checkout, the web app or an agent's SDK host and read as `unused-flow`, and a process that waits on a chain " +
    "event cannot link it, so sixty chain events read as `unconsumed-chain-event` (A3 makes a process wait on its " +
    "events, not be triggered by them). Change packages/blueprint-engine, or leave the gaps?",
  options: [
    {
      label: "two-optional-fields",
      text:
        "FlowSpec gains `surfaces` (the system's surfaces: cli, sdk, react, mcp, http); a flow whose surfaces leave out " +
        "cli is not an unused-flow, and a target flow that implements an operation must keep cli (rule flow-surface). A " +
        "workflow wait gains `events` (chain events), a link the gap counts. Both are optional, so the as-is and frozen " +
        "books are unchanged.",
    },
    { label: "leave", text: "Leave the gaps and explain each in its concept's decisions." },
    { label: "trigger-per-event", text: "A workflow triggered by each chain event, beside each process." },
  ],
  chosen: "two-optional-fields",
  why:
    "A gap should mean something is missing; these were the schema's blind spots, and 72 real gaps were hidden among " +
    "130. A workflow per event would split an object's one writer (A3, rules.durable-processes). `surfaces` reuses the " +
    "system's vocabulary, and flow-surface keeps it from hiding a CLI flow. A wait's `events` are the logs the process " +
    "reads at finality, so the remaining unconsumed events are ones only indexing's views read or nothing uses. The " +
    "routing key was left to the wait's `about` (rules.process-wakeups); rules.admissions-and-wait-keys later made it " +
    "the wait's `key`. Tests in packages/blueprint-engine/test/build.test.ts cover both.",
  source: builder("packages/blueprint-engine/src/records/behaviour.ts (FlowSpec, Wait); packages/blueprint-engine/src/build.ts (unused-flow, unconsumed-chain-event, flow-surface); approvals', identity's, rails' and shared's assembly asks"),
  affects: [f.component_core_sdk, f.component_ponder, x.integration_indexer],
});

export const decision_rules_admissions_and_wait_keys = defineDecision({
  id: "rules.admissions-and-wait-keys",
  title: "Row admissions and wait keys are fields, not prose",
  question:
    "The build session's generators (B1) make each table's row-level policy and the runtime's map from a waking event to " +
    "the instance waiting for it. Both lived only in prose: a table's scope or about said that a payee, an addressed " +
    "payer, a holder by their Safe or anyone also reads it (payments, requests, documents, media, agents, banking, " +
    "equity, payroll and every chain view), and a wait's about named its key (rules.process-wakeups). Give them fields, " +
    "and how does a missing one show?",
  options: [
    {
      label: "fields",
      text:
        "TableSpec gains `admits`: one entry per policy clause, with how the session is matched (`tenant`; `safe`, through " +
        "parties' directory; `own-safe`; `email`; `anyone`), the column or a one-hop join (`via` a table and its column), " +
        "the rows (`where`), and whether it reads and writes. A wait gains `key`: one entry per way it is woken, its " +
        "carriers (a product event, a chain event, a table's row, a signal rpc or the instance's own call) and the " +
        "properties they carry (`reaches` for Ponder's progress passing a block). Both optional. Rules `admission` and " +
        "`wait-key` check them wherever present; in a target book `chain-admits` and `wait-without-key` require them; the " +
        "gap `admission-in-prose` shows a target table whose prose admits someone with no `admits`. Each clause and each " +
        "key yields an eval: `tbl:<table>/admits/<n>`, `wfl:<workflow>/wake/<wait>`.",
    },
    { label: "prose", text: "Keep the prose: B1 reads it, or writes each policy and route by hand." },
    { label: "all-gaps", text: "The fields, with every missing one a gap." },
    { label: "all-problems", text: "The fields, with admission prose and no `admits` a problem too." },
  ],
  chosen: "fields",
  why:
    "A policy the generator cannot see refuses a legitimate reader, or, written by hand, admits too much; a route " +
    "written by hand is the reactor rules.process-wakeups rejected. As fields both are checked on every build and each " +
    "becomes an eval, so B2 proves every clause and B0 the routing. A wait without a key is found by structure alone and " +
    "leaves the generator nothing to emit, so in a target book it is a problem; a timer is the instance's own and takes " +
    "none. Admission prose is found only by reading words (ADMISSION_PROSE in packages/blueprint-engine/src/build.ts), which can be " +
    "wrong either way, so it is a gap: visible, never why the book fails to build. A chain table's scope always is its " +
    "policy, so its admissions are a rule. The matchers are the book's own: `safe` is P8's chain-read scope " +
    "(indexing.scope-by-parties), which requests.owner-tenancy, payroll.payee-reads and equity.holder-reads name; " +
    "`own-safe` is documents.tenancy's principal's own Safe or a Seat's company Safe, and an agent's own row " +
    "(agents.who-acts). `writes` is what each concept's decision grants and no more: requests' pay and decline and " +
    "equity's holder writes are their rpcs' work, not a policy's. A key reaches several instances only where the design " +
    "means it: every approval on one nonce, every Payment of one command, every instance whose block Ponder's progress " +
    "passed. A cross-tenant index stays one named query, not a clause (organizations' offers, accounts' referee). Review " +
    "tightened both rules: a clause must read or write, `anyone` never writes, and a `where` value must be one its column " +
    "can hold, or the clause admits no row; a signal routes by its instance's own columns only when it reads or writes " +
    "the instance's table, the row it resolves them from. Each clause's eval allows for the tenant and the other clauses.",
  source: builder("packages/blueprint-engine/src/records/data.ts (Admission), records/behaviour.ts (WaitKey), build.ts, evals.ts; the cold read of B1's inputs"),
  affects: [
    decision_rules_process_wakeups,
    f.component_postgres,
    f.component_backend,
    x.integration_indexer,
    f.concept_indexing,
    f.concept_payments,
    f.concept_requests,
    f.concept_documents,
    f.concept_media,
    f.concept_agents,
    f.concept_banking,
  ],
});

// ── size ────────────────────────────────────────────────────────────────────────────────────

const HANDOFF = "Claude, handoff to the build, 8 November 2026";

export const decision_system_size = defineDecision({
  id: "system.size",
  title: "The rebuild's hand-written code is at most a quarter of the old system's",
  question:
    "The rebuild is meant to need much less code, and lines of code are on the scoreboard. How much hand-written product code " +
    "may the target have, and when does each concept get its own line budget (sys:loc/<concept>)?",
  options: [
    {
      label: "quarter-then-measured",
      text:
        "At most 100,000 hand-written, non-test, non-generated lines across the backend, Core SDK, CLI, React SDK, MCP server, " +
        "indexer and devnet: a quarter of the old system's 400,000 or so. The build session sets each concept's lines (the " +
        "concept record's budget, checked by sys:loc) after the pilots (B3), from the lines per operation they measure, and " +
        "records it here.",
    },
    { label: "per-concept-now", text: "Set every concept's line budget now, from the old areas each absorbs." },
    { label: "no-budget", text: "Report lines on the scoreboard and set no budget." },
  ],
  chosen: "quarter-then-measured",
  why:
    "Measured on integration/factory (8 November 2026), the old product code is about 400,000 non-test lines: backend 184,000, Core SDK 59,000, protocol 55,000, CLI 48,000, devnet 22,000, React SDK 9,600, observability 9,400, indexer 4,600, MCP 4,400, AA gateway 2,900. Much of it goes: pre-v4 paths (P9), schemas, routers, clients, CLI wiring and telemetry that are now generated from the records, and duplicate event and status plumbing (P7). What is left to write by hand is the body of each rpc, flow step and workflow step, about 215 operations at 150 to 300 lines, plus a runtime spine of some 15,000 and a devnet of some 10,000: 60,000 to 100,000. A per-concept number set now would be a guess from the old areas, which are what is being cut; the pilots measure the real ratio first. With no budget, size is not hill-climbable. Review, 11 November 2026: Confirmed system.size; original choice retained.",
  source: `${HANDOFF}; evidence: git ls-files of /home/user/factory (integration/factory), .ts and .tsx without tests, fixtures, .d.ts or generated files`,
  affects: [f.system_capxul, f.component_backend, f.component_core_sdk, f.component_cli, f.component_react_sdk, f.component_mcp_server, f.component_devnet],
});

export const decision_system_layout = defineDecision({
  id: "system.layout",
  title: "Product code mirrors the book: one package per component, one folder per concept",
  question:
    "The book says what to build but not where the code goes. Where do the product packages, the generated files, the B0 spike " +
    "and each concept's code live, how is generated code told apart from hand-written code, and which branch integrates the lanes?",
  options: [
    {
      label: "mirror-the-book",
      text:
        "pnpm workspaces in this repository (tooling.package-manager). One package per component: packages/runtime (the Effect services: auth, SQL, chain, " +
        "integrations, the workflow engine, tracing), packages/backend, packages/sdk (the Core SDK), packages/cli, packages/sdk-react, " +
        "packages/mcp, packages/indexer (Ponder), packages/devnet, packages/contracts (the v4 Solidity at a pinned commit with " +
        "the general escrow, payments.escrow-contract-build), plus packages/generate (the generators) and packages/evals (the " +
        "harness). In the backend and the SDK, src/<concept>/ mirrors blueprint/<concept>/, and another concept's code is " +
        "imported only from its src/<concept>/door.ts (sys:imports). Generated files live in each package's src/generated/, each " +
        "headed 'Generated from blueprint by packages/generate. Do not edit.', and line counts leave that folder out. The B0 " +
        "spike is spikes/durable-execution/, deleted once its decision is recorded. Lanes are branches lane/<concept> merged by pull " +
        "request into integration/build; integration/build merges into main at each milestone's exit.",
    },
    { label: "by-layer", text: "Packages by technical layer (db, api, services), concepts spread across them." },
    { label: "old-layout", text: "Keep the old repository's package names and folder habits." },
  ],
  chosen: "mirror-the-book",
  why:
    "A record and its code then share a name and a place, so an agent finds one from the other without a map, and the evals that " +
    "need a layout have one: sys:imports reads src/<concept>/ imports, sys:loc counts each concept's folder, system.size counts " +
    "everything outside src/generated/, and sys:generated regenerates src/generated/ and diffs it. By layer spreads a concept over " +
    "four places, which is what made the old system hard to change; the old layout carries its pre-v4 packages (protocol, " +
    "aa-gateway, scenarios) that P9 removes. One integration branch keeps main green while lanes land.",
  source: `${HANDOFF}; evidence: the cold-start review of the handoff (no layout or integration branch named); old repository layout`,
  affects: [f.system_capxul, f.component_backend, f.component_core_sdk, f.component_cli, f.component_react_sdk, f.component_mcp_server, f.component_devnet, f.component_ponder],
});

export const decision_system_repository_layout = defineDecision({
  id: "system.repository-layout",
  title: "A closed top level: scripts in their packages, dead material in archive/",
  question:
    "The owner opened the repository on 10 November 2026 and could not find his way: loop runs at the top level, twenty loose " +
    "scripts and thirty-one old workflow scripts in tools/, hand-overs and a mock-up beside the code. Where does each kind of " +
    "thing go, and what keeps it there?",
  options: [
    {
      label: "closed-top-level",
      text:
        "The top level holds only what packages/layout/src/main.ts allows, each entry with a reason. A script lives in the package " +
        "it serves: the plan CLI and the task tree in packages/plan, the frozen check, the cut report, the surface report, the " +
        "judgments report and impact in packages/blueprint-engine/scripts, the status writer in packages/evals, the contract check and the ABI " +
        "export in packages/contracts/abi-check, the layout check in packages/layout. Dead material moves to archive/ at its old " +
        "path, so an older citation resolves by putting archive/ in front of it. Working data (loop runs) goes under the " +
        "git-ignored var/. pnpm layout, part of pnpm test, fails on a new top-level entry, a new source file over 300 lines, a " +
        "recorded oversize file that grew, or a directory or package without a README. The pnpm script names do not change.",
    },
    { label: "keep-tools", text: "Keep tools/ and add a README that explains each script." },
    { label: "delete-dead", text: "Delete the dead material instead of archiving it; git history keeps it." },
  ],
  chosen: "closed-top-level",
  why:
    "A README over tools/ explains the mess and leaves it: the next script lands there again, and the plan, the checks and the " +
    "contracts each stay split between a package and a loose file. Deleting loses what records cite as evidence (the hand-over, " +
    "the goal prompt, the generators of the frozen book) unless a reader knows to search history; an archive at the same path " +
    "keeps every citation one prefix away. A check is what keeps a layout: without it the top level drifts back within days, " +
    "as it did between 6 and 10 November.",
  source: "The coordinator's tidy thread, 10 November 2026, on the owner's request; evidence: docs/repository-map.md; archive/README.md; packages/layout/README.md",
  affects: [f.system_capxul],
});

export const decision_system_build_order = defineDecision({
  id: "system.build-order",
  title: "Concepts are built in dependency layers; priority orders the work within each",
  question:
    "Board is low priority, yet budgets, payments, payroll, agents, equity and notices depend on it. In what order are the concepts built, so that no lane waits on a concept below it?",
  options: [
  {
    "label": "current-scope",
    "text": "The coordinator authors build order and critical path in plan/plan.json. Dependencies still constrain imports and doors must exist before their callers, but the old layer list and equity-last scheduling are not an automatic scheduler. The plan and loop, not swarmD stages, coordinate work."
  },
  {
    "label": "historical",
    "text": "The former answer to system.build-order is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: The coordinator authors build order and critical path in plan/plan.json. Dependencies still constrain imports and doors must exist before their callers, but the old layer list and equity-last scheduling are not an automatic scheduler. The plan and loop, not swarmD stages, coordinate work. Authority: cut.principle; aaron.one-door; sites.door; portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; cut.principle; aaron.one-door; sites.door; portal.plan-page",
  affects: [f.system_capxul, f.concept_board, f.concept_notices],
});

// ── the frozen flags (8 November 2026) ──────────────────────────────────────────────────────

const flagsBy = (evidence: string) => `Claude, frozen flags, 8 November 2026; evidence: ${evidence}`;

export const decision_rules_frozen_flags_source = defineDecision({
  id: "rules.frozen-flags-source",
  title: "The frozen flags are read from the old CLI's own grammar",
  question:
    "Where does blueprint/baseline/flags.ts take each frozen command's arguments and flags from, so that it keeps the old CLI's " +
    "words and invents nothing?",
  options: [
    {
      label: "source",
      text:
        "archive/tools/freeze-flags.ts parses apps/cli/src with the TypeScript compiler API and evaluates only the Effect CLI grammar " +
        "(Command.make, Flag.*, Argument.*, GlobalFlag.Setting), following constants and flag helpers across imports into the " +
        "old packages. It never runs a handler, and it stops on any name, help text, choice or default it cannot work out.",
    },
    { label: "run-schema", text: "Run the old CLI's `capxul schema <command> --json` for every command." },
    {
      label: "docs-pages",
      text: "Parse the old docs site's CLI reference (apps/docs/content/docs/reference/cli), which `capxul schema` generated.",
    },
  ],
  chosen: "source",
  why:
    "`capxul schema` is the CLI's own manifest, but running it needs the old workspace installed (Effect 4.0.0, @capxul/sdk " +
    "and their dependencies) and runs the old code; the checkout has no node_modules. The docs pages lose what the frozen " +
    "surface needs: they capitalise each help text and end it with a period, escape Markdown, and drop types, defaults and " +
    "repeats. Read from source, the grammar agrees with the docs pages on all 192 commands the old CLI has (names, order, " +
    "required, and help text once the docs formatting is undone), and the six global flags it declares agree with its " +
    "recorded `capxul schema` output. Two runs write the same file byte for byte.",
  source: flagsBy("apps/cli/src/command.ts; runtime/format.ts; commands/schema/internal/describe.ts; apps/docs/content/docs/reference/cli"),
  affects: [f.component_cli],
});

export const decision_rules_frozen_flags_built_ins = defineDecision({
  id: "rules.frozen-flags-built-ins",
  title: "Effect's built-in global flags are recorded as the old CLI printed them",
  question:
    "--help (-h), --version (-v), --wizard, --completions and --log-level come from the Effect library, not from the old " +
    "CLI's source. Are they frozen, and in whose words?",
  options: [
    {
      label: "printed",
      text:
        "Recorded, as the newest recorded `capxul schema … --json` result printed them (apps/docs/factory/proofs): name, " +
        "alias, printed type, required and help text.",
    },
    { label: "library", text: "Recorded, from Effect's GlobalFlag source in this repository's node_modules." },
    { label: "omit", text: "Not recorded: only the flags the CLI declares itself." },
  ],
  chosen: "printed",
  why:
    "A person types them and the old docs list them among the global flags, so the reference must hold them; under " +
    "system.frozen-behaviour they are reference for the target CLI's own global flags, not surface. This " +
    "repository has Effect 4.1.2, whose --completions also offers powershell and pwsh; the old CLI pinned 4.0.0 and printed " +
    "<bash|zsh|fish|sh>, so the library source is not the old words. The 38 recorded results all agree. The old CLI drops " +
    "--wizard outside an interactive terminal (runtime/entry.ts); that is behaviour, not grammar.",
  source: flagsBy("apps/docs/factory/proofs (38 `capxul schema` results); apps/cli/src/runtime/entry.ts:192; node_modules/effect/src/cli/GlobalFlag.ts"),
  affects: [f.component_cli],
});

export const decision_rules_frozen_flags_kept = defineDecision({
  id: "rules.frozen-flags-kept",
  title: "The old flags are reference for the target's flags, not surface to keep",
  question:
    "In 66 of the 75 designed operations the old CLI has, the designed (v4) text leaves out 189 flags the CLI declares, most " +
    "often --email, --timeout-seconds and --no-wait. The designed text also lists 58 flags for 25 commands that the old CLI " +
    "never declared (each on the command its synopsis part or table row names: rules.frozen-flags-designed-attribution), " +
    "and 23 frozen commands the old CLI never had at all. What do blueprint/baseline/flags.ts and the designed flags bind?",
  options: [
    {
      label: "reference",
      text:
        "Nothing: they are reference. flags.ts records both, the CLI's own and the designed ones the CLI lacks " +
        "(`designedNotInCli`, with `inCli: false` on the 23 commands), without inventing a type or help text. B1 designs each " +
        "operation's flags in the book as one consistent system and may keep, rename, merge or drop any old flag; a dropped " +
        "flag needs no decision, but an acceptance claim that depends on a flag's behaviour keeps that behaviour.",
    },
    {
      label: "union",
      text:
        "Both kinds are frozen surface: every flag the old CLI declares and every flag the designed block lists, and dropping " +
        "one needs a decision on its operation.",
    },
    { label: "cli-only", text: "Only what the old CLI declares is kept; designed flags nothing built are not." },
  ],
  chosen: "reference",
  why:
    "First recorded as union under P10 rung 1, which made flags surface. Aaron's system.frozen-behaviour (8 November 2026) " +
    "frees the spelling: the 215 operations and what their acceptance claims require are kept, and the flags are the target's " +
    "to design. The extraction still earns its keep: it is the one complete list of what the old commands took, so B1's " +
    "design sees every input an old caller could pass, and the designed-only flags show what v4 meant to add.",
  source: flagsBy("blueprint/baseline/flags.ts (designedNotInCli, inCli); blueprint/baseline/operations.ts (designed flags and synopses); system.frozen-behaviour"),
  affects: [f.component_cli],
});

export const decision_rules_frozen_flags_unlisted = defineDecision({
  id: "rules.frozen-flags-unlisted",
  title: "The old CLI's 21 unlisted commands are not frozen",
  question:
    "The old CLI has 21 command paths that no frozen page names, all hidden from --help: bare `capxul` (home), `invite " +
    "get|review|wait`, `org invite get|wait|retry`, `org allowance command get|wait`, the ten `org payroll` paths and `org " +
    "proposal create`. Does flags.ts freeze them?",
  options: [
    {
      label: "not-frozen",
      text:
        "No. They are recovery and unfinished commands the old book never made operations. flags.ts covers the 215 frozen " +
        "commands only, and the target adds such a command only through an operation record.",
    },
    { label: "frozen", text: "Freeze them too, with their flags." },
  ],
  chosen: "not-frozen",
  why:
    "The frozen surface is the 215 operations (P10), and P2 deletes what nothing reaches. No frozen page or acceptance line " +
    "needs one of them: `schema` #4 uses `schema org.payroll.run` as its example, but it still holds when neither spelling " +
    "names a command, since both are refused alike with CLI_USAGE; its eval should use a frozen command. No frozen operation " +
    "describes bare `capxul`, so what it prints is the target CLI's own design.",
  source: flagsBy("archive/tools/freeze-flags.ts (cli-not-frozen); apps/cli/src/commands/home/command.ts; blueprint/baseline/operations.ts (schema #4)"),
  affects: [f.component_cli],
});

export const decision_rules_frozen_flags_designed_attribution = defineDecision({
  id: "rules.frozen-flags-designed-attribution",
  title: "A designed flag belongs to the command its synopsis part or table row names",
  question:
    "One frozen page's designed (v4) block often describes its whole command family. `org round create`'s synopsis is " +
    "`capxul org round preview|create --class … · invite <round> --investor --amount · show <round>`; `org vote list`'s " +
    "flags table lists `--until` \"For `wait`\"; `org agreement change`'s lists `--last-day` \"For `end`\". `org vote " +
    "create`'s table keys each row by a matter and puts that matter's flags (`--name --converts-to …`) in the meaning " +
    "cell. On which frozen command does flags.ts list each designed flag?",
  options: [
    {
      label: "named",
      text:
        "On the frozen command its part or row names: a part names its command in full after `capxul` (or an operator " +
        "script), or by its last words under the page's family, and `a|b` names both; a row naming \"For `x`\" is for x, " +
        "and also limits the page's synopsis for that flag to x. When no part names the page, the first part is the " +
        "page's own v4 spelling. A row keyed by an argument's value lists the flags in its meaning cell for the page. " +
        "flags.ts names the other page in `designedNotInCliOnPage`.",
    },
    {
      label: "page",
      text:
        "On the page's own command only, the whole synopsis when no part names it (what the first freeze did): `org " +
        "round create` then lists `--investor --amount`, and `org round invite`, `org round preview` and `org safe " +
        "invite` list nothing.",
    },
  ],
  chosen: "named",
  why:
    "flags.ts is the reference the target designs its flags from (system.frozen-behaviour), so it has to say which " +
    "command each designed flag was for. The page form put flags on the wrong commands and lost others. It gave `org vote list` the `--until` that the old " +
    "CLI declares on `org vote wait`, gave `org agreement change` the `--last-day` designed for `end` (whose CLI flag is " +
    "`--on`), gave `org round create` the invite's `--investor --amount`, and left `org round preview`, `org round " +
    "invite` and `org safe invite`, which the old CLI never had, with no flags at all, though their only grammar is in " +
    "these synopses. It also missed the 15 matter flags of `org vote create` beyond `--class --authorised`. Named, the " +
    "designed text lists 58 flags for 25 commands that the old CLI does not declare. One part names no frozen command " +
    "(`invites void --referee` on `waitlist invites grant`, an operator script); the generator reports it and keeps it " +
    "nowhere.",
  source: flagsBy("blueprint/baseline/operations.ts (designed synopsis and flags of org.round.create, org.safe.create, org.vote.list, org.agreement.change, org.vote.create, org.department.ceiling.set); archive/tools/freeze-flags.ts"),
  affects: [f.component_cli],
});

export const decision_rules_frozen_flags_boolean_forms = defineDecision({
  id: "rules.frozen-flags-boolean-forms",
  title: "The old CLI's boolean spellings are recorded once in flags.ts",
  question:
    "Effect 4.0.0, which the old CLI pinned, parses any boolean flag in four spellings: `--x`, `--x false`, `--x=no` " +
    "and `--no-x`, where a following word counts only when it is true, yes, on, 1, y, false, no, off, 0 or n. No CLI " +
    "source declares them, and the printed help shows none. The old CLI's tests use them (`--json false`, `--json=no`, " +
    "`--no-json`), and runtime/format.ts reads `--no-json` itself. Does blueprint/baseline/flags.ts record them, and where?",
  options: [
    {
      label: "once",
      text:
        "Recorded once as `booleanForms` in blueprint/baseline/flags.ts beside the global flags. The generator stops if the " +
        "old test that uses them is gone. Each boolean flag keeps `takesValue: false`: it needs no value.",
    },
    { label: "per-flag", text: "Recorded as a `negation` field and an optional value on each of the boolean flags." },
    { label: "omit", text: "Not recorded: library behaviour, as `--wizard` outside a terminal is (rules.frozen-flags-built-ins)." },
  ],
  chosen: "once",
  why:
    "flags.ts is the reference the target designs its flags from, not surface to keep (system.frozen-behaviour). As " +
    "reference it must describe the old grammar truly, and without this a boolean flag reads as taking no value, though " +
    "the old CLI's own tests pass it one. The forms are the same for every boolean flag, so once is exact. The target " +
    "decides its own spellings; Effect 4.1.2 gives the same four by default. One edge for its designer: a word after a " +
    "boolean flag that is one of those words is taken as its value, so the old `org director threshold --confirm 1` " +
    "reads 1 as --confirm's value, not as <n>.",
  source: flagsBy("effect@4.0.0 dist/cli/internal/parser.js (resolveFlag, consumeFlagValueWithTokens); apps/cli/src/runtime/tests/entry.test.ts:913; apps/cli/src/runtime/format.ts:86"),
  affects: [f.component_cli],
});

// ── the surface: Aaron's decision ───────────────────────────────────────────────────────────

export const decision_system_frozen_behaviour = defineDecision({
  id: "system.frozen-behaviour",
  title: "The freeze keeps behaviour; each old operation is booked or classified",
  question:
    "The old book's 215 operations were frozen word for word: commands, flags, `--json` shapes, refusal codes and text, with P10 " +
    "making the frozen text win wherever it disagreed with the code. Does the rebuild keep that spelling, or only what it does? " +
    "And since 10 November 2026, when Frappe owns accounts, payroll, HR, CRM and projects, must every one of the 215 stay booked?",
  options: [
    {
      label: "behaviour",
      text:
        "Keep the behaviour, free the spelling. The 215 operations are the list of capabilities, and what each acceptance claim " +
        "requires to happen stays as its evals: that is the hill. The exact flags, `--json` shapes, refusal codes and wording are no " +
        "longer frozen; the target book designs them as one consistent system. A refusal is a behaviour (a signed-out caller is " +
        "refused; a payment over the balance is refused), checked by its code only where the target's own error vocabulary keeps it. " +
        "A renamed command, a rewritten claim or a retired one carries a decision. Since the cut (START-HERE section 6, " +
        "aaron.frappe-native, aaron.one-door), each of the 215 is either booked in the built book, where its claims and refusals " +
        "are checked as above, or classified in shared/cut.ts as reached (Frappe owns it), dropped or parked, by a `cut.*` decision " +
        "that names the operation and what carries it. An operation is never both, and never neither. What a classified " +
        "operation did that moves money or changes authority is carried by a named Core operation or plug.",
    },
    { label: "strict", text: "Keep the frozen text as the public surface word for word, as P10's first rung said." },
    { label: "nothing", text: "Free everything, the list of operations and the acceptance claims included." },
  ],
  chosen: "behaviour",
  why:
    "Nothing outside depends on the exact CLI surface, and the old staging data is being dropped (environments.staging), so the " +
    "strict freeze only made the rebuild copy old inconsistencies: restoring old --json shapes and refusal codes cost design work " +
    "and bought nobody anything. What must survive is what the system does, and the acceptance claims say that. This supersedes " +
    "the strict reading of the freeze and P10's 'the frozen text wins' for spelling; P10's rungs still decide behaviour, money and " +
    "internals. blueprint/baseline stays as the list of capabilities and the source of each claim, and blueprint/baseline/flags.ts is reference " +
    "for designing the new flags, not surface to preserve. packages/blueprint-engine/scripts/check-frozen.ts checks that every operation is booked once or " +
    "classified by the cut, and that every booked operation's acceptance claims and refusal behaviours are kept in intent, or " +
    "rewritten or retired with a decision. Extended on 10 November 2026 by the coordinator, on Aaron's delegation, as START-HERE " +
    "section 6 asks: the old rule said all 215 stay, which would force the book to keep rebuilding what Frappe owns." + " Review, 11 November 2026: The surviving rule (The freeze keeps behaviour; each old operation is booked or classified) still applies. Removed subjects in its historical evidence are not restored; cut.principle; aaron.one-door; sites.door; portal.plan-page governs their replacement.",
  source:
    "Aaron, 8 November 2026, in the build-preparation conversation; extended 10 November 2026 by the coordinator, on Aaron's delegation (cut.principle)",
  affects: [f.system_capxul, f.component_cli, f.component_core_sdk, f.component_mcp_server],
});

export const decision_rules_counterparty_reads = defineDecision({
  id: "rules.counterparty-reads",
  title: "A counterparty reads company rows through admissions, never elevated",
  question:
    "Some rpcs serve a counterparty who holds no Seat: an invited investor (equity.investments.*), a shareholder voting " +
    "(equity.votes.get), a grantee, a payee. They read company rows beyond their own: fundraise-rounds, votes, " +
    "equity-installs and the organization's public fields. Row-level security (P8) admits only the company's tenant. How do " +
    "these reads pass it?",
  options: [
    {
      label: "clauses",
      text:
        "Each such table gets a read-only admission joined from the counterparty's own row (the investment, the grant, the " +
        "share holding, the agreement) to the company rows it may see, so the database enforces it. The build session adds " +
        "these clauses at B1, book first, before generating the policies; the admission-in-prose gap and the tenancy evals " +
        "show any it misses.",
    },
    {
      label: "elevated",
      text:
        "The rpc authorizes the counterparty by the chain or by its own row, then reads in the company's tenant with the " +
        "service role, returning only its declared output.",
    },
  ],
  chosen: "clauses",
  why:
    "P8 puts tenancy in the database so that no handler's mistake can leak another tenant's rows; an elevated read moves " +
    "that guarantee back into each handler, exactly where the old system leaked. A clause joined from the counterparty's own " +
    "row admits only what that relationship already entitles them to, and each clause is an eval (tbl:<t>/admits/<n>). " +
    "Found by the adversarial review of the admissions, which listed fundraise-rounds, votes, equity-installs and " +
    "organizations; the review did not finish the list, so B1 starts from the rpcs whose `who` is a counterparty.",
  source: `${HANDOFF}; evidence: the adversarial review of rules.admissions-and-wait-keys (counterparty rpcs in equity, payroll and organizations)`,
  affects: [f.concept_organizations, f.component_postgres],
});

// ── operations beyond the 215 (8 November 2026) ─────────────────────────────────────────────

const RULES = "Claude, target assembly (rules), 8 November 2026";

export const decision_rules_new_operations = defineDecision({
  id: "rules.new-operations",
  title: "A new operation is booked with a decision citing an Aaron ruling, and a claim",
  question:
    "system.frozen-behaviour keeps the 215 operations as the list of capabilities, and packages/blueprint-engine/scripts/check-frozen.ts refused any " +
    "target operation that is none of them. Aaron has since ruled new capabilities fundamental: every Organization starts " +
    "with a CRM and Projects in Frappe's shapes, and its payroll is Frappe HR's (aaron.frappe-shape, " +
    "aaron.crm-frappe-shape, aaron.projects), and aaron.projects says their operations are new capabilities, designed " +
    "book first with a decision pack. So the lanes booked those rpcs behind SDK-only flows (contacts.crm-capabilities, " +
    "payroll.hr-surface) or not at all (projects.commands, organizations.commands): no CLI command could be booked. On " +
    "what terms may the target book an operation that is none of the 215?",
  options: [
    {
      label: "cited-ruling",
      text:
        "A new operation is booked only when: (1) a decision on it other than this rule (its `affects` lists the " +
        "operation) cites the Aaron ruling it serves: the decision is one of Aaron's rulings, or its own words or its " +
        "source name an `aaron.*` id that is a ruling in the book; (2) it has at least one acceptance claim, a claim with " +
        "what an eval observes (P1); and (3) it collides with nothing: its id is its command's words joined by dots, is " +
        "no frozen id, and shares its export name `operation_<id>` with no other operation, frozen or new (ids that " +
        "differ only in . - or _ share one); and its command is no other target operation's command and no frozen " +
        "operation's old command. It is " +
        "written in the owning concept's operations.ts with its own text (it has no frozenText, so nothing of it is " +
        "compared with the old book) and keeps every target rule: its flow serves the CLI (A4), its budget (P5), and " +
        "refusals its implementation produces, each from a world. packages/blueprint-engine/scripts/check-frozen.ts counts new operations apart from " +
        "the 215, which it still requires booked exactly once each, and reports the rulings they serve.",
    },
    {
      label: "accepted-pack",
      text:
        "As cited-ruling, and the decision must also be one Aaron accepted (ACCEPTED in shared/rulings.ts) or his own, " +
        "so no new command is booked on a recommendation alone.",
    },
    {
      label: "closed",
      text: "Keep the 215 as the whole CLI: new capabilities stay SDK methods until Aaron reopens the list himself.",
    },
    {
      label: "any-decision",
      text: "Book a new operation with any decision on it, as a frozen command is renamed, with no ruling cited.",
    },
  ],
  chosen: "cited-ruling",
  why:
    "Aaron's rulings already make these capabilities operations: aaron.projects says they are new capabilities designed book first with a decision pack, and aaron.frappe-shape puts CRM, Projects and Frappe HR payroll in every Organization from the start. system.frozen-behaviour keeps the 215 and what their claims require, and nothing in it closes the list. So the rule opens it exactly where a ruling does. Citing the ruling ties each new command to the authority that made its capability; a claim makes it an eval, not a hope, as the 215's claims are theirs; and the collision checks keep the 215 exact: a new id equal to a frozen one would be read as that operation, one that differs only in its separators would share its export name, and a reused command would be two operations to the CLI. The 215 are still counted and required exactly, so a new operation never stands in for a frozen one. Accepted-pack was weighed: a decision pack's recommendation stands until Aaron answers, as every recorded choice does (the judgments report lists the packs for him), and a new operation changes no behaviour of the 215, so the stricter form would only hold the book back. Closed would leave the CRM, projects and Frappe HR payroll with no CLI, though the Forward Deployed Engineer works through the CLI as every agent does (aaron.fde-agent). Any-decision would let in a capability no ruling asked for. This rule never counts as the decision on a new operation: it cites rulings for every capability, so an operation in its affects would be booked with no pack of its own. It decides how one is booked, not which: the commands the CRM, projects, payroll and the head get are their packs' questions. For Aaron: may a new command be booked on its pack's recommendation before he answers the pack? Recommended: yes, as chosen; accepted-pack is the change if he wants his acceptance first. Review, 11 November 2026: Confirmed rules.new-operations; original choice retained.",
  source: `${RULES}; under system.frozen-behaviour and aaron.frappe-shape (aaron.projects: a decision pack); evidence: packages/blueprint-engine/scripts/check-frozen.ts; contacts.crm-capabilities, payroll.hr-surface, projects.commands, organizations.commands`,
  affects: [
    decision_system_frozen_behaviour, f.system_capxul, f.component_cli, f.component_core_sdk, f.concept_contacts,
    f.concept_organizations,
  ],
});

const AUTHORITY = "Claude, authority audit, 8 November 2026";

export const decision_rules_department_authority = defineDecision({
  id: "rules.department-authority",
  title: "Money authority is the hat a Safe wears now: a budget is its department's",
  question:
    "Who holds authority over a budget's money: the department the budget belongs to, a person, or the Directors? " +
    "How do the book's who-lines, refusals, processes and notices state it?",
  options: [
    {
      label: "hat-now",
      text:
        "A department is a budget in the company Safe's tree with its own office hat. Authority over its money is " +
        "`Budgets.authorised` at the call: the company Safe, or a wearer in good standing of the budget's hat or an " +
        "ancestor's (Agreements asks the same). Changing a budget is for the office above: the Safe for a top budget, " +
        "`authorised(parent)` for a child, never its own hat. People are swapped in and out by Hats: the hat's admin mints " +
        "(the Board for a hat under its top hat, a department's holder for its teams), the company Safe as eligibility " +
        "rules out. Every office hat is made with the company Safe as eligibility and toggle, mutable, never a person's " +
        "Safe. What the department set running (offers, agreements, dated payments, teams, escrows it funded) stays its " +
        "own: the next wearer acts on it and the last one is refused. A budget's claim escrow is taken back by whoever " +
        "`authorised` admits at the reclaim, the money returning to the company Safe. Who-lines say 'the wearer of the " +
        "budget's hat or of one above it', never the person who sent, offered or holds an allowance. Seats, the officer " +
        "hats and ROLE_CONFLICT are Capxul's own guards, stated as such; they never replace the chain's check.",
    },
    { label: "person", text: "Authority over a budget's money follows the person who holds it, offered from it or sent from it." },
    { label: "directors", text: "Every action on a budget is a Board proposal by a Director, as the pre-v4 who-lines say." },
  ],
  chosen: "hat-now",
  why:
    "It is the departments ruling, and it is what the v4 contracts do. Budgets asks Hats at every call " +
    "(`authorised`: the Safe, or the hat of the budget or of any budget above it), so a holder taken out of the hat is " +
    "refused at once and the next wearer is admitted, with no Capxul row involved. Agreements never reads Hats and " +
    "defers to that answer, so an agreement belongs to its budget, not to whoever offered it. 'Person' would hand a " +
    "departed holder power the chain no longer gives them (a reclaim from their own Safe), or strand the department's " +
    "money when they leave. 'Directors' is wrong both ways: a department's or team's office acts without the Board " +
    "(`createChildBudget`, `spend`, `schedule`, `offer`, `setAmount` on a child), and the Board cannot spend from a " +
    "budget at all, because the Gate refuses a payout started inside a Safe transaction; the Board pays by its own " +
    "batch. Office hats with the company Safe as eligibility and toggle outlive their holders; one whose eligibility " +
    "is a person's Safe would leave that person able to rule wearers out after they left. The officer hats, Seats and " +
    "ROLE_CONFLICT authorise nothing on chain: they are Capxul's guards over its own records and its product rules, " +
    "kept as such. docs/design/authority.md sets out the model, a table of every money action and the check that " +
    "allows it, and seventeen places the book contradicts it, each with its fix and owner.",
  source:
    `${AUTHORITY}; under aaron.departments and aaron.escrow-general; evidence: v4 Budgets.sol:373 (authorised), :442 ` +
    "(_requireManager), :146, :179; Agreements.sol:279; InstallerMoney.sol:132; spec/budgets.md, spec/board.md",
  affects: [
    f.concept_budgets, f.concept_payments, f.concept_board, f.concept_organizations,
    f.concept_agents, f.concept_banking, f.concept_requests, f.concept_notices,
    x.contract_budgets, x.contract_agreements, x.contract_hats, x.contract_escrow,
  ],
});

// ── the world pass's build (9 November 2026): the hosted FDE acts as its asker everywhere ───

export const decision_rules_fde_acts_for_asker = defineDecision({
  id: "rules.fde-acts-for-asker",
  title: "Archived: Every tenant guard resolves the hosted FDE to its open ask's asker, or",
  question:
    "The eighth batch's ruling that anyone may ask the hosted FDE, which does for them only what their own hats allow, is applied in organizations (organizations.fde-for-the-asker). Every concept's rpcs authorise a caller through organizations' tenant guard. How does that guard, and the Core SDK, treat a call the hosted FDE makes?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive the hosted act-for-token tenant guard: hosted FDE work is parked. No current caller gets an asker's Seat or hats by presenting an old org-fde-asks token. Self-run agents use their explicitly granted authority; a future hosted impersonation feature requires a new decision before enabling it."
  },
  {
    "label": "historical",
    "text": "The former answer to rules.fde-acts-for-asker is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive the hosted act-for-token tenant guard: hosted FDE work is parked. No current caller gets an asker's Seat or hats by presenting an old org-fde-asks token. Self-run agents use their explicitly granted authority; a future hosted impersonation feature requires a new decision before enabling it. Authority: cut.organizations; cut.fde-parked; sites.lifecycle; plugs.roles-follow-hats.",
  source: "The coordinator, round 2, m1-old-decisions; cut.organizations; cut.fde-parked; sites.lifecycle; plugs.roles-follow-hats",
  affects: [
    f.concept_organizations, f.concept_agents, f.concept_contacts, f.concept_payments,
    f.concept_budgets, f.component_core_sdk, x.integration_fde_host,
  ],
});

export const decision_integrations_bundler_door = defineDecision({
  id: "integrations.bundler-door",
  title: "Core's bundler door answers a refusal and throws only on a lost or wrong answer",
  question: "What does the bundler door Core composes into the approval carrier return, and which rejections are refusals?",
  options: [
    { label: "refusal-is-an-answer", text: "send returns the signed hash or a TRANSACTION_FAILED refusal; it throws PROVIDER_ERROR when no answer came and PROVIDER_RESPONSE_INVALID for a wrong hash. lookup returns whether the bundler holds the operation and its receipt." },
    { label: "throw-everything", text: "Every failure, refusals included, is thrown and the carrier sorts them." },
  ],
  chosen: "refusal-is-an-answer",
  why:
    "A validation refusal is a definite answer the carrier acts on (back to signed, sent again in the window), while a lost answer may mean the operation is held, so the carrier looks it up and never sends again. " +
    "Refusals are the ERC-4337 codes -32500 to -32599 and invalid params -32602, except throttling and stake (-32504, -32505), which say nothing about the operation and are lost answers like every other error. " +
    "Alto 0.0.21 answers -32602 with exactly the message 'Already known' when an identical operation (by hash) is in its outstanding or processing mempool, and its eth_getUserOperationByHash and receipt search only on-chain logs, so a lookup cannot see that operation until it is bundled: " +
    "that one answer is the signed hash, recognised by the exact message (kept as a flag, never the text). Every other refusal is believed only after a lookup by the signed hash finds the operation not held; a held operation is the signed hash, whatever the answer was. " +
    "This differs from the devnet's earlier rule only for -32504 and -32505 (now looked up, not refused) and -32602 (now a refusal unless held); the sponsorship gateway's classification (approvals sponsorship) is a separate call and keeps its own rule. " +
    "The hash the bundler answers must equal the signed one, or the door refuses the answer. Held means the bundler returns the operation or its receipt; a receipt is never settlement, which comes only from Core's final indexed fact. " +
    "The provider is product code in the backend's Shared module, and the devnet uses the same one.",
  source: "integration bundler; Approvals and Requests agreement, 13 November 2026",
  affects: [x.integration_bundler],
});
