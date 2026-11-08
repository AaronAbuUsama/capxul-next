// Every judgment the target architecture makes, as a decision record (defineDecision). Ids are
// grouped by prefix: components, concepts, dependencies, rules, vocabulary, integrations, contracts,
// environments, system and operations. Each record names the records it affects; the build checks
// every one of those links. docs/decisions/target-architecture.md is the readable account.
//
// Made by Claude on 7 November 2026, under Aaron's accepted decisions A1-A4 and P1-P10, with the old
// system (/home/user/factory, integration/factory) and the as-is book as evidence.

import { defineDecision, type Concept } from "../../../packages/book/src/index.ts";
import * as f from "./foundation.ts";
import * as v from "./vocabulary.ts";
import * as x from "./external.ts";

const CLAUDE = "Claude, target architecture, 7 November 2026";
const by = (evidence: string) => `${CLAUDE}; evidence: ${evidence}`;

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
  source: by("books/as-is/shared/foundation.ts (component cycle); docs/as-is/payments.md (17 cycle problems)"),
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
  title: "22 target concepts in one dependency order",
  question: "How many concepts, and in what order, so that every old responsibility lands once and nothing loops?",
  options: [
    { label: "keep-17", text: "Keep the 17 old concepts and cut the loop by moving imports." },
    {
      label: "22-dag",
      text:
        "22 concepts in this order: access, media, parties, indexing, approvals, accounts, organizations, board, agents, " +
        "budgets, books, documents, contacts, payments, payroll, banking, requests, applications, equity, activity, notices, devnet.",
    },
    { label: "fewer", text: "Merge into about 8 large concepts (identity, organizations, money, books, equity, devnet...)." },
  ],
  chosen: "22-dag",
  why:
    "15 of the 17 old concepts formed one import loop, and the loop ran through real responsibilities in the wrong place: " +
    "permissions inside organizations' authority, executions inside payments, Directors inside organizations, waitlist " +
    "credit inside access. v4 itself splits them: Budgets, Agreements, Hats and the Signer Gate, AgentOwner and the equity " +
    "clones are separate contracts with separate authority. Each target concept owns one of those nouns, and its " +
    "dependencies point only at concepts it must read or invoke. Merging into fewer concepts would break the line budgets " +
    "(`sys:loc`) and hide ownership (P4 option C's objection). The new ones are small and each has a decision below.",
  source: by("books/as-is/shared/foundation.ts (108 edges, 15-concept cycle); docs/planning/protocol-v4/architecture.md"),
  affects: [...f.CONCEPTS],
});

