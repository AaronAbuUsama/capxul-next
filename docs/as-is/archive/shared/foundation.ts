// The as-is book of the old payments concept: the bottom layer. The system and its actors, the six
// running components, the 17 backend concepts and the two environments, read from
// /home/user/factory (branch integration/factory).
//
// Concept dependencies are the `#<concept>` imports under packages/backend/src/<concept>, in
// non-test files (no `*.test.ts`, `*.fixture.ts` or `tests/` folder). Each `was` names the first
// import line per dependency. Today 15 of the 17 concepts form a single import loop. Only
// indexing and operator are outside it, because no other concept imports them. Components loop
// too: the backend reads the indexer, and the indexer fetches the backend's JWKS. A loop cannot
// be written as consts that hold each other, so `dependsOn` starts empty, gets filled once every
// record in the loop exists, and is checked again. The build reports the loops as `cycle`
// problems. That report is the finding. It is not a mistake in this file.

import { Schema } from "effect";
import {
  ComponentSpec,
  ConceptSpec,
  defineComponent,
  defineConcept,
  defineEnvironment,
  defineSystem,
  type Ref,
} from "../../../packages/book/src/index.ts";

/** Fill a record's `dependsOn` after the records it loops with exist, then check it again. */
const wire = <K extends "component" | "concept">(
  record: { readonly dependsOn: Ref<K>[] },
  spec: typeof ComponentSpec | typeof ConceptSpec,
  deps: readonly Ref<K>[],
): void => {
  record.dependsOn.push(...deps);
  Schema.decodeUnknownSync(spec as never)(record);
};

const OPS = "apps/docs/factory/operations";

// ── system ──────────────────────────────────────────────────────────────────────────────────

export const system_capxul = defineSystem({
  id: "capxul",
  title: "Capxul",
  about:
    "A TypeScript platform for account, identity, payment and Organization capabilities: a Core SDK, a React SDK, " +
    "a Convex backend, the shared protocol, contracts and the applications that compose them. People and agents reach it " +
    "through the `capxul` CLI, the Core SDK, the React SDK, the MCP server and the backend's HTTP routes (bootstrap, OAuth, " +
    "Bridge webhook, waitlist). The actors are the kinds of caller the old book's `who:` lines name. The old context map " +
    "says the product is 16 concepts, but it lists 17 backend folders.",
  actors: [
    { id: "anyone", kind: "person", about: "Anyone, with no sign-in: help, schema, login with an email address, choosing an environment." },
    { id: "person", kind: "person", about: "A signed-in person acting for themselves, from their personal Safe; a person Capxul has admitted from the waitlist." },
    { id: "founder", kind: "person", about: "The founder of an Organization, who acts for it while setup is unfinished and holds the Shareholders' top hat until equity is installed." },
    { id: "member", kind: "person", about: "A member of an Organization, acting with `--org`; what they may do depends on the Permissions and hats they hold (Manage books, issue invoices)." },
    { id: "director", kind: "person", about: "A Director of an Organization: an owner of its Safe whose personal Safe wears the Director hat; an elected Director claims the seat." },
    { id: "board", kind: "person", about: "The Board: the Directors acting together at the Safe's threshold, for top budgets, exits and grants." },
    { id: "office-holder", kind: "person", about: "The wearer of a hat in an Organization: a budget's or department's office holder, or the People or Invoicing hat." },
    { id: "payer", kind: "person", about: "The payer of a payment, request or invoice: a signed-in person, or for an Organization the wearer of the budget's hat or above." },
    { id: "payee", kind: "person", about: "The person or Organization that is owed: issues requests and invoices, and collects agreement pay from their personal Safe." },
    { id: "invitee", kind: "person", about: "The person an Organization invitation was sent to." },
    { id: "investor", kind: "person", about: "An invited or allocated investor in an Organization's round." },
    { id: "shareholder", kind: "person", about: "A shareholder of an Organization, voting and converting shares from a personal Safe." },
    { id: "grantee", kind: "person", about: "The holder of an equity grant, who exercises it." },
    { id: "owner", kind: "person", about: "The owner of an agent (who creates, freezes, sweeps and removes it), or of a fixed-price service." },
    { id: "developer", kind: "person", about: "Someone building on Capxul: mints test keys and drives the local devnet (`dev` commands) on the machine that runs it." },
    { id: "operator", kind: "person", about: "A Capxul operator with the deploy key: grants waitlist invites, runs diagnostics, faucets, probes and devnet fixtures." },
    { id: "agent", kind: "agent", about: "An agent with its own Capxul account and Safe, owned by a person, signing in on the machine that holds its key." },
    { id: "ai-seat", kind: "agent", about: "An agent holding an AI Seat in an Organization, with a Permission such as Manage books." },
    { id: "assistant", kind: "agent", about: "An AI assistant acting as the person: an MCP client with the person's OAuth token, or the Claude Code plugin over the CLI." },
    { id: "system-job", kind: "system", about: "A scheduled or cron job of the backend; it acts with no signed-in actor and reports `system_job`." },
    { id: "bridge", kind: "system", about: "Bridge, the banking provider, posting encrypted events to the backend's `/rails/bridge/webhook` route." },
  ],
  surfaces: ["cli", "sdk", "react", "mcp", "http"],
  was: [
    "CONTEXT-MAP.md:6",
    "CONTEXT-MAP.md:29",
    "apps/cli/package.json:12",
    "packages/sdk/README.md:3",
    "packages/sdk-react/README.md:3",
    "apps/mcp/README.md:3",
    "apps/plugin/README.md:3",
    "packages/backend/convex/http.ts:32",
    "packages/backend/convex/http.ts:93",
    `${OPS}/schema.yaml:8`,
    `${OPS}/auth.login.yaml:11`,
    `${OPS}/agent.list.yaml:7`,
    `${OPS}/payment.send.yaml:9`,
    `${OPS}/referral.invite.yaml:11`,
    `${OPS}/org.retry.yaml:8`,
    `${OPS}/org.allowance.list.yaml:8`,
    `${OPS}/org.allowance.revoke.yaml:8`,
    `${OPS}/org.board.claim.yaml:9`,
    `${OPS}/org.exit.pay.yaml:10`,
    `${OPS}/org.agreement.offer.yaml:50`,
    `${OPS}/org.department.pay.yaml:8`,
    `${OPS}/org.member.invite.yaml:100`,
    `${OPS}/request.cancel.yaml:26`,
    `${OPS}/inbox.pay.yaml:8`,
    `${OPS}/agreement.collect.yaml:8`,
    `${OPS}/request.cancel.yaml:8`,
    `${OPS}/invite.accept.yaml:8`,
    `${OPS}/invest.commit.yaml:8`,
    `${OPS}/shares.convert.yaml:8`,
    `${OPS}/shares.exercise.yaml:10`,
    `${OPS}/agent.show.yaml:8`,
    `${OPS}/dev.snapshot.save.yaml:7`,
    `${OPS}/dev.key.yaml:6`,
    `${OPS}/waitlist.invites.grant.yaml:10`,
    "packages/backend/src/operator/README.md:3",
    `${OPS}/auth.login.yaml:37`,
    `${OPS}/agent.show.yaml:50`,
    `${OPS}/org.books.accounts.reclassify.yaml:8`,
    `${OPS}/org.member.list.yaml:16`,
    "docs/canon/runtime-and-data-flows.md:73",
    "packages/backend/src/platform/observation/attribution.ts:53",
    "packages/backend/convex/crons.ts:8",
  ],
});