export const decision_concepts_access = defineDecision({
  id: "concepts.access",
  title: "Access keeps sign-in and sessions and moves to the bottom",
  question: "What does access own, and how does it get to depend on nothing?",
  options: [
    { label: "bottom", text: "Principals, sessions, sign-in, client grants and gates; the waitlist, referrals, consent and the indexer scope leave it." },
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
    "the account's setup are accounts' flows (operations.sign-in-in-accounts).",
  source: by("books/as-is/shared/foundation.ts (access imports 5 concepts); packages/backend/src/access/README.md:3"),
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
  source: by("books/as-is/shared/foundation.ts (media imports 3 concepts); apps/docs/factory/operations/org.create.yaml (logo)"),
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
    "A profile is a person's own Party seen by others: its display name is what a counterparty sees, so it belongs with the " +
    "Party (old profiles was one `identities` table linked to the person's Party). Contacts need an Organization's " +
    "membership, which sits above parties, so they move up (concepts.contacts). Verification is Bridge's KYC for bank rails " +
    "only, so it moves to banking. Engagements were what payroll runs paid; v4 Agreements replace them. What remains is " +
    "the one thing everyone below organizations needs: a name, the Safe it routes money to, and who owns that Safe.",
  source: by("packages/backend/src/profiles/README.md:3; apps/docs/factory/operations/verify.start.yaml; ADR-0022"),
  affects: [f.concept_parties, f.concept_contacts, f.concept_banking, f.concept_payroll],
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
    { label: "workspace", text: "Identity, setup and install, the deployment record, members and invitations; Directors and proposals to board; equity and votes to equity." },
    { label: "as-is", text: "Keep everything, including directors, equity, rounds, proposals and votes." },
  ],
  chosen: "workspace",
  why:
    "Members and invitations are needed by almost every concept (who may act for this Organization), so they must sit low; " +
    "Board proposals are opened by budgets, payments, payroll, agents and equity, so the Board must sit above organizations " +
    "and below them. Keeping both in one concept is what tied organizations and permissions into a two-way loop (76 and 37 " +
    "imports). Equity is low priority and off the critical path, so it should not share a line budget with the workspace.",
  source: by("docs/mission/findings.md (organizations-permissions cycle); docs/spec/40-capxul-team.md (equity low priority)"),
  affects: [f.concept_organizations, f.concept_board, f.concept_equity, f.concept_activity],
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
    "share that one machine, so it is one concept. It reads members from organizations, and invitations' offered grants " +
    "become proposals here (the invite flow's second step), so organizations never depends on board.",
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
    "The designed text says it directly: 'A spending allowance becomes a small budget under a hat the member wears', and a " +
    "department is a top or child budget. Both are one v4 contract (Budgets), one tree and one authority rule (the wearer " +
    "of the budget's hat or of any above it). Keeping them apart would duplicate the tree and its authority check.",
  source: by("apps/docs/factory/operations/org.allowance.create.yaml, org.department.create.yaml (designed)"),
  affects: [f.concept_budgets, f.concept_payroll],
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
  title: "Payroll keeps agreements; runs, items and groups are dropped",
  question: "What does payroll own on v4, and do payroll runs survive?",
  options: [
    { label: "agreements", text: "Payroll owns v4 Agreements only; runs, items and saved groups are dropped; departments go to budgets." },
    { label: "keep-runs", text: "Keep payroll runs and rosters as batches of payments." },
  ],
  chosen: "agreements",
  why:
    "No frozen operation makes, lists or shows a payroll run, so by P2 it has no caller and is deleted by default; it comes " +
    "back only with a named one. On v4, recurring pay is an Agreement collected by the payee, and a one-off batch is " +
    "`payment send` or `org department pay`. Dropping runs also removes the settle-run procedure that tied payments to " +
    "payroll (dependencies.payments-payroll).",
  source: by("books/frozen/operations.ts (payroll area: agreements only); P2; packages/backend/src/payroll/tables.ts:167"),
  affects: [f.concept_payroll, f.concept_budgets, f.concept_payments],
});

export const decision_concepts_books = defineDecision({
  id: "concepts.books",
  title: "Books gains annotations and prices",
  question: "Where do activity's annotations and the Chainlink price sync go?",
  options: [
    { label: "books", text: "Both in books: an annotation gives a row its account, which is a book fact; prices value book facts." },
    { label: "activity", text: "Annotations stay in activity, which then writes books' facts or is read by books." },
  ],
  chosen: "books",
  why:
    "The frozen text says a fact is 'a change to the chart, an account given to a row, or a money event'. If activity " +
    "owned the annotation, either activity writes a book fact (a cross-concept write that is no money fact) or books reads " +
    "activity while activity reads books' chart: a loop. In books, `activity annotate` is one transaction. Prices were " +
    "already `bookPrices`; the Chainlink sync is its writer (P3 keeps it).",
  source: by("apps/docs/factory/operations/org.books.facts.list.yaml, activity.annotate.yaml; packages/backend/src/books/README.md:3"),
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
  title: "Documents stays, below everything that stamps a document hash",
  question: "Where does documents sit, and how does it know who may read a document?",
  options: [
    { label: "below-money", text: "Below payments, requests and payroll; participants are given when the document is stored." },
    { label: "as-is", text: "Keep documents reading payments, requests and books to find a document's participants." },
  ],
  chosen: "below-money",
  why:
    "A document is born with its subject (K2: a command, its Payments and their documents are born together), so the " +
    "subject's concept stores it through a procedure and must depend on documents. Documents then cannot read its subjects; " +
    "giving it the participants at store time means it never has to.",
  source: by("K2 in docs/as-is/payments.md; books/as-is/shared/foundation.ts (documents imports 7 concepts)"),
  affects: [f.concept_documents, f.concept_payments, f.concept_requests, f.concept_payroll],
});

export const decision_concepts_contacts = defineDecision({
  id: "concepts.contacts",
  title: "New concept: contacts, split from parties",
  question: "Where does the address book live?",
  options: [
    { label: "contacts", text: "A small contacts concept above organizations." },
    { label: "parties", text: "Keep contacts in parties and let the runtime check Organization membership." },
    { label: "payments", text: "Put contacts in payments, as their area suggests." },
  ],
  chosen: "contacts",
  why:
    "An Organization's address book is acted on by its members, which only a concept above organizations can check; " +
    "parties must stay below organizations because an Organization registers its Party at birth. A hidden runtime check " +
    "would be a dependency the book cannot see. In payments, banking (bank accounts on a contact) would still have to " +
    "reach into payments for a non-money record.",
  source: by("apps/docs/factory/operations/contact.add.yaml ('a member of the Organization for its book')"),
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
  source: by("apps/docs/factory/operations/bank.match.yaml; books/as-is/shared/foundation.ts (banking-requests loop)"),
  affects: [f.concept_requests, f.concept_banking],
});

export const decision_concepts_applications = defineDecision({
  id: "concepts.applications",
  title: "Applications stays separate, above organizations, with consent and health",
  question: "Merge applications into access, and where do consent and the deployment health check go?",
  options: [
    { label: "above-organizations", text: "Applications above organizations, owning apps, keys, origins, bootstrap, consent, quickstart keys and health." },
    { label: "merge-access", text: "Merge applications into access." },
  ],
  chosen: "above-organizations",
  why:
    "An Organization's publishable key needs the Invoicing hat ('For an Organization, a member who holds issue " +
    "invoices'), so applications must sit above organizations; access must sit below everything. Merging them would make " +
    "a loop. Consent is a person's grant to an application, so it is the application's record. `doctor --online` checks " +
    "the deployment and the app key, which is what bootstrap already describes, so health lives here.",
  source: by("apps/docs/factory/operations/key.create.yaml, doctor.yaml; books/as-is/shared/foundation.ts (access-applications loop)"),
  affects: [f.concept_applications, f.concept_access],
});

export const decision_concepts_equity = defineDecision({
  id: "concepts.equity",
  title: "New concept: equity, with shareholder votes",
  question: "Where do the cap table, options, rounds, SAFEs, exits, shares and shareholder votes live?",
  options: [
    { label: "equity", text: "One equity concept, low priority, including the Governor's votes." },
    { label: "board-votes", text: "Equity without votes; votes in board." },
  ],
  chosen: "equity",
  why:
    "They are the v4 equity clones (Captable, ShareClass, Vesting, Options, Rounds, Exits, Governor), all low priority and " +
    "off the critical path (spec 40), so one concept keeps them out of the critical concepts' budgets. Shareholder votes " +
    "weigh shares and run on the Governor, an equity clone; Board decisions are board's proposals.",
  source: by("docs/spec/40-capxul-team.md (equity, directors and voting low priority); docs/planning/protocol-v4/architecture.md"),
  affects: [f.concept_equity, f.concept_board],
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
    "A line budget is only as good as the design under it, and the per-concept designs have not been written. The old " +
    "lines are mostly plumbing (about two thirds of an area is ceremony, and 166 files are emit, intent, load or record), " +
    "so they would anchor the numbers on the system being replaced, the same objection P5 made to per-operation budgets.",
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
    "step: board proposes the grants for the invitation.",
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
    "collect at setup, which are chain facts (EscrowCreated with the person's Safe as payee). So accounts reads indexing.",
  source: by("docs/mission/findings.md (accounts-payments, 21 imports each); account.retry.yaml (designed: collects claim escrows)"),
  affects: [f.concept_accounts, f.concept_payments],
});