// ── components ──────────────────────────────────────────────────────────────────────────────

export const component_chain = defineComponent({
  id: "chain",
  title: "Chain",
  about:
    "The EVM chain the contracts live on, reached as Ethereum JSON-RPC over HTTP. On devnet it is an Anvil fork of Base " +
    "Sepolia (chain id 84532) at a pinned block, with the Capxul contracts copied in or deployed by `up`. On staging it is " +
    "Base Sepolia itself, through the configured nodes or the public node https://sepolia.base.org.",
  runtime: "evm",
  exposes: ["http"],
  dependsOn: [],
  was: [
    "apps/docs/factory/components/chain.yaml:3",
    "packages/devnet/README.md:32",
    "packages/devnet/README.md:49",
    "packages/backend/src/integrations/chain-rpc/internal/upstreams.ts:30",
    "packages/tools/src/modules/environments/internal/deployment-topology.json:17",
  ],
});

export const component_aa_gateway = defineComponent({
  id: "aa-gateway",
  title: "AA gateway (bundler and paymaster)",
  about:
    "Gas sponsorship for ERC-4337 user operations. One URL serves the ERC-7677 paymaster methods (`pm_getPaymasterStubData`, " +
    "`pm_getPaymasterData`) and forwards the bundler `eth_*` methods to an `@pimlico/alto` bundler. On staging this is the " +
    "`@capxul/aa-gateway` package: one container runs alto on loopback 4337 and the gateway on its public port, guarded by " +
    "a URL token and a verifying paymaster key. On devnet the same role is played by two plain processes, not this package: " +
    "alto on 4337 and `@pimlico/mock-paymaster` on 4338, in front of it. The old book books these as two components, " +
    "`bundler` (needs chain) and `paymaster` (needs bundler). The backend is its only caller: the SDK never holds a bundler.",
  runtime: "node",
  exposes: ["http"],
  dependsOn: [component_chain],
  was: [
    "packages/aa-gateway/package.json:2",
    "packages/aa-gateway/README.md:3",
    "packages/aa-gateway/README.md:12",
    "packages/aa-gateway/README.md:31",
    "packages/aa-gateway/README.md:42",
    "apps/docs/factory/components/bundler.yaml:3",
    "apps/docs/factory/components/bundler.yaml:5",
    "apps/docs/factory/components/paymaster.yaml:3",
    "apps/docs/factory/components/paymaster.yaml:5",
    "packages/devnet/README.md:33",
    "packages/devnet/README.md:34",
  ],
});

export const component_ponder_indexer = defineComponent({
  id: "ponder-indexer",
  title: "Ponder indexer",
  about:
    "The Ponder 0.17.9 service (`@capxul/indexer`) that indexes the configured Base Sepolia contract facts (Protocol v4 " +
    "from the `@capxul/protocol` address book) into its own PostgreSQL. It serves `/sql/db` and `/sql/live` over HTTP to a " +
    "Convex session JWT (Safes from its signed `safes` claim) or the backend's service bearer, plus Ponder's `/health`, " +
    "`/ready`, `/status` and `/metrics`. Its README says it never calls Convex, but it fetches the backend Site's JWKS " +
    "(`CONVEX_SITE_URL/api/auth/convex/jwks`) to verify session tokens, so it depends on the backend at runtime. The old " +
    "book's manifest says it needs the whole devnet. A `railway.json` for Railway is still in the folder, but staging runs it on Openship.",
  runtime: "ponder",
  exposes: ["http", "sql"],
  dependsOn: [component_chain] as Ref<"component">[],
  was: [
    "apps/indexer/package.json:2",
    "apps/indexer/package.json:7",
    "apps/indexer/README.md:3",
    "apps/indexer/README.md:30",
    "apps/indexer/README.md:66",
    "apps/indexer/README.md:70",
    "apps/indexer/ponder.config.ts:96",
    "apps/indexer/src/auth.ts:24",
    "apps/indexer/src/auth.ts:42",
    "apps/indexer/src/auth.ts:92",
    "apps/indexer/railway.json:2",
    "apps/docs/factory/components/indexer.yaml:3",
    "apps/docs/factory/components/indexer.yaml:6",
  ],
});

export const component_convex_backend = defineComponent({
  id: "convex-backend",
  title: "Convex backend",
  about:
    "The Convex backend (`@capxul/backend`): every Capxul function, the 17 concept folders under `src/`, their " +
    "registrations under `convex/`, plus `src/platform` and `src/integrations/<vendor>`. Its API URL serves queries, mutations, " +
    "live subscriptions and CLI deploys. Its Site URL serves the HTTP routes: bootstrap, Better Auth and JWKS, OAuth " +
    "discovery, login and consent, the quickstart key mint, the SDK telemetry relay (`/v1/client/observe`), the Bridge " +
    "webhook, verification document uploads and the waitlist request form. It calls the chain through `chain-rpc`, the AA " +
    "gateway through `BASE_SEPOLIA_BUNDLER_RPC_URL` (also through `chain-rpc`), and the indexer through `ponder` " +
    "(`INDEXER_URL`). The old book's manifest says it needs only the chain. Outside vendors (Openfort, Bridge, mail, " +
    "PostHog, Chainlink, Companies House) are integrations, not components.",
  runtime: "convex",
  exposes: ["rpc", "http", "ws"],
  dependsOn: [component_chain, component_aa_gateway, component_ponder_indexer],
  was: [
    "packages/backend/package.json:2",
    "packages/backend/package.json:36",
    "apps/docs/factory/components/backend.yaml:3",
    "apps/docs/factory/components/backend.yaml:5",
    "CONTEXT-MAP.md:71",
    "packages/backend/convex/http.ts:32",
    "packages/backend/convex/http.ts:61",
    "packages/backend/convex/http.ts:93",
    "packages/backend/convex/http.ts:113",
    "packages/backend/convex/http.ts:132",
    "packages/backend/convex/http.ts:152",
    "packages/backend/src/integrations/chain-rpc/internal/upstreams.ts:39",
    "packages/backend/src/integrations/ponder/service.ts:61",
    "docs/runbooks/environments.md:155",
  ],
});