export const decision_dependencies_payments_payroll = defineDecision({
  id: "dependencies.payments-payroll",
  title: "Payroll sits above payments' dependencies, and payments never depends on payroll",
  question: "Old payments called payroll's settle-run inside its settlement, and payroll built payments. Which way now?",
  options: [
    { label: "independent", text: "Payments does not depend on payroll; payroll depends on budgets; collections are born as Payments from chain facts." },
    { label: "procedure", text: "Keep `payroll.settle-run` as a procedure payments invokes (P4's example)." },
  ],
  chosen: "independent",
  why:
    "P4 kept settle-run as a procedure because a settled Payment with its run still open was a money bug. With runs dropped " +
    "(concepts.payroll), there is no run to settle. An agreement collection is `Agreements.collect`, whose PaymentSent " +
    "payments settles like any other; the reservation it pays from is on chain. Neither concept writes the other's tables.",
  source: by("P4 (settle-run procedure); docs/as-is/payments.md (K11); concepts.payroll"),
  affects: [f.concept_payments, f.concept_payroll],
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
    "ADR-0042 decision 1 (accepted) and P4 put a book fact in the caller's transaction so a fact is never lost or doubled, " +
    "and K10 says a settled Payment always has its book facts. Books needs nothing from payments: its facts carry what they " +
    "record. The old code had the door (`recordSettledPaymentInTx`) and never used it; the target imports only the door.",
  source: by("ADR-0042 decision 1; P4; docs/as-is/payments.md (K10, 0 door imports)"),
  affects: [f.concept_books, f.concept_payments, f.concept_banking],
});

export const decision_dependencies_activity_books = defineDecision({
  id: "dependencies.activity-books",
  title: "Activity reads books; books never reads activity",
  question: "Old activity and books imported each other. Which way now?",
  options: [
    { label: "activity-up", text: "Activity reads books' annotations, chart and prices; books owns annotations." },
    { label: "books-up", text: "Books reads activity's annotations." },
  ],
  chosen: "activity-up",
  why: "Annotations moved to books (concepts.books), so activity is a pure reader above books and nothing reads activity.",
  source: by("books/as-is/shared/foundation.ts (activity imports books; books imports activity's neighbours)"),
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
    "The concept that knows the intent (a department, a Board payment, an org-owned agent's freeze) builds the calls; the " +
    "Board only collects approvals and executes. If board built them it would depend on every money concept. A proposal " +
    "and the intent it carries are one fact (rules.procedures), so opening it is a procedure.",
  source: by("org.department.create.yaml, payment.send.yaml (--as-directors), agent.create.yaml (designed)"),
  affects: [f.concept_board, f.concept_budgets, f.concept_payments, f.concept_payroll, f.concept_agents, f.concept_equity],
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
    { label: "notices-up", text: "Notices depends on accounts, organizations, board, payments, payroll, banking, requests and equity; their transitions trigger it." },
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
        "An approval, a payment command, a dated payment, a Board proposal, an Organization's setup, a personal Safe's setup, " +
        "an agreement, a request, an invitation, a bank payout, a verification, an agent change, and a round (equity).",
    },
    { label: "workflows-only", text: "Only what P3's three-part test calls a workflow, with no instance per object." },
  ],
  chosen: "list",
  why:
    "Each waits on something outside a request (a signature, the chain, a date, a person, Bridge) and must survive a " +
    "crash: P3's test holds for each, and A3 says the process owns its machine. Short-lived rows (a contact, a book " +
    "account, an annotation) change only inside rpcs and have no process. The concept designer may add objects, never drop " +
    "one of these without a decision.",
  source: by("A3 (time); P3 (the three-part test)"),
  affects: [
    f.concept_approvals, f.concept_payments, f.concept_board, f.concept_organizations, f.concept_accounts, f.concept_payroll,
    f.concept_requests, f.concept_banking, f.concept_agents, f.concept_equity,
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
  source: by("books/frozen/operations.ts (refusal and fix scan, 7 November 2026)"),
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
  source: by("books/frozen/operations.ts (shares.exercise, org.round.*, invest.*, org.board.director.add designed refusals)"),
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
  source: by("books/frozen/operations.ts (designed refusal exits); apps/cli/src/runtime/errors.ts:216-225 (exitClass)"),
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
  source: by("books/frozen/operations.ts (0 mentions); concepts.notices"),
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
  source: by("books/frozen/operations.ts (0 mentions); packages/protocol/src/errors/codes.ts:32"),
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
  source: by("books/frozen/operations.ts (0 mentions); docs/as-is/payments.md (E5)"),
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
  source: by("books/frozen/operations.ts:5491, 17895, 18220"),
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
  source: by("books/frozen/operations.ts (0 mentions); AgentOwner.sol (freeze)"),
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
  source: by("books/frozen/operations.ts (0 mentions each); apps/cli/src/runtime/errors.ts:34 (CLI_DEFECT exit 1)"),
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
  source: by("books/as-is/shared/external.ts; docs/mission/findings.md (10 integrations, 186 functions)"),
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
  source: by("P5 (hop table, class defaults); books/as-is/shared/external.ts (NODE: 30 s, 4 nodes); K4"),
  affects: [x.integration_chain_rpc, x.integration_bundler, x.integration_bridge, x.integration_mail, x.integration_service_signer],
});

export const decision_integrations_indexer = defineDecision({
  id: "integrations.indexer",
  title: "The indexer is a service for what depends on Ponder's progress",
  question: "Ponder's tables are in the same Postgres. Why an integration at all, and what are its calls?",
  options: [
    { label: "progress-calls", text: "Plain indexed reads are table reads; head, awaitBlock and factsOf are calls, because Ponder may lag, reindex or be rebuilt." },
    { label: "tables-only", text: "No integration: everything is a table read." },
  ],
  chosen: "progress-calls",
  why:
    "A read that needs a fact Ponder has not indexed yet must wait for it or fail with a code, not answer with nothing " +
    "(the old system answered 'pending' forever when the indexer was down, old R2). Making those reads calls gives them a " +
    "timeout, a failure mapping and a `call.indexer.*` span (P6), so a lagging Ponder is visible in every trace that waits on it.",
  source: by("docs/as-is/payments.md (R2, settle treats an unavailable indexer as pending); P6"),
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
        "the Hats Signer Gate v2 and ERC-20.",
    },
    { label: "capxul-only", text: "Only Capxul's own v4 contracts." },
  ],
  chosen: "v4-and-wired",
  why:
    "P9 drops V2, V3, CapxulEscrow, PayrollDepartments and the rest. The third-party contracts are not pre-v4: v4's " +
    "architecture lists Hats, the Signer Gate and Roles as its authority group, and every approval goes through the " +
    "EntryPoint and the Safe module. Without them the book could not name the calls the designed text makes (approveHash, " +
    "mintHat, claimSignerFor). Hats Elections and the libraries are left out: no frozen operation calls them directly.",
  source: by("P9; packages/protocol/src/evm/protocol-v4-addresses.ts:12-30; docs/planning/protocol-v4/architecture.md"),
  affects: [
    x.contract_companies_house_claimer, x.contract_company_safe_minter, x.contract_installer, x.contract_payments,
    x.contract_budgets, x.contract_agreements, x.contract_escrow_factory, x.contract_escrow, x.contract_agent_owner,
    x.contract_captable, x.contract_share_class, x.contract_vesting, x.contract_options, x.contract_rounds, x.contract_exits,
    x.contract_governor, x.contract_safe, x.contract_safe_4337_module, x.contract_multi_send_call_only, x.contract_entry_point,
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
    "inside Exits.buy, Captable.setConversionPrice inside Rounds.close) is the callee's business and is left out.",
  source: by("books/frozen/operations.ts (designed.call); old as-is gap `uncalled-function` (18)"),
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
  source: by("org.member.invite.yaml (designed: --agent replaces --ai); books/as-is/shared/foundation.ts (actors)"),
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
    "Areas are how people find commands, not concepts (the operation record says so). 134 operations sit in their area's " +
    "primary concept (AREA_CONCEPTS) and 81 move with their behaviour: agents, session and local commands out of accounts; " +
    "`doctor` and keys to applications; verification and `contact bank add` to banking; invitations and members to " +
    "organizations, `invite accept` to banking, allowances to budgets and votes to equity out of governance; requests, services, the inbox, contacts, " +
    "documents, `address` and `balance` out of payments; `activity annotate` to books; `bank match` to requests; `org " +
    "department pay` to payments; `dev fund` to accounts, `dev key` to applications, `dev mail notices` to notices. The " +
    "map is typed against every frozen id, so none can be missed, and every concept but media, parties, indexing and " +
    "approvals owns at least one operation. The rule behind each exception: an operation's flow sits in a concept that " +
    "depends on every concept whose rpcs it composes (operations.sign-in-in-accounts, operations.member-invite-in-board, " +
    "operations.invite-accept-in-banking).",
  source: by("books/frozen/operations.ts (215 operations, 11 areas); OPERATION_OWNERS in books/target/shared/foundation.ts"),
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
    { label: "books", text: "Books: one cron scans each added asset's Transfers to and from the company Safe from the block it was added, and writes book facts." },
    { label: "indexing", text: "Indexing, triggered by books' asset transition." },
    { label: "indexing-procedure", text: "Indexing owns a watched-token table that books writes through a procedure." },
  ],
  chosen: "books",
  why:
    "The frozen text says the books 'record its transfers' and 'Capxul starts scanning its transfers from the current " +
    "block'; its facts carry the token's symbol and no USD. The scan's only reader is books, and its list of tokens is " +
    "books' own `assets`. In indexing, the scan would have to follow books' transition, which needs indexing above books, " +
    "a cycle; a watched-token procedure is not one money fact. In books it reads its own table and the chain (chain-rpc " +
    "`getLogs`), and `org books assets remove` stops it. Indexing is then Ponder's views only.",
  source: reviewed("org.books.assets.add.yaml, org.books.assets.remove.yaml; P3 (scan added tokens); platform/jobs.ts:125-139"),
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
    "parties, below accounts) moves to the Safe's setup, which already refuses a waiting person. Aaron may rule this " +
    "against P4's narrow reading.",
  source: reviewed("org.member.invite.yaml (acceptance), org.create.yaml ('a founder on the beta waitlist is refused'); access/waitlist/guards.ts:49; P4"),
  affects: [f.concept_accounts, f.concept_organizations, f.concept_parties, decision_rules_procedures],
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
  id: "operations.member-invite-in-board",
  title: "`org member invite` is board's flow",
  question: "An invitation is organizations'; the grants it offers are one Board proposal. Which concept owns the operation's flow?",
  options: [
    { label: "board", text: "Board: the flow creates the invitation through organizations' rpc, then proposes its grants through board's own." },
    { label: "organizations", text: "Organizations, calling board's rpc (organizations would depend on board, and board on organizations: a cycle)." },
  ],
  chosen: "board",
  why:
    "One operation is one flow, and a flow composes only concepts its concept depends on. Board already depends on " +
    "organizations; the reverse would loop. The invitation without grants is still organizations' rpc alone, called as the " +
    "flow's first step; the request key makes a repeat return the same invitation and the same proposal.",
  source: reviewed("org.member.invite.yaml (designed call: the Board batch for a grant); concepts.board"),
  affects: [f.concept_board, f.concept_organizations],
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
    "A concept's `about` says what it absorbs, but nothing checks that the old list is covered. The map lists all 91 " +
    "area folders under packages/backend/src/<concept>/, plus the root files of documents and parties, and every entry names a " +
    "decision record, so a dropped responsibility is a judgment a reviewer can find. The map is not a record: the build " +
    "follows its decisions' `affects`.",
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
  source: reviewed("address.yaml (sdk); books/as-is/accounts/summaries.ts:1-12; P2"),
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
  source: reviewed("books/as-is/applications/repairs.ts:1-6; P2; P9"),
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
  source: reviewed("packages/backend/src/operator/README.md:3-20; books/as-is/operator/identities.ts, fixtures.ts, receipts.ts"),
  affects: [f.concept_devnet, f.component_devnet],
});