wire(component_ponder_indexer, ComponentSpec, [component_convex_backend]);

export const component_core_sdk = defineComponent({
  id: "core-sdk",
  title: "Core SDK",
  about:
    "The imperative TypeScript client (`@capxul/sdk`): `createCapxulClient`, domain method bundles, production adapters " +
    "and the Effect flows behind them. Every public method resolves a `CapxulResult`. It runs in the host's process: Node " +
    "for the CLI and the MCP server, the browser under `@capxul/sdk-react`. It bootstraps from the backend Site, calls " +
    "Convex functions over the Convex client (a WebSocket), and reads the indexer's `/sql/db` directly. It never holds an " +
    "RPC URL, a gas policy or a bundler. Its node-only `@capxul/sdk/devnet` entry is the exception to these paths: it " +
    "reaches the standing devnet guardian's owner-only control socket on the same machine, which no component here records.",
  runtime: "node, browser",
  exposes: ["none"],
  dependsOn: [component_convex_backend, component_ponder_indexer],
  was: [
    "packages/sdk/package.json:2",
    "packages/sdk/README.md:3",
    "docs/canon/runtime-and-data-flows.md:8",
    "packages/sdk/src/platform/production.ts:76",
    "packages/sdk/src/platform/transport/convex-adapter.ts:115",
    "packages/sdk/src/indexing/ponder/reads.ts:203",
    "packages/sdk/src/platform/production-adapters.ts:194",
    "packages/sdk/package.json:52",
    "packages/sdk/src/devnet/index.ts:5",
  ],
});

export const component_cli = defineComponent({
  id: "cli",
  title: "Capxul CLI",
  about:
    "The published `capxul` command (`@capxul/cli`, Node 24+, macOS and Linux). Its commands call the Core SDK. It also " +
    "calls the backend Site directly in three places: native sign-in revoke (`/api/auth/native/revoke`), `dev key` " +
    "(`/v1/client/mint-quickstart-key`), and the loopback wallet page's two upstream calls, which the CLI makes against the " +
    "bootstrap's Better Auth base with the stored session (`/convex/token`, `/encryption-session`). It opens that loopback " +
    "wallet page for commands that sign. `dev time|jobs|snapshot|approve` go through `@capxul/sdk/devnet` to the devnet " +
    "guardian's control socket.",
  runtime: "node",
  exposes: ["cli"],
  dependsOn: [component_core_sdk, component_convex_backend],
  was: [
    "apps/cli/package.json:2",
    "apps/cli/package.json:12",
    "apps/cli/package.json:56",
    "apps/cli/README.md:3",
    "apps/cli/src/platform/capxul.ts:2",
    "apps/cli/src/auth/native-grant-cleanup.ts:45",
    "apps/cli/src/commands/dev/key.ts:68",
    "apps/cli/src/signer/bridge-upstream.ts:114",
    "apps/cli/src/signer/bridge-upstream.ts:124",
    "apps/cli/src/signer/browser-bridge.ts:43",
    "apps/cli/src/commands/dev/world.ts:1",
  ],
});

// ── concepts: the backend folders, each with the concepts it imports today ───────────────────

const B = "packages/backend/src";
const deps = (): Ref<"concept">[] => [];

export const concept_access = defineConcept({
  id: "access",
  title: "Access",
  about:
    "Who is signed in and what a client may do as them: BetterAuth sessions and the OTP send cooldown, the indexer's read " +
    "scope, application consent, native client authorization (the CLI's device flow), agent authorization (OAuth for MCP " +
    "clients) and feature gates. It never provisions a Profile or an Account and never grants command authority. It also " +
    "holds the waitlist (the permissioned beta, CAP-1019) and referral invites (`referrals/`), which its README's opening " +
    "and the context map leave out; the README's shape tree has no `referrals/` entry at all.",
  component: component_convex_backend,
  dependsOn: deps(),
  lines: 7690,
  was: [
    `${B}/access/README.md:3`,
    `${B}/access/README.md:145`,
    `${B}/access/referrals/operations/grant-invites.ts:20`,
    "CONTEXT-MAP.md:39",
    `${B}/access/clients/reads/store.ts:8`,
    `${B}/access/clients/reads/store.ts:9`,
    `${B}/access/features/operations/list.ts:5`,
    `${B}/access/features/reads.ts:10`,
    `${B}/access/clients/reads/store.ts:14`,
  ],
});

export const concept_accounts = defineConcept({
  id: "accounts",
  title: "Accounts",
  about:
    "A person's money identity: one personal Safe per chain, its address a pure function of their email; the logical " +
    "Account bound to it; the claim that installs their signer as the Safe's only owner; the live balance read; test-network " +
    "grants (faucet and staging welcome grants); approvals waiting for the person's signature; and agents, accounts a person owns.",
  component: component_convex_backend,
  dependsOn: deps(),
  lines: 10726,
  was: [
    `${B}/accounts/README.md:3`,
    "CONTEXT-MAP.md:40",
    `${B}/accounts/approvals/operations/approve.ts:6`,
    `${B}/accounts/approvals/operations/open-for-proposal.ts:7`,
    `${B}/accounts/agents/reads/owners.ts:4`,
    `${B}/accounts/agents/external.ts:38`,
    `${B}/accounts/approvals/reads.ts:11`,
    `${B}/accounts/approvals/reads.ts:19`,
    `${B}/accounts/approvals/reads.ts:25`,
    `${B}/accounts/approvals/reads.ts:26`,
  ],
});

export const concept_activity = defineConcept({
  id: "activity",
  title: "Activity",
  about:
    "One actor's feed of money: the page, cursor and totals over its Payments and Movements, the annotations an actor keeps " +
    "on any row, the overlays Convex adds to indexed chain rows, and the exact documents a row carries. It owns one table, " +
    "`activityAnnotations`. Its tests also import `#parties`, but no other file in it does.",
  component: component_convex_backend,
  dependsOn: deps(),
  lines: 1939,
  was: [
    `${B}/activity/README.md:3`,
    "CONTEXT-MAP.md:41",
    `${B}/activity/annotations/operations/save.ts:4`,
    `${B}/activity/guards.ts:9`,
    `${B}/activity/annotations/guards.ts:9`,
    `${B}/activity/documents/reads.ts:13`,
    `${B}/activity/annotations/guards.ts:16`,
    `${B}/activity/annotations/guards.ts:13`,
    `${B}/activity/annotations/guards.ts:18`,
  ],
});