export const decision_responsibilities_keepers = defineDecision({
  id: "responsibilities.keepers",
  title: "'Manage books' is the Books officer hat",
  question: "Old books listed its keepers (who holds Manage books). What is that on v4?",
  options: [
    { label: "hat", text: "The wearers of the Books hat: board grants and revokes it, books reads its wearers from indexing." },
    { label: "table", text: "Keep a keepers table in books." },
  ],
  chosen: "hat",
  why: "On v4 every officer permission is a hat granted by a Board batch (CAP-1101), and Capxul reads it only from Hats; a table would copy the chain.",
  source: reviewed("org.member.grant.yaml (designed: Books, Invoicing and People hats); packages/backend/src/books/keepers/"),
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
    { label: "drop", text: "Drop: on v4 an invitation offers the three officer hats and the Organization's allowances, which board's invite flow reads and `--preview` shows." },
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
  source: reviewed("books/as-is/accounts/lanes.ts:1-7 (CAP-1097); integrations.set"),
  affects: [x.integration_service_signer, f.concept_accounts],
});

// ── each concept's dependencies, one reason per edge ────────────────────────────────────────
// The reasons are typed against each concept's `dependsOn`: an edge with no reason, or a reason
// for an edge that does not exist, does not compile. The decisions above settle the contested
// directions; these say why each remaining edge is needed at all.