export const concept_applications = defineConcept({
  id: "applications",
  title: "Applications",
  about:
    "The applications a browser bootstraps through and their publishable keys. A browser presents a key to " +
    "`POST /v1/client/bootstrap` and receives the envelope naming this deployment's auth, backend and site. Bootstrap grants " +
    "neither application consent nor Organization authority.",
  component: component_convex_backend,
  dependsOn: deps(),
  lines: 3363,
  was: [
    `${B}/applications/README.md:3`,
    "CONTEXT-MAP.md:42",
    `${B}/applications/keys/guards.ts:10`,
    `${B}/applications/keys/guards.ts:11`,
  ],
});

export const concept_banking = defineConcept({
  id: "banking",
  title: "Banking",
  about:
    "Issued bank details (one receiving account per Party and currency, with full fields under record-bound encryption), " +
    "bank deposits, bank payouts, and the encrypted Bridge event inbox with its classification and catch-up. A bank deposit " +
    "never creates a Payment row. The context map lists only the Bridge intake, but the README also lists details, deposits and payouts.",
  component: component_convex_backend,
  dependsOn: deps(),
  lines: 10951,
  was: [
    `${B}/banking/README.md:3`,
    "CONTEXT-MAP.md:43",
    `${B}/banking/payouts/operations/prepare.ts:15`,
    `${B}/banking/bank-details/reads.ts:8`,
    `${B}/banking/bank-details/reads.ts:9`,
    `${B}/banking/bank-details/operations/get.ts:5`,
    `${B}/banking/payouts/writes/door.ts:12`,
    `${B}/banking/deposits/writes/devnet.ts:16`,
    `${B}/banking/deposits/events/matching.ts:2`,
  ],
});

export const concept_books = defineConcept({
  id: "books",
  title: "Books",
  about:
    "An Organization's chart of accounts, the account each Activity row points to, who may manage the books (Manage books), " +
    "and the facts that record every change (ADR-0042), with the reports, the reconciliation against the Safe and the " +
    "QuickBooks Online export derived from them.",
  component: component_convex_backend,
  dependsOn: deps(),
  lines: 6207,
  was: [
    `${B}/books/README.md:3`,
    "CONTEXT-MAP.md:44",
    `${B}/books/accounts/operations/accept.ts:4`,
    `${B}/books/facts/operations/open.ts:8`,
    `${B}/books/facts/writes/observed.ts:9`,
    `${B}/books/accounts/writes/chart.ts:12`,
    `${B}/books/facts/reads/pages.ts:11`,
    `${B}/books/facts/operations/outside.ts:5`,
  ],
});

export const concept_documents = defineConcept({
  id: "documents",
  title: "Documents",
  about:
    "Exact financial document content: the immutable store of content and envelope pairs (`paymentDocuments`), the links " +
    "naming each document's subject for one actor, the Memo occurrences Movements carry and their fingerprint conflicts. It " +
    "admits a Payment's instruction document against its prepared payable context.",
  component: component_convex_backend,
  dependsOn: deps(),
  lines: 3008,
  was: [
    `${B}/documents/README.md:3`,
    "CONTEXT-MAP.md:45",
    `${B}/documents/guards.ts:5`,
    `${B}/documents/guards.ts:8`,
    `${B}/documents/memos/writes.ts:14`,
    `${B}/documents/memos/guards.ts:13`,
    `${B}/documents/reads/parties.ts:23`,
    `${B}/documents/guards.ts:11`,
    `${B}/documents/guards.ts:12`,
  ],
});

export const concept_indexing = defineConcept({
  id: "indexing",
  title: "Indexing",
  about:
    "Keeps Convex's durable rows true to the chain: reads included ERC-20 Transfer windows into Movements, and compares " +
    "member authority, Permission assignments and settled Payments against the Ponder indexer, correcting only what the " +
    "canonical chain proves. It owns one table, the drift cycle's lease (`driftCycles`). It has no `index.ts` door and no " +
    "entry in the backend's `#<concept>` import map; others reach it only through the catch-all `#*` entry. No concept " +
    "imports it: only its own Convex registrations and `convex/schema.ts` (for `indexingTables`) do.",
  component: component_convex_backend,
  dependsOn: deps(),
  lines: 2134,
  was: [
    `${B}/indexing/README.md:3`,
    "CONTEXT-MAP.md:46",
    "packages/backend/package.json:8",
    "packages/backend/package.json:24",
    "packages/backend/convex/schema.ts:35",
    `${B}/indexing/drifts/reads.ts:24`,
    `${B}/indexing/drifts/reads.ts:31`,
    `${B}/indexing/drifts/operations/apply-account-corrections.ts:4`,
    `${B}/indexing/drifts/external.ts:18`,
  ],
});

export const concept_media = defineConcept({
  id: "media",
  title: "Media",
  about:
    "Uploaded images (ADR-0014): the upload URL a client posts a blob to, and the rule that admits a stored blob as an " +
    "image. The Profile and the Organization own the rows an image is bound to.",
  component: component_convex_backend,
  dependsOn: deps(),
  lines: 189,
  was: [
    `${B}/media/README.md:3`,
    "CONTEXT-MAP.md:47",
    `${B}/media/images/writes.ts:8`,
    `${B}/media/images/guards.ts:5`,
    `${B}/media/images/writes.ts:13`,
  ],
});

export const concept_operator = defineConcept({
  id: "operator",
  title: "Operator",
  about:
    "Tools for Capxul's own operators and proof runs, never for a person using Capxul: deployment diagnostics, the receipt " +
    "hold, proof identities, the test-token faucet, devnet fixtures, tenancy probes, the devnet mail sink and its fail " +
    "switch, notice delivery records. It has no `index.ts` door and no entry in the `#<concept>` import map; others reach " +
    "it only through the catch-all `#*` entry. No concept imports it: only its own Convex registrations and " +
    "`convex/schema.ts` (for `operatorTables`) do.",
  component: component_convex_backend,
  dependsOn: deps(),
  lines: 2437,
  was: [
    `${B}/operator/README.md:3`,
    "CONTEXT-MAP.md:48",
    "packages/backend/package.json:8",
    "packages/backend/package.json:24",
    "packages/backend/convex/schema.ts:49",
    `${B}/operator/diagnostics/rules.ts:4`,
    `${B}/operator/faucets/external.ts:7`,
    `${B}/operator/identities/guards.ts:9`,
    `${B}/operator/fixtures/operations/seed-deposit.ts:5`,
    `${B}/operator/identities/guards.ts:10`,
    `${B}/operator/faucets/operations/mint-to-recipient.ts:7`,
    `${B}/operator/fixtures/writes.ts:16`,
    `${B}/operator/identities/guards.ts:13`,
    `${B}/operator/fixtures/writes.ts:20`,
    `${B}/operator/identities/guards.ts:16`,
  ],
});

export const concept_organizations = defineConcept({
  id: "organizations",
  title: "Organizations",
  about:
    "A workspace: its identity and setup, its members, roles, treasury and the invitations that bring people in, plus " +
    "directors, equity, rounds, proposals and votes. It decides who may act on an Organization and what an offer to a new " +
    "member is. The old repository calls it the reference concept.",
  component: component_convex_backend,
  dependsOn: deps(),
  lines: 30477,
  was: [
    `${B}/organizations/README.md:3`,
    "CONTEXT-MAP.md:49",
    `${B}/organizations/equity/operations/approve-transfer.ts:5`,
    `${B}/organizations/directors/reads.ts:8`,
    `${B}/organizations/setups/writes/begins.ts:11`,
    `${B}/organizations/directors/reads.ts:9`,
    `${B}/organizations/directors/external.ts:42`,
    `${B}/organizations/invitations/guards.ts:6`,
    `${B}/organizations/members/writes/grants.ts:9`,
    `${B}/organizations/invitations/external.ts:18`,
  ],
});

export const concept_parties = defineConcept({
  id: "parties",
  title: "Parties",
  about:
    "Counterparty identity: one Party per mailbox, Safe address and global handle (ADR-0022), `claimed` or `provisional`; " +
    "the contact edges and the engagements Payroll pays; receiving destinations; recipient resolution from a handle, " +
    "mailbox, address or Party id; and verification. Its tests also import `#payments`, but no other file in it does.",
  component: component_convex_backend,
  dependsOn: deps(),
  lines: 9793,
  was: [
    `${B}/parties/README.md:3`,
    "CONTEXT-MAP.md:50",
    `${B}/parties/contacts/reads.ts:9`,
    `${B}/parties/contacts/reads.ts:11`,
    `${B}/parties/guards.ts:10`,
    `${B}/parties/verifications/operations/deliver-person-invite.ts:11`,
  ],
});

export const concept_payments = defineConcept({
  id: "payments",
  title: "Payments",
  about:
    "Money that moves from an Account's or an Organization's Safe: the Payment ledger of record, the command that births " +
    "or advances a Payment, the sponsored UserOperation its signer signs, the one send of that operation, the verification " +
    "that applies what the chain proved, and the Movements the chain shows for a Safe. It imports 11 of the 16 other concepts.",
  component: component_convex_backend,
  dependsOn: deps(),
  lines: 26505,
  was: [
    `${B}/payments/README.md:3`,
    "CONTEXT-MAP.md:51",
    `${B}/payments/commands/operations/prepare-intent.ts:8`,
    `${B}/payments/commands/guards.ts:5`,
    `${B}/payments/movements/reads/movements.ts:17`,
    `${B}/payments/commands/writes/organizations.ts:9`,
    `${B}/payments/commands/writes/books.ts:10`,
    `${B}/payments/commands/writes/documents.ts:6`,
    `${B}/payments/commands/reads/recipients.ts:2`,
    `${B}/payments/commands/reads/recipients.ts:3`,
    `${B}/payments/guards/budgets.ts:12`,
    `${B}/payments/commands/external/funding.ts:15`,
    `${B}/payments/commands/reads/funding.ts:14`,
  ],
});

export const concept_payroll = defineConcept({
  id: "payroll",
  title: "Payroll",
  about:
    "Paying an Organization's people: the run of record, its items and progression, the saved rosters an employer pays " +
    "again, and the rate in force for each open engagement; also pay agreements and departments. Its README says it owns " +
    "three tables (`payrollRuns`, `payrollItems`, `payrollGroups`) and nothing that moves money, but its `tables.ts` " +
    "defines eight: those three plus `payrollDepartments`, `payrollDepartmentChanges`, `payrollAgreements`, " +
    "`payrollAgreementPayeeWrites` and `payrollAgreementNotices`, and its agreements build sponsored Safe user operations " +
    "through `#payments`.",
  component: component_convex_backend,
  dependsOn: deps(),
  lines: 14796,
  was: [
    `${B}/payroll/README.md:3`,
    `${B}/payroll/README.md:5`,
    `${B}/payroll/tables.ts:167`,
    `${B}/payroll/tables.ts:227`,
    `${B}/payroll/tables.ts:264`,
    `${B}/payroll/tables.ts:305`,
    `${B}/payroll/tables.ts:313`,
    `${B}/payroll/tables.ts:323`,
    "CONTEXT-MAP.md:52",
    `${B}/payroll/agreements/operations/cancel-change.ts:5`,
    `${B}/payroll/agreements/reads/context.ts:10`,
    `${B}/payroll/agreements/reads/context.ts:16`,
    `${B}/payroll/agreements/reads/context.ts:18`,
    `${B}/payroll/agreements/external.ts:23`,
    `${B}/payroll/departments/reads.ts:13`,
  ],
});

export const concept_permissions = defineConcept({
  id: "permissions",
  title: "Permissions",
  about:
    "Who may do what with an Organization's money and people: the Permissions (spending allowances, still `budget` in code, " +
    "and `managePeople`), their assignments to a person's Account, the commands that change them on chain through the " +
    "Safe's Zodiac Roles module, and the receipt-verified record of what the chain holds.",
  component: component_convex_backend,
  dependsOn: deps(),
  lines: 18929,
  was: [
    `${B}/permissions/README.md:3`,
    "CONTEXT-MAP.md:53",
    "CONTEXT-MAP.md:64",
    `${B}/permissions/authorities/guards.ts:3`,
    `${B}/permissions/allowances/operations/create.ts:13`,
    `${B}/permissions/allowances/reads.ts:17`,
    `${B}/permissions/authorities/operations/budget-left.ts:13`,
    `${B}/permissions/reads/departments.ts:4`,
  ],
});

export const concept_profiles = defineConcept({
  id: "profiles",
  title: "Profiles",
  about:
    "A person's own metadata: display name, country, photo, the withdrawal address and whether they have onboarded, in one " +
    "`identities` row per BetterAuth user linked to the person's Party.",
  component: component_convex_backend,
  dependsOn: deps(),
  lines: 865,
  was: [
    `${B}/profiles/README.md:3`,
    "CONTEXT-MAP.md:54",
    `${B}/profiles/onboardings/operations/complete.ts:3`,
    `${B}/profiles/onboardings/writes.ts:8`,
    `${B}/profiles/onboardings/reads.ts:6`,
    `${B}/profiles/details/reads.ts:5`,
  ],
});