type DepIds<C extends { readonly dependsOn: readonly { readonly id: string }[] }> = C["dependsOn"][number]["id"];

const dependencies = <const C extends Concept>(
  concept: C,
  reasons: { readonly [D in DepIds<C>]: string },
) =>
  defineDecision({
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
    source: reviewed("books/frozen/operations.ts (who and designed call of each owned operation); OPERATION_OWNERS"),
    affects: [concept, ...concept.dependsOn],
  });

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
  indexing: "Budgets' tree, amounts and spends, and each budget hat's wearers, are chain views.",
  approvals: "an office holder's change is an approval from their own Safe.",
  organizations: "the company Safe, members and hat ids from the install.",
  board: "top budgets, payout ceilings and allowance hats are Board batches.",
});
export const decision_dependencies_of_books = dependencies(f.concept_books, {
  access: "the caller of every rpc.",
  indexing: "the Transfers, PaymentSent facts and Safe balances it reconciles against, and the Books hat's wearers.",
  organizations: "books are an Organization's, and the Books hat id is in its deployment.",
});
export const decision_dependencies_of_documents = dependencies(f.concept_documents, {
  access: "the reader of a document.",
  parties: "a document's participants are Parties, given when it is stored.",
  organizations: "an Organization participant's members may read its documents.",
});
export const decision_dependencies_of_contacts = dependencies(f.concept_contacts, {
  access: "the owner of a personal address book.",
  parties: "a contact names a Party, or a handle, email or address that resolves to one.",
  organizations: "an Organization's book is acted on by its members.",
});
export const decision_dependencies_of_payments = dependencies(f.concept_payments, {
  access: "the payer.",
  parties: "the recipient is resolved to a Party and its Safe.",
  indexing: "PaymentSent, Transfers, escrow and Budgets events settle, reverse and birth Payments.",
  approvals: "a personal or budget payment is an approval from the payer's Safe.",
  accounts: "whether the sender and recipient have claimed Safes decides a direct send or a claim escrow.",
  organizations: "an `--org` payment's Organization and its company Safe.",
  board: "`--as-directors` payments and a company-owned claim escrow's refund are Board proposals.",
  budgets: "which budget pays, what it has left and who may spend from it.",
  books: "a settled Payment writes its book fact in its own transaction (books.record-money-fact).",
  documents: "a Payment's document is stored at its birth (documents.store).",
});
export const decision_dependencies_of_payroll = dependencies(f.concept_payroll, {
  access: "the caller of every rpc.",
  parties: "the payee is resolved to a Party and its Safe.",
  indexing: "Agreements' events drive each agreement's process.",
  approvals: "offers, changes, acceptance and collection are approvals from the actor's Safe.",
  organizations: "an agreement is an Organization's, read by its members.",
  board: "an agreement on a top budget is offered or changed by Board proposal.",
  budgets: "an agreement pays from a budget, whose office holder or anyone above may act on it.",
  documents: "an agreement's terms document is stored at its offer.",
});
export const decision_dependencies_of_banking = dependencies(f.concept_banking, {
  access: "the caller of every rpc.",
  media: "verification documents are stored files.",
  parties: "bank details are per Party and currency, and a deposit lands in a Party's Safe.",
  indexing: "the token Transfer a bank deposit becomes, and Director hat wearers for a business's people.",
  organizations: "who may manage an Organization's banking, and the routing of `invite accept`.",
  books: "a bank deposit writes its book fact in its own transaction.",
  contacts: "a saved bank account may belong to a contact.",
  payments: "a bank payout's money leaves as a Payment born through payments.prepare-command.",
});
export const decision_dependencies_of_requests = dependencies(f.concept_requests, {
  access: "the caller of every rpc.",
  parties: "the issuer and the payer are Parties.",
  indexing: "an invoice escrow's events pay a checkout request.",
  organizations: "an Organization's requests need the Invoicing hat; its inbox is read by members.",
  documents: "a request's invoice document is stored at issue.",
  payments: "paying from the inbox births a command; a request's paid state follows payment_transitioned.",
  banking: "a matched deposit is marked through banking.match-deposit.",
});
export const decision_dependencies_of_applications = dependencies(f.concept_applications, {
  access: "consent is a person's grant, and a person owns their own keys.",
  indexing: "the Invoicing hat's wearers may manage an Organization's keys.",
  organizations: "an Organization's applications, and its Invoicing hat id.",
});
export const decision_dependencies_of_equity = dependencies(f.concept_equity, {
  access: "the caller of every rpc.",
  parties: "investors, grantees and shareholders are resolved to Parties and Safes.",
  indexing: "the equity clones' events and positions.",
  approvals: "an investor's, grantee's or shareholder's call is an approval from their own Safe.",
  accounts: "an invited investor needs a claimed Safe to commit or pay.",
  organizations: "the company, its members and its equity deployment.",
  board: "every Board matter (issue, round, options, exit) is a Board proposal.",
  documents: "round, SAFE and grant documents are stored with their offers.",
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
  accounts: "referral invites and admissions.",
  organizations: "invitations sent, resent and expiring.",
  board: "a proposal waiting for a Director.",
  payments: "a dated payment due or failed, and money received.",
  payroll: "an agreement offered, changed or ending.",
  banking: "a business verification invitation and a payout returned.",
  requests: "a request issued, paid or declined.",
  equity: "a round or SAFE invitation.",
});
export const decision_dependencies_of_devnet = dependencies(f.concept_devnet, {
  access: "`dev approve` signs in as another person, and `dev gates set` writes gates.",
  approvals: "`dev approve` signs an approval with the dev signer.",
  organizations: "`dev gates set` for an Organization needs its membership.",
});