export const concept_requests = defineConcept({
  id: "requests",
  title: "Requests",
  about:
    "Asking to be paid and paying from a link: requests and Invoices an issuer sends, lists and cancels; the payer's inbox " +
    "to review, approve or decline them; fixed-price services (still `offers` in code) with immutable revisions; and link " +
    "checkout from the payer's own wallet, verified on chain.",
  component: component_convex_backend,
  dependsOn: deps(),
  lines: 9017,
  was: [
    `${B}/requests/README.md:3`,
    "CONTEXT-MAP.md:55",
    "CONTEXT-MAP.md:58",
    `${B}/requests/guards.ts:9`,
    `${B}/requests/checkouts/external/escrows.ts:20`,
    `${B}/requests/reads/links.ts:11`,
    `${B}/requests/writes/money-invoices.ts:9`,
    `${B}/requests/writes/invoices.ts:18`,
    `${B}/requests/guards.ts:10`,
    `${B}/requests/reads/checkouts.ts:21`,
    `${B}/requests/checkouts/operations/prepare-request-registered.ts:4`,
    `${B}/requests/receivables/reads/notices.ts:21`,
    `${B}/requests/receivables/reads/notices.ts:22`,
    `${B}/requests/reads/requests.ts:5`,
  ],
});

// The imports as they are, in the order of each `was` above.
wire(concept_access, ConceptSpec, [concept_accounts, concept_applications, concept_organizations, concept_parties, concept_profiles]);
wire(concept_accounts, ConceptSpec, [
  concept_access, concept_organizations, concept_parties, concept_payments, concept_payroll, concept_permissions, concept_profiles,
  concept_requests,
]);
wire(concept_activity, ConceptSpec, [
  concept_access, concept_accounts, concept_books, concept_documents, concept_organizations, concept_payments, concept_permissions,
]);
wire(concept_applications, ConceptSpec, [concept_access, concept_organizations]);
wire(concept_banking, ConceptSpec, [
  concept_access, concept_accounts, concept_organizations, concept_parties, concept_payments, concept_profiles, concept_requests,
]);
wire(concept_books, ConceptSpec, [
  concept_access, concept_accounts, concept_banking, concept_organizations, concept_parties, concept_payments,
]);
wire(concept_documents, ConceptSpec, [
  concept_access, concept_accounts, concept_books, concept_organizations, concept_parties, concept_payments, concept_requests,
]);
wire(concept_indexing, ConceptSpec, [concept_accounts, concept_organizations, concept_payments, concept_permissions]);
wire(concept_media, ConceptSpec, [concept_organizations, concept_permissions, concept_profiles]);
wire(concept_operator, ConceptSpec, [
  concept_access, concept_accounts, concept_applications, concept_banking, concept_organizations, concept_parties, concept_payments,
  concept_permissions, concept_profiles, concept_requests,
]);
wire(concept_organizations, ConceptSpec, [
  concept_access, concept_accounts, concept_media, concept_parties, concept_payments, concept_permissions, concept_profiles,
  concept_requests,
]);
wire(concept_parties, ConceptSpec, [concept_access, concept_organizations, concept_permissions, concept_requests]);
wire(concept_payments, ConceptSpec, [
  concept_access, concept_accounts, concept_activity, concept_banking, concept_books, concept_documents, concept_organizations,
  concept_parties, concept_payroll, concept_permissions, concept_requests,
]);
wire(concept_payroll, ConceptSpec, [
  concept_access, concept_accounts, concept_organizations, concept_parties, concept_payments, concept_permissions,
]);
wire(concept_permissions, ConceptSpec, [
  concept_accounts, concept_organizations, concept_parties, concept_payments, concept_payroll,
]);
wire(concept_profiles, ConceptSpec, [concept_access, concept_accounts, concept_media, concept_parties]);
wire(concept_requests, ConceptSpec, [
  concept_access, concept_accounts, concept_applications, concept_banking, concept_documents, concept_organizations, concept_parties,
  concept_payments, concept_payroll, concept_permissions, concept_profiles,
]);

// ── environments ────────────────────────────────────────────────────────────────────────────

export const environment_devnet = defineEnvironment({
  id: "devnet",
  title: "Devnet",
  about:
    "The whole stack on one machine from one command (`@capxul/devnet`); the backend's runtime identity is `local`, " +
    "telemetry labels it `devnet`. The runbook calls it per worktree and per agent, but the devnet README and code make it " +
    "singular per machine: fixed loopback ports, one standing root under /tmp, and a second `up` refuses. Plain processes " +
    "for chain, bundler, paymaster and backend, with no Docker; the standing indexer keeps its database in PGlite inside " +
    "its slot. `up` installs Protocol v4 only, through the companies-house tool. " +
    "Browser mode adds the reserved e2e sign-in, a fixed local application and key, seeded owner and recipient identities, " +
    "and an owner-only `browser.env` handoff. Bridge calls reach Bridge's sandbox, or a local stand-in with `--bridge-stand-in`. " +
    "Boot time is the measured `up` cost, 40 to 80 s, without the indexer.",
  runs: [
    { component: component_chain, on: "An Anvil fork of Base Sepolia at a pinned block, 127.0.0.1:8545; `up` copies the Roles library in, then Companies House deploys and verifies every Protocol v4 contract. The README still says it copies CapxulPaymentsV3 and the escrow factory." },
    { component: component_aa_gateway, on: "Not the aa-gateway package: an `@pimlico/alto` bundler on 127.0.0.1:4337 (patched for warped clocks) behind `@pimlico/mock-paymaster` on 127.0.0.1:4338." },
    { component: component_convex_backend, on: "A pinned `convex-local-backend` binary with every function deployed: API 127.0.0.1:3210, Site 127.0.0.1:3211." },
    { component: component_ponder_indexer, on: "The standing indexer, `indexer up` in a second terminal, on 127.0.0.1:42069, with a PGlite database inside its slot (no Docker); `indexer down` removes it with the slot." },
    { component: component_core_sdk, on: "Inside the CLI, the MCP server and the local frontend on the same machine, bootstrapped from the loopback Site." },
    { component: component_cli, on: "On the same machine after `capxul use env devnet`; the devnet's fixed test key is built in." },
  ],
  config: [
    "CONVEX_SELF_HOSTED_URL",
    "CONVEX_URL",
    "CONVEX_SITE_URL",
    "SITE_URL",
    "CAPXUL_TRUSTED_ORIGINS",
    "INDEXER_URL",
    "BASE_SEPOLIA_RPC_URL",
    "BASE_SEPOLIA_EVIDENCE_RPC_URL",
    "BASE_SEPOLIA_BUNDLER_RPC_URL",
    "BASE_SEPOLIA_RPC_REQUESTS_PER_SECOND",
    "ALCHEMY_GAS_POLICY_ID",
    "CAPXUL_FAUCET_ENABLED",
    "CAPXUL_E2E_AUTH_ENABLED",
    "CAPXUL_PROTOCOL_V4_DEPLOYMENT",
    "CAPXUL_COMPANIES_HOUSE_TIER",
    "CAPXUL_SAFE_SALT_NAMESPACE",
    "CAPXUL_COMPANY_SALT_NAMESPACE",
    "INVITATION_GRANTER_ADDRESS",
    "BRIDGE_WEBHOOK_PUBLIC_KEY",
    "BRIDGE_STAND_IN_URL",
    "CAPXUL_DEVNET_FAULT",
    "CAPXUL_DEVNET_RUN",
    "SENDER_EMAIL",
    "RESEND_TEST_MODE",
    "SCHEDULED_JOB_RETENTION",
    "DOCUMENT_RETENTION_DELAY",
    "INDEX_RETENTION_DELAY",
    "MAX_BYTES_WRITTEN_PER_SECOND",
    "DATABASE_UDF_USER_TIMEOUT_SECONDS",
    "CAPXUL_ENV",
  ],
  secrets: [
    "BETTER_AUTH_SECRET",
    "OPENFORT_PROJECT_ID",
    "OPENFORT_PUBLISHABLE_KEY",
    "OPENFORT_SECRET_KEY",
    "OPENFORT_WALLET_SECRET",
    "SHIELD_PUBLISHABLE_KEY",
    "SHIELD_SECRET_KEY",
    "SHIELD_ENCRYPTION_SHARE",
    "CAPXUL_BOOTSTRAP_OWNER_PRIVATE_KEY",
    "CAPXUL_E2E_OTP",
    "POSTHOG_PROJECT_TOKEN",
    "POSTHOG_HOST",
    "BRIDGE_API_KEY",
    "CONVEX_SELF_HOSTED_ADMIN_KEY",
    "INDEXER_SERVICE_TOKEN",
    "DEPLOYER_PRIVATE_KEY",
    "INVITATION_GRANTER_PRIVATE_KEY",
    "BUDGETS_EXECUTOR_PRIVATE_KEY",
    "CAPXUL_MCP_EXCHANGE_SECRET",
    "CAPXUL_COMPANIES_HOUSE_SERVICE_KEY",
    "CAPXUL_ACCOUNT_SECRETS_KEY",
    "CAPXUL_WEB_DEV_SIGNER_SEED",
    "RESEND_API_KEY",
  ],
  deploy:
    "`node packages/devnet/src/main.ts up` (`capxul-devnet up`, `--json` for agents, `--bridge-stand-in` for a local Bridge " +
    "stand-in, browser mode through `vp run devnet:browser:up`), then `node packages/devnet/src/main.ts indexer up` in a " +
    "second terminal. `reset` clears backend data in about 15 s, Anvil snapshot and revert rewind the chain, `down` stops " +
    "the indexer and then everything else, and `sweep` reports survivors. The first 13 secret names come from the " +
    "`capxul-devnet` Infisical project. The rest are fixed or derived devnet values that the devnet writes into the backend, " +
    "the indexer and `browser.env`, except `RESEND_API_KEY`, which it forwards only when the operator's store has one, " +
    "always in test mode. The retention, write-rate and function-limit names are Convex local-backend settings.",
  bootMs: 80000,
  was: [
    "packages/devnet/package.json:2",
    "packages/devnet/README.md:5",
    "packages/devnet/README.md:21",
    "packages/devnet/README.md:30",
    "packages/devnet/README.md:44",
    "packages/devnet/README.md:49",
    "packages/devnet/README.md:66",
    "packages/devnet/README.md:130",
    "packages/devnet/README.md:211",
    "packages/devnet/README.md:737",
    "packages/devnet/src/modules/devnet/service.ts:58",
    "packages/devnet/src/modules/devnet/service.ts:452",
    "packages/devnet/src/modules/backend/service.ts:470",
    "packages/devnet/src/modules/backend/environment.ts:23",
    "packages/devnet/src/modules/devnet/protocol-v4.ts:155",
    "packages/devnet/src/modules/indexer-slot/environment.ts:13",
    "packages/devnet/src/main.ts:223",
    "packages/devnet/src/modules/ponder/harness.ts:1",
    "packages/devnet/src/modules/devnet/service.ts:361",
    "packages/devnet/src/modules/devnet/service.ts:391",
    "packages/devnet/src/modules/devnet/service.ts:458",
    "packages/devnet/src/modules/devnet/service.ts:488",
    "packages/devnet/src/modules/devnet/service.ts:496",
    "packages/devnet/src/modules/devnet/service.ts:520",
    "packages/devnet/src/modules/devnet/service.ts:525",
    "packages/devnet/src/modules/devnet/protocol-v4.ts:1",
    "packages/devnet/src/modules/devnet/protocol-v4.ts:157",
    "packages/devnet/src/modules/guardian/standing-config.ts:20",
    "packages/devnet/src/modules/backend/service.ts:478",
    "packages/devnet/src/modules/backend/service.ts:562",
    "packages/devnet/src/modules/backend/environment.ts:36",
    "packages/devnet/src/modules/backend/environment.ts:49",
    "packages/devnet/src/modules/backend/environment.ts:64",
    "packages/devnet/src/modules/backend/faults.ts:21",
    "packages/devnet/README.md:124",
    "docs/runbooks/environments.md:30",
    "packages/tools/src/modules/environments/internal/deployment-topology.json:30",
    "apps/docs/factory/components/devnet.yaml:3",
    "apps/docs/factory/components/devnet.yaml:5",
    "apps/docs/factory/components/indexer.yaml:5",
    "docs/runbooks/environments.md:8",
    "docs/runbooks/environments.md:45",
  ],
});

export const environment_staging = defineEnvironment({
  id: "staging",
  title: "Staging",
  about:
    "The one standing tier: merged code, together, allowed to break, on Base Sepolia until the Arbitrum move. It is self-hosted " +
    "on Capxul's Openship (AWS eu-west-1). There is no hosted Convex, and beta and production are not provisioned. The topology " +
    "file pins the API, Site, JWKS, chain id and the application, Openfort and Shield fingerprints, which bootstrap checks " +
    "before OTP. Staging uses a test-mode Openfort project. The browser app at app.staging.capxul.com is released from " +
    "another repository. The MCP server also runs here, as `capxul-mcp` at mcp.staging.capxul.com.",
  runs: [
    { component: component_convex_backend, on: "Self-hosted Convex in Openship project `Capxul backend`: `convex-backend` at convex.staging.capxul.com (API) and `convex-site` at api.staging.capxul.com (Site)." },
    { component: component_aa_gateway, on: "Openship service `aa-gateway` in `Capxul backend` at aa.capxul.com: one container with alto on loopback 4337 and the gateway on port 8080." },
    { component: component_ponder_indexer, on: "Openship service `ponder` in its own project on the Ireland worker, at indexer.capxul.com, with its own PostgreSQL; the old `ponder` in `Capxul backend` restarted on 18 Oct 2026." },
    { component: component_chain, on: "Base Sepolia (chain id 84532), the public testnet, through the configured nodes or https://sepolia.base.org." },
    { component: component_core_sdk, on: "The published npm package, inside the staging web app, the CLI and the MCP server." },
    { component: component_cli, on: "The published npm package on the person's machine, after `capxul use env staging`." },
  ],
  config: [
    "APP_ENV",
    "CONVEX_SELF_HOSTED_URL",
    "CONVEX_URL",
    "CONVEX_SITE_URL",
    "SITE_URL",
    "CAPXUL_TRUSTED_ORIGINS",
    "CAPXUL_CHECKOUT_FRONTEND_ORIGIN",
    "SENDER_EMAIL",
    "RESEND_TEST_MODE",
    "INDEXER_URL",
    "OPENFORT_AUTH_PROVIDER",
    "REDACT_LOGS_TO_CLIENT",
    "CAPXUL_DEPLOYED_GIT_SHA",
    "CAPXUL_E2E_AUTH_ENABLED",
    "CAPXUL_STAGING_WELCOME_FUNDING_ENABLED",
    "CAPXUL_FAUCET_ENABLED",
    "CAPXUL_DEV_IDENTITY_CAPABILITY",
    "CAPXUL_TEST_ONLY_TENANCY_CAPABILITY",
    "OTP_COOLDOWN_MS",
    "INVITATION_GRANTER_ADDRESS",
    "POSTHOG_HOST",
    "BASE_SEPOLIA_RPC_URLS",
    "BASE_SEPOLIA_LOG_RPC_URLS",
    "BASE_SEPOLIA_RPC_URL",
    "BASE_SEPOLIA_EVIDENCE_RPC_URL",
    "CAPXUL_ENV",
    "INDEXER_START_BLOCK_FLOOR",
    "PONDER_DEPLOYMENT_SCHEMA",
  ],
  secrets: [
    "CONVEX_SELF_HOSTED_ADMIN_KEY",
    "BETTER_AUTH_SECRET",
    "OPENFORT_SECRET_KEY",
    "OPENFORT_PUBLISHABLE_KEY",
    "OPENFORT_WALLET_SECRET",
    "OPENFORT_PROJECT_ID",
    "SHIELD_PUBLISHABLE_KEY",
    "SHIELD_SECRET_KEY",
    "SHIELD_ENCRYPTION_SHARE",
    "CAPXUL_BOOTSTRAP_OWNER_PRIVATE_KEY",
    "INVITATION_GRANTER_PRIVATE_KEY",
    "DEPLOYER_PRIVATE_KEY",
    "BUDGETS_EXECUTOR_PRIVATE_KEY",
    "RESEND_API_KEY",
    "AGENTMAIL_API_KEY",
    "POSTHOG_PROJECT_TOKEN",
    "CAPXUL_MCP_EXCHANGE_SECRET",
    "CAPXUL_E2E_OTP",
    "BASE_SEPOLIA_BUNDLER_RPC_URL",
    "BASE_SEPOLIA_ALCHEMY_RPC_URL",
    "BASE_SEPOLIA_INFURA_RPC_URL",
    "BASE_MAINNET_RPC_URL",
    "INDEXER_SERVICE_TOKEN",
    "DATABASE_URL",
    "AA_GATEWAY_TOKEN",
    "AA_PAYMASTER_SIGNER_PRIVATE_KEY",
    "CAPXUL_E2E_PUBLISHABLE_KEY",
    "CAPXUL_E2E_ORIGIN",
    "CAPXUL_E2E_BOOTSTRAP_URL",
  ],
  deploy:
    "Backend: the Release workflow (`.github/workflows/release.yml`) runs the full gate, checks the staging tuple and the " +
    "Organization setup rows, runs `convex deploy`, records `CAPXUL_DEPLOYED_GIT_SHA`, migrates Movement inclusion state " +
    "and probes the client contract, in about six minutes. Its trigger differs between the runbooks. environments.md says " +
    "a push to `master` or a Release dispatch from `integration/*` with `release_candidate=true`. deploy.md says every " +
    "push to `integration/main` (CAP-1020). Runtime config changes only through `APP_ENV=staging vp run env:apply`, which " +
    "writes allowlisted names and never deploys code. Indexer and MCP server: publish a GHCR image with " +
    "`publish-capxul-migration-images.yml` and deploy its digest on Openship. AA gateway: its Dockerfile builds the image " +
    "Openship runs. `BASE_SEPOLIA_BUNDLER_RPC_URL` carries the gateway token, so it is listed as a secret. The backend " +
    "names are the ones `env:apply` writes (required, optional and fixed) plus `INDEXER_URL`; the indexer's are on its " +
    "Openship service, 14 of 16 stored as secret. The last three secrets are not runtime values: the operator's " +
    "`capxul-staging` worker profile requires them for proof runs.",
  was: [
    "docs/runbooks/environments.md:3",
    "docs/runbooks/environments.md:9",
    "docs/runbooks/environments.md:25",
    "docs/runbooks/environments.md:69",
    "docs/runbooks/environments.md:84",
    "docs/runbooks/environments.md:110",
    "docs/runbooks/environments.md:142",
    "docs/runbooks/environments.md:155",
    "docs/runbooks/environments.md:161",
    "docs/runbooks/environments.md:187",
    "docs/runbooks/deploy.md:38",
    "docs/runbooks/deploy.md:53",
    "docs/runbooks/deploy.md:66",
    "docs/runbooks/deploy.md:72",
    "docs/runbooks/deploy.md:78",
    "docs/runbooks/deploy.md:302",
    "docs/runbooks/deploy.md:361",
    "docs/runbooks/deploy.md:368",
    "docs/runbooks/deploy.md:505",
    "packages/tools/src/modules/environments/internal/deployment-topology.json:5",
    "packages/tools/src/modules/environments/internal/deployment-topology.json:49",
    "packages/tools/src/modules/environments/internal/convex-env-plan.ts:7",
    "packages/tools/src/modules/environments/internal/convex-env-plan.ts:27",
    "packages/tools/src/modules/environments/internal/convex-env-plan.ts:124",
    "docs/runbooks/deploy.md:310",
    "docs/runbooks/deploy.md:679",
    "apps/indexer/README.md:30",
    "packages/aa-gateway/README.md:31",
    "packages/aa-gateway/README.md:40",
    "apps/indexer/README.md:42",
    "apps/indexer/README.md:72",
    "packages/backend/src/integrations/ponder/service.ts:61",
  ],
});
