// The target book's bottom layer: the system and its actors, the ten running components, the 23
// target concepts and the two environments. Every judgment here is a decision record in
// ./decisions.ts; docs/decisions/target-architecture.md explains them for a reader.
//
// The concept map is a DAG: each concept is defined after every concept it depends on, so a
// dependency cycle cannot even be written here (and the build's `cycle` rule checks it again).
// `dependsOn` lists the only concepts whose tables a concept may read and whose procedures it may
// invoke. A concept that must learn of another's change without depending on it does not: the
// dependency always points from the concept that reacts to the concept that changed.
//
// OPERATION_OWNERS, at the end, names the concept that designs each of the 215 frozen operations:
// TypeScript refuses this file if one is missing, except an operation the cut classified (shared/cut.ts).

import { Schema } from "effect";
import {
  defineComponent,
  defineConcept,
  defineEnvironment,
  defineSystem,
  type Concept,
} from "../../packages/blueprint-engine/src/index.ts";
import type { FrozenId } from "../baseline/index.ts";
import type { CUT } from "./cut.ts";

const OLD = "packages/backend/src";

// ── system ──────────────────────────────────────────────────────────────────────────────────

export const system_capxul = defineSystem({
  id: "capxul",
  title: "Capxul",
  about:
    "Company money and governance on chain, for people and their agents. People reach it through the `capxul` CLI, the " +
    "Core SDK, the React SDK, the MCP server and a few HTTP routes (the browser bootstrap, OAuth for MCP clients, Bridge's " +
    "webhook). Every action that moves money or authority is a UserOperation from the actor's own Safe on Protocol v4, " +
    "sponsored by Capxul's paymaster. The rebuild keeps every frozen operation of the old book and changes everything " +
    "below it. Actors are the kinds of caller the frozen `who:` lines name, as v4 has them.",
  actors: [
    { id: "anyone", kind: "person", about: "Anyone, with no sign-in: help, schema, login with an email address, choosing an environment, the bootstrap." },
    { id: "person", kind: "person", about: "A signed-in person acting for themselves from their own Safe; admitted from the waitlist or by a referral." },
    { id: "founder", kind: "person", about: "The founder of an Organization: approves its install batch and wears the Shareholders' top hat until equity is installed." },
    { id: "member", kind: "person", about: "A member of an Organization (a Seat), acting with `--org`; what they may do comes from the hats their Safe wears." },
    { id: "office-holder", kind: "person", about: "The wearer of a hat in an Organization: a budget's office hat, or the Books, Invoicing or People officer hat." },
    { id: "director", kind: "person", about: "A Director: wears the Director hat and signs the company Safe through the Signer Gate; an elected Director claims the seat." },
    { id: "board", kind: "person", about: "The Board: the Directors acting together at the Gate's threshold, through Board proposals." },
    { id: "payer", kind: "person", about: "Who pays a payment, request or invoice: a signed-in person, or for an Organization the wearer of the budget's hat or above." },
    { id: "payee", kind: "person", about: "The person or Organization that is owed: issues requests and invoices, accepts and collects agreements." },
    { id: "invitee", kind: "person", about: "The person or agent an Organization invitation, or a business verification invitation, was sent to." },
    { id: "investor", kind: "person", about: "An invited investor in an Organization's round or SAFE." },
    { id: "shareholder", kind: "person", about: "A shareholder: holds, converts, sells and votes shares from their own Safe." },
    { id: "grantee", kind: "person", about: "The holder of an option or vesting grant, who accepts and exercises it." },
    { id: "owner", kind: "person", about: "The owner of an agent (a person, or an Organization through its Board), or of a fixed-price service." },
    { id: "developer", kind: "person", about: "Someone building on Capxul: mints test keys and drives a local devnet." },
    { id: "operator", kind: "person", about: "A Capxul operator with the deploy key: admits people from the waitlist and grants invites." },
    { id: "agent", kind: "agent", about: "An agent with its own account and Safe, owned through AgentOwner, signing with its own key; it may hold a Seat." },
    { id: "assistant", kind: "agent", about: "An AI assistant acting as the person: an MCP client with the person's OAuth grant, or a plugin over the CLI." },
    { id: "system", kind: "system", about: "Capxul's own durable work: a workflow started by a transition, a chain event, a timer or a cron, acting for no caller." },
    { id: "bridge", kind: "system", about: "Bridge, the banking partner, posting signed events to the backend's webhook route." },
  ],
  surfaces: ["cli", "sdk", "react", "mcp", "http"],
  // What every event, log row and metric carries (decision signals.envelope).
  envelope: Schema.Struct({
    capxul_env: Schema.Literals(["devnet", "shared-world", "development", "staging", "production", "unknown"]),
    world_id: Schema.NullOr(Schema.String),
    trace_id: Schema.String,
    producer: Schema.String,
    org_id: Schema.NullOr(Schema.String),
    actor: Schema.NullOr(Schema.String),
  }),
  was: ["docs/as-is/archive/shared/foundation.ts", "CONTEXT-MAP.md:29"],
});

// ── components: what runs (a DAG) ───────────────────────────────────────────────────────────

export const component_chain = defineComponent({
  id: "chain",
  title: "Chain",
  about:
    "The EVM chain Protocol v4 lives on, reached as Ethereum JSON-RPC over HTTP. Base Sepolia (chain id 84532) on staging, " +
    "with a fresh v4 deployment (P9); an Anvil fork of Base Sepolia at a pinned block on a devnet, with v4 deployed by " +
    "Companies House at `up`. Nothing pre-v4 is deployed or read.",
  runtime: "evm",
  exposes: ["http"],
  dependsOn: [],
  was: ["apps/docs/factory/components/chain.yaml:3"],
});

export const component_postgres = defineComponent({
  id: "postgres",
  title: "Postgres",
  about:
    "The one database (A1). Two schemas: `app`, the concepts' tables, each with a generated row-level security policy (P8), " +
    "reached by a role without BYPASSRLS that sets the tenant with SET LOCAL in every transaction; and `ponder`, written only " +
    "by Ponder, exposed to `app` as Safe-scoped views. It also holds the durable workflow state (A2), the transition outbox " +
    "and stored files (media).",
  runtime: "postgres",
  exposes: ["sql"],
  dependsOn: [],
});

export const component_ponder = defineComponent({
  id: "ponder",
  title: "Ponder indexer",
  about:
    "The Ponder service that indexes Protocol v4's events, the ERC-20 Transfers of admitted assets, the EntryPoint's " +
    "UserOperationEvents and the Safe, Hats and Signer Gate events the product uses, into the `ponder` schema of the same " +
    "Postgres. It serves only its own health and metrics: Capxul reads its tables through views, never through its HTTP " +
    "SQL endpoints, and it never calls the backend (the old JWKS fetch, and the component cycle it made, are gone).",
  runtime: "ponder",
  exposes: ["http"],
  dependsOn: [component_chain, component_postgres],
  was: ["apps/indexer/README.md:3", "apps/indexer/src/auth.ts:145"],
});

export const component_bundler_paymaster = defineComponent({
  id: "bundler-paymaster",
  title: "Bundler and paymaster",
  about:
    "ERC-4337 UserOperation sending and gas sponsorship behind one URL: the ERC-7677 paymaster methods and the bundler's " +
    "`eth_*` methods. On staging, the AA gateway (alto behind a verifying paymaster that sponsors only calls to Capxul's v4 " +
    "contracts and the Safe's own modules); on a devnet, alto behind the mock paymaster. The backend is its only caller.",
  runtime: "node",
  exposes: ["http"],
  dependsOn: [component_chain],
  was: ["packages/aa-gateway/README.md:3"],
});

export const component_backend = defineComponent({
  id: "backend",
  title: "Backend",
  about:
    "One Effect 4 service on Node (A1): the 23 concepts' rpcs as one generated RpcGroup over HTTP (live rpcs over a " +
    "WebSocket), the few HTTP routes (bootstrap, OAuth, Bridge's webhook, and a connected Frappe head's signed doorbell, " +
    "`organizations.heads.ring`), and the concepts' durable processes on " +
    "Effect Workflow and Cluster with Postgres storage (A2, behind a spike; DBOS is the fallback). Every rpc runs in one " +
    "transaction (A3). The runtime resolves a session or assistant token by its hash in that transaction (no JWKS), " +
    "admits a browser origin by the bootstrap's origin token or TRUSTED_ORIGINS, writes each transition's event to the " +
    "outbox in that transaction and has one relay send it on, and wakes a waiting process by its key (rules.process-wakeups). It reads Ponder's tables in the same Postgres, and calls the chain, the bundler and paymaster, and the vendors " +
    "through integrations. That is the staging and production shape; in a devnet and a shared world the same rpcs run " +
    "as the lean world service on one SQLite file with the chain reader folded in (devnet.lean-world; where its code " +
    "lives waits on devnet.core-service-home).",
  runtime: "node",
  exposes: ["rpc", "http", "ws"],
  dependsOn: [component_postgres, component_ponder, component_chain, component_bundler_paymaster],
  was: ["packages/backend/package.json:2"],
});

export const component_core_sdk = defineComponent({
  id: "core-sdk",
  title: "Core SDK",
  about:
    "The TypeScript client (A4): it owns every flow (one SDK method per operation that composes rpcs and local steps) and " +
    "all signing (the Openfort embedded signer in a browser, the agent's own key or a dev signer in Node). It calls only " +
    "the backend, through the generated RPC client: never the indexer, the chain or the bundler. It runs in Node for the CLI " +
    "and the MCP server and in the browser under the React SDK. Its Node-only devnet entry talks to the devnet " +
    "supervisor's control socket (the `devnet-control` integration).",
  runtime: "node, browser",
  exposes: ["none"],
  dependsOn: [component_backend],
  was: ["packages/sdk/README.md:3"],
});

export const component_react_sdk = defineComponent({
  id: "react-sdk",
  title: "React SDK",
  about:
    "React hooks over the Core SDK: flows as actions and live rpcs as subscriptions. It holds no logic of its own and calls " +
    "nothing but the Core SDK. The approval page, where a person signs an approval, is built on it.",
  runtime: "browser",
  exposes: ["none"],
  dependsOn: [component_core_sdk],
  was: ["packages/sdk-react/README.md:3"],
});

export const component_cli = defineComponent({
  id: "cli",
  title: "Capxul CLI",
  about:
    "The published `capxul` command, frozen surface. Each command calls exactly one Core SDK method (A4) and prints its " +
    "result; it holds no orchestration and calls no backend route itself. For a command that signs as a person it opens " +
    "the approval page; an agent signs with its own key.",
  runtime: "node",
  exposes: ["cli"],
  dependsOn: [component_core_sdk],
  budgets: { startMs: 300 },
  was: ["apps/cli/README.md:3"],
});

export const component_mcp_server = defineComponent({
  id: "mcp-server",
  title: "MCP server",
  about:
    "The MCP product surface: tools over Core SDK methods, for an assistant acting as a person with that person's OAuth " +
    "grant (access). A Core SDK host like the CLI.",
  runtime: "node",
  exposes: ["http"],
  dependsOn: [component_core_sdk],
  was: ["apps/mcp/README.md:3"],
});

export const component_devnet = defineComponent({
  id: "devnet",
  title: "Devnet supervisor",
  about:
    "The process that boots a whole world on one machine (Anvil and the lean world service: one small Capxul service on one " +
    "SQLite file that reads the chain itself, with no Postgres and no Ponder, devnet.lean-world; alto with the mock paymaster " +
    "only in the canary world, thin-line.bundler), deploys v4, and saves and restores named worlds (the chain and the world's " +
    "database file together) and the clocks, through an owner-only control socket. Eval worlds are its snapshots. Nothing in " +
    "staging depends on it.",
  runtime: "node",
  exposes: ["cli", "http"],
  dependsOn: [component_chain, component_bundler_paymaster, component_backend],
  was: ["packages/devnet/README.md:5"],
});

export const component_frappe_app = defineComponent({
  id: "frappe-app",
  title: "The Capxul app that lives on every hosted Frappe site",
  about:
    "A custom Frappe app (no fork of Frappe, ERPNext, Frappe HR, Frappe CRM or the WhatsApp app: every join is a hook) that " +
    "Capxul installs on the site it hosts for each Organization (aaron.frappe-native, aaron.one-door). It is where the plugs " +
    "meet Frappe. Sign-in: a Social Login Key points at Capxul's provider, sign-up is denied, and a User exists only because a " +
    "hat created it. Roles follow hats: hat events create and change Users and their roles, and a hand edit of a role or a " +
    "feature is refused for every user. The signer: a Payment Entry from the Safe's bank account is held until the chain " +
    "confirms; ledger hooks refuse any other credit to the Safe. Books from the chain: `capxul.api.chain_event` applies the " +
    "ordered events, once each. Feature switches: Capxul Feature rows and a request guard that answers 403 for a part that " +
    "is off. The names-only rename: Capxul's translation rows for en-GB and a title hook; nothing reports usage outward. The " +
    "door's whitelisted methods run a call as the calling person. Its hat-to-role map ships inside the app and is not editable " +
    "on a site. Proven on a real site by spikes/skeleton (FINDINGS: Frappe half, CRM and feature switches).",
  runtime: "python (Frappe Framework v16)",
  exposes: ["http"],
  dependsOn: [],
});

/** The service that creates, changes, saves and restores the sites on a bench. */
export const component_site_service = defineComponent({
  id: "site-service",
  title: "The site service: creates and runs the Frappe sites Capxul hosts",
  about:
    "Runs beside the backend on the machine that holds the bench (docs/mission/cloud.md): it creates a company's site from the " +
    "images the bench already holds (a new site took 143 s in the spike, 7 s to repeat for the same slug), switches a feature, " +
    "reads a site, drops one, sets and advances a world's clock on a site, and saves and restores a site's database and files for " +
    "a snapshot. The backend asks it over HTTP and never touches the bench. It is not Frappe's Press: the spike's script is what " +
    "it runs, wrapped. One bench serves many sites; Frappe picks the site from the hostname, so one catch-all route reaches every " +
    "company (the spike shows Frappe picking the site from the hostname with `<slug>.localhost`; that OpenShip can register a wildcard route is an assumption, docs/mission/cloud.md: Not determined, settled by the first request through the route in m3b-create-machine). Every app Capxul supports is installed on every site, and a " +
    "feature switch only controls what is reachable (sites.features-reachability).",
  runtime: "node (and the Frappe bench's bench CLI)",
  exposes: ["http"],
  dependsOn: [component_backend],
});

// ── concepts: the target map (each after everything it depends on) ─────────────────────────

const B = component_backend;

export const concept_access = defineConcept({
  id: "access",
  title: "Access",
  about:
    "Who is calling. Owns principals (a person, known by their email; an agent, known by its Safe), sessions and their " +
    "revocation, sign-in by an emailed code (with the send cooldown) and by an agent's signed challenge, MCP clients' OAuth " +
    "grants (one durable process per assistant grant), and feature gates (flags synced from PostHog, per person or " +
    "Organization); the old device flow's native client grants are not ported, and the CLI only deletes its v1 grant " +
    "records. It also books the commands that touch only this machine's CLI state: the environment, the current " +
    "person, telemetry consent, `schema` and `whoami`. It depends on nothing: an agent's sign-in is proved on chain (its key " +
    "must be the one owner of a Safe that AgentOwner controls), not by reading agents' tables. It never grants authority " +
    "over money (hats and budgets do), never admits a person (accounts) and never records an application's consent " +
    "(applications). `auth login` and `auth verify` are accounts' flows over its sign-in rpcs, because they report the " +
    "account's setup. Old access, less the waitlist and referrals, application consent and the indexer read scope.",
  component: B,
  dependsOn: [],
  was: [`${OLD}/access/README.md:3`],
});

export const concept_media = defineConcept({
  id: "media",
  title: "Media",
  about:
    "Stored files: the upload a client makes, and the rule that admits a stored file as an image (a logo, a photo) or a " +
    "document (an identity document for verification), with its type and size limits and its retention. Files live in " +
    "Postgres. Whoever uses a file points at it (an Organization's logo, a person's photo, a verification's documents); " +
    "media points at no one, so it depends only on access, for who uploaded. Old media, plus the storage of old parties' " +
    "verification documents.",
  component: B,
  dependsOn: [concept_access],
  was: [`${OLD}/media/README.md:3`, `${OLD}/parties/README.md:3`],
});

export const concept_parties = defineConcept({
  id: "parties",
  title: "Parties",
  about:
    "The directory: one Party for each identity Capxul can name and pay: a person (by mailbox, provisional until they " +
    "sign in), an agent, an Organization or an outside address. A Party has a handle where it has one (one namespace for " +
    "agents and Organizations), the Safe that money sent to it lands in, and its owner (a person or an Organization). This " +
    "is the Safe-ownership table P8 scopes every chain read by. It also owns a person's profile (display name, country and " +
    "photo) and recipient resolution (a handle, mailbox, address or Party id to a Party and " +
    "its Safe). Organizations and agents register their Party in their own birth transaction (`parties.register`): a name " +
    "and the Safe it routes money to are one money fact. Old parties' identity, destinations and resolution, and all of " +
    "old profiles. Its contacts move to contacts, its verification to banking; payroll's agreements replace its engagements.",
  component: B,
  dependsOn: [concept_access, concept_media],
  was: [`${OLD}/parties/README.md:3`, `${OLD}/profiles/README.md:3`],
});

export const concept_indexing = defineConcept({
  id: "indexing",
  title: "Indexing",
  about:
    "The indexed chain. Owns Ponder's read model as Safe-scoped views (tenancy `chain`, joined to parties' Safes): the v4 " +
    "contracts' events and the read models built from them (PaymentSent, ERC-20 Transfers, UserOperationEvent, Budgets, " +
    "Agreements, escrows, Hats wearers, Safe owners and approvals, the Installer's deployments, Companies House claims and " +
    "mints, AgentOwner, the equity contracts) and the indexer's progress. Ponder alone writes them; every other concept reads " +
    "them here and is triggered by their chain events. It has no workflow: a token an Organization adds at run time, which " +
    "Ponder has no source for, is scanned by books, the concept that knows it was added. The old drift reconcile goes: " +
    "nothing copies chain rows any more, so nothing drifts. Old indexing, old payments' Movement scans and old permissions' " +
    "receipt-verified chain record.",
  component: B,
  dependsOn: [concept_parties],
  was: [`${OLD}/indexing/README.md:3`],
});

export const concept_approvals = defineConcept({
  id: "approvals",
  title: "Approvals",
  about:
    "Every UserOperation from a person's or an agent's own Safe (v4 D1: every action comes from a personal Safe). An " +
    "approval is born with the calls it carries and a summary for the approval page, inside the transaction of the concept " +
    "that prepares it (`approvals.open`: the intent and the instrument that carries it on chain are one fact). Then one " +
    "durable process per approval sponsors it through the paymaster, waits for its owner's signature (a signal), sends it " +
    "once on its own nonce key, follows it to the chain and ends it only on chain proof (landed, reverted, expired, " +
    "displaced) or a decline. Its `approval_transitioned` event tells the opening concept the outcome. It never decides " +
    "authority: the chain does (hats, Roles, Budgets). The approval page and `dev approve` read it. Old payments' executions " +
    "and provider sends, old accounts' approvals and lanes, and the executions old permissions and invitations borrowed.",
  component: B,
  dependsOn: [concept_access, concept_indexing],
  was: [`${OLD}/payments/README.md:3`, `${OLD}/accounts/README.md:3`],
});

export const concept_accounts = defineConcept({
  id: "accounts",
  title: "Accounts",
  about:
    "A person's way into Capxul and their own Safe. Owns admission (the waitlist, an operator's admissions, referral invites " +
    "and the invites a referrer earns, counted from the chain's Safe claims, and the admission an Organization invitation " +
    "or money waiting in a claim escrow gives, through `accounts.admit` in the invitation's or the escrow's transaction), the sign-in commands (`auth login` and `auth verify` " +
    "are its flows over access' sign-in rpcs, because they answer with the account's setup), the personal Safe's setup (its address a pure " +
    "function of the email; Companies House's claim role installs the person's signer; the claim escrows waiting for them " +
    "are collected; one durable process per setup) and test-network grants (the faucet and welcome grants, refused on " +
    "production). Whether a Safe is claimed is also on chain (CapxulSafeClaimed), so a lower concept never needs accounts " +
    "to know it. Old accounts' Safes, claims and grants, and old access' waitlist and referrals; its approvals go to " +
    "approvals, its agents to agents, its balance reads to activity.",
  component: B,
  dependsOn: [concept_access, concept_parties, concept_indexing, concept_approvals],
  was: [`${OLD}/accounts/README.md:3`, `${OLD}/access/README.md:145`],
});

export const concept_organizations = defineConcept({
  id: "organizations",
  title: "Organizations",
  about:
    "A workspace. Owns an Organization's record and its setup (Companies House mints the company Safe; the Installer deploys " +
    "its hats, Roles and Signer Gate; the founder approves the install batch; one durable process per setup), its deployment " +
    "(the hat ids, Roles, Gate and Budgets wiring the install produced), its members (Seats, human or agent) and invitations " +
    "(invite, accept, decline, resend, cancel, expire; an invitation admits its invitee to the beta through " +
    "`accounts.admit`; the Board proposal of its grants is budgets'), and `use org`. It answers who is a member and which officer hat is which, so every concept above it " +
    "can authorize an Organization tenant. A Seat held by an agent ends when the chain shows the agent removed " +
    "(AgentRemoved). It keeps the seat limit (ten, plus what an operator raised or the Organization bought): seats " +
    "bought are counted through its doors `organizations.add-bought-seats` and `organizations.return-bought-seats`, " +
    "for the settlement of a seat purchase (organizations.buy-seats). It owns the Organization's Frappe apps (`org head " +
    "app list|add|remove`), its head connection (`org head connect|show|disconnect`) and its hosted FDE's hosting " +
    "(org-fdes, org-fde-payments, org-fde-asks; `org fde show|ask`), whose months move through its doors " +
    "`organizations.extend-fde-hosting` and `organizations.return-fde-hosting` when payments settles or reverses an " +
    "`org fde pay`; any member, or a guest the management names (org-fde-guests; `org fde guest add|remove|list`), " +
    "may ask its FDE, which acts only as its asker (aaron.fde-anyone). Its " +
    "document family (`org head doc`, `org head doctype`, `org head doc-call`; org-doc-calls) reaches what lives only on the head, as " +
    "the member's own head User (aaron.sdk-reaches-everything). It registers the Organization's Party at birth. " +
    "Old organizations' identity, setups, lifecycles, members, roles and invitations; its Directors and proposals go to " +
    "board, its equity, rounds and votes to equity, its treasury reads to activity.",
  component: B,
  dependsOn: [concept_access, concept_media, concept_parties, concept_indexing, concept_approvals, concept_accounts],
  was: [`${OLD}/organizations/README.md:3`],
});

export const concept_board = defineConcept({
  id: "board",
  title: "Board",
  about:
    "The Board: the company Safe acting at its Signer Gate threshold. Owns the Directors (seated by the wearer of the " +
    "Shareholders' top hat before equity, claimed when elected, handed over, refreshed), the threshold, Board proposals (one " +
    "company Safe transaction each, approved by each Director's own `approveHash` and executed with the last approval; one " +
    "durable process per proposal) and the officer hats (Books, Invoicing, People), granted and revoked by proposal " +
    "(`org member grant`, `org member revoke`). The grants an invitation offers are proposed by budgets, which also sees " +
    "the allowances among them. A concept that needs the Board opens a proposal inside its own transaction " +
    "(`board.propose`: the intent and the proposal that carries it are one fact) and follows `proposal_transitioned`. Old " +
    "organizations' directors and proposals, and old permissions' managePeople, now the People hat.",
  component: B,
  dependsOn: [concept_access, concept_parties, concept_indexing, concept_approvals, concept_organizations],
  was: [`${OLD}/organizations/README.md:3`, `${OLD}/permissions/README.md:3`],
});

export const concept_agents = defineConcept({
  id: "agents",
  title: "Agents",
  about:
    "Agents: accounts of their own that a person or an Organization owns through AgentOwner. Owns each agent's record and " +
    "lifecycle (create, freeze, unfreeze, rotate key, sweep, remove): an approval from the owner's Safe, or a Board proposal " +
    "when an Organization owns it. An agent registers its Party (handle and Safe) at birth and signs in through access with " +
    "its own key. Split from old accounts.",
  component: B,
  dependsOn: [
    concept_access, concept_parties, concept_indexing, concept_approvals, concept_accounts, concept_organizations, concept_board,
  ],
  was: [`${OLD}/accounts/README.md:3`],
});

export const concept_budgets = defineConcept({
  id: "budgets",
  title: "Budgets",
  about:
    "Money authority inside an Organization (v4 Budgets): the budget tree per token and period (top budgets, departments, " +
    "teams and spending allowances, which are all budgets), each budget's office hat and its holders, amounts, close and " +
    "reopen, and the payout ceiling per token (the Roles allowance on the payout role, with its freeze and unfreeze). A " +
    "change is a Board proposal or the parent office holder's own approval. It answers, from the chain, who may spend from " +
    "which budget and what it has left. It also proposes the grants an Organization invitation offers, and takes them " +
    "back when the offer ends with them on chain (`org member invite` is its flow: organizations' invitation, then one " +
    "Board proposal of every grant it offers, officer hats and allowances, existing or new), because only budgets can " +
    "plan an allowance. Old permissions' allowances, assignments and invitation grant configurations, old payroll's " +
    "departments and their changes, and the payout ceilings.",
  component: B,
  dependsOn: [concept_access, concept_parties, concept_indexing, concept_approvals, concept_organizations, concept_board],
  was: [`${OLD}/permissions/README.md:3`, `${OLD}/payroll/README.md:3`],
});

export const concept_books = defineConcept({
  id: "books",
  title: "Books",
  about:
    "What is left of the books in Capxul once ERPNext owns them (cut.books, aaron.frappe-native): the chain reader's half. " +
    "ERPNext Accounts, in each company's site, owns the chart of accounts and Cost Center trees, the GL, Journal and Payment " +
    "Entries, the reports (Balance Sheet, Profit and Loss, Trial Balance, General Ledger), bank reconciliation and every " +
    "export, reached through the door (`doc`, `report run`). Capxul keeps what only it knows: the append-only money facts " +
    "read from the chain, numbered without a gap per Organization so a site can follow the feed and never skip one; the " +
    "annotations that give a Payment or Movement its account, party, cost centre and memo (`activity annotate`); and the " +
    "tokens an Organization watches, scanned at run time (Ponder has no source for an added token; P3 keeps the cron). " +
    "Payments and banking write a money fact's book fact in their own transaction (`books.record-money-fact`, " +
    "`books.reverse-money-fact`; one live fact per money fact); books never reads payments back. ERPNext alone holds the " +
    "chart of accounts, the cost centres and the Company's accounting settings, on the Organization's site " +
    "(books.chart-owner): Capxul keeps no copy, and an annotation names the site's Accounts (books.annotate-site-chart). Old books' facts, old activity's annotations and the added-token Movement scan.",
  component: B,
  dependsOn: [concept_access, concept_indexing, concept_organizations],
  was: [`${OLD}/books/README.md:3`, `${OLD}/activity/README.md:3`],
});

export const concept_documents = defineConcept({
  id: "documents",
  title: "Documents",
  about:
    "Exact financial document content: the immutable content and envelope behind every document hash a payment, request or " +
    "agreement stamps on chain, who may read it (its participants, given when it is stored), the Memos a Movement carries, " +
    "and rendering, export and verification. The concept that births a document's subject stores it in the same " +
    "transaction (`documents.store`): a hash on chain with no content behind it is a money bug. It no longer reads " +
    "payments, requests or books. Old documents.",
  component: B,
  dependsOn: [concept_access, concept_parties, concept_indexing, concept_organizations],
  was: [`${OLD}/documents/README.md:3`],
});

export const concept_contacts = defineConcept({
  id: "contacts",
  title: "Contacts",
  about:
    "The address book of whoever you act as, a person or an Organization: contacts by handle, email, address or Party, their " +
    "labels, and hide and unhide; and each Organization's CRM in Frappe CRM's shapes (aaron.crm-frappe-shape): contacts and " +
    "organizations (with or without a Party), leads and deals, synced with a connected head, and their conversations on one " +
    "timeline per record: email through the Organization's CRM mailbox, WhatsApp on its own number, calls, notes and " +
    "tasks (contacts.conversations-shape). It sits above organizations " +
    "because an Organization's book needs its membership, and reads indexing because only the People hat's wearers edit " +
    "an Organization's book and CRM (contacts.members-write). A contact's bank accounts are banking's, so `contact get`, " +
    "which returns them, is banking's flow over this concept's read. Split from old parties.",
  component: B,
  dependsOn: [concept_access, concept_parties, concept_indexing, concept_organizations],
  was: [`${OLD}/parties/README.md:3`],
});

export const concept_payments = defineConcept({
  id: "payments",
  title: "Payments",
  about:
    "Money that moves: the Payment ledger of record. Owns payment commands (one request key, one command; born with their " +
    "Payments and documents, after funding is read), the route each Payment takes (a personal `Payments.send`, a budget " +
    "spend, a Board batch, a claim escrow for an email with no account yet, which admits that mailbox to the beta " +
    "through `accounts.admit`, a dated payment), settlement from the indexed " +
    "PaymentSent with every term checked (one path), reversal on a reorg, Payments born from chain facts Capxul did not " +
    "prepare (agreement collections, escrow payouts, Budgets.execute, equity purchases), and Movements (indexed Transfers " +
    "attributed to a Payment, or outside money). A dated payment and a command are each one durable process. A settlement " +
    "writes its book fact in its own transaction. Requests and banking birth their payments through " +
    "`payments.prepare-command`. Old payments, less executions (to approvals) and with no import of payroll or requests.",
  component: B,
  dependsOn: [
    concept_access, concept_parties, concept_indexing, concept_approvals, concept_accounts, concept_organizations, concept_board,
    concept_budgets, concept_books, concept_documents,
  ],
  was: [`${OLD}/payments/README.md:3`],
});

export const concept_banking = defineConcept({
  id: "banking",
  title: "Banking",
  about:
    "Bank rails through Bridge: the identity verification (KYC and KYB) bank transfers need, bank details (a receiving " +
    "account per Party and currency, full fields under record-bound encryption) and the token deposits become, bank " +
    "deposits and the book facts they write, saved bank accounts (yours or a contact's), and bank payouts (a quote, a " +
    "Payment through `payments.prepare-command`, from your Safe or from a budget named with `--from`, signed by the payer " +
    "through approvals, then the payout followed through Bridge's events until it is delivered or returned). Bridge's " +
    "signed webhook events arrive in an encrypted inbox, with a catch-up for missed ones. Matching a deposit to the request " +
    "it paid is requests' operation. `invite accept` is its flow: it routes a business verification invitation " +
    "(`inv_kyb_`) here and every other invitation to organizations. `contact get` is its flow too: the contact's entry " +
    "from contacts, then the bank accounts saved for it here. Old banking, old parties' verification and saved bank " +
    "accounts.",
  component: B,
  dependsOn: [
    concept_access, concept_media, concept_parties, concept_indexing, concept_approvals, concept_organizations, concept_budgets,
    concept_books, concept_contacts, concept_payments,
  ],
  was: [`${OLD}/banking/README.md:3`, `${OLD}/parties/README.md:3`],
});

export const concept_requests = defineConcept({
  id: "requests",
  title: "Requests",
  about:
    "Asking to be paid: requests and Invoices an issuer sends, lists and cancels; the payer's inbox to review, pay or decline " +
    "them; fixed-price services with immutable revisions; link checkout into an invoice escrow for a payer outside Capxul; " +
    "and matching a bank deposit to the request it paid. A request is one durable process. Paying from the inbox births the " +
    "payment through `payments.prepare-command`, from your Safe or from a budget named with `--from`, and the payer signs " +
    "it through approvals (an agent with its own key at once, a person on the approval page); a match marks the deposit " +
    "through `banking.match-deposit`; the paid state follows `payment_transitioned` and the escrow's chain events. An " +
    "Invoice for logged hours marks them through projects' door, `projects.bill-time`, in its own transaction " +
    "(requests.bill-time). Old requests, with the deposit match from banking.",
  component: B,
  dependsOn: [
    concept_access, concept_parties, concept_indexing, concept_approvals, concept_organizations, concept_budgets,
    concept_documents, concept_payments, concept_banking,
  ],
  was: [`${OLD}/requests/README.md:3`],
});

export const concept_applications = defineConcept({
  id: "applications",
  title: "Applications",
  about:
    "How a client finds and uses a deployment: the bootstrap envelope, the deployment's health (`doctor --online`), " +
    "registered applications (a person's or an Organization's), their publishable keys and web origins (the bootstrap's " +
    "origin token), and quickstart test keys (`dev key`). An Organization's keys need the Invoicing hat, so it sits above " +
    "organizations. Old applications; old access' application consent is not ported (its one writer was the device flow).",
  component: B,
  dependsOn: [concept_access, concept_indexing, concept_organizations],
  was: [`${OLD}/applications/README.md:3`],
});

export const concept_activity = defineConcept({
  id: "activity",
  title: "Activity",
  about:
    "The read model of money for whoever you act as: the feed of Payments and Movements (list, get, summary and the change " +
    "cursor), balances valued in fiat, and where to send money (`address`). It reads payments, indexing, budgets, books and " +
    "documents and owns nothing but each reader's change cursor. Old activity, less its annotations, and old accounts' " +
    "balance reads.",
  component: B,
  dependsOn: [
    concept_access, concept_parties, concept_indexing, concept_organizations, concept_budgets, concept_books, concept_documents,
    concept_payments,
  ],
  was: [`${OLD}/activity/README.md:3`],
});

export const concept_notices = defineConcept({
  id: "notices",
  title: "Notices",
  about:
    "Every email Capxul sends after a change: one workflow per notice kind, triggered by a transition of the concept it " +
    "tells about (an invitation sent, a request issued or paid, a dated payment due or failed, an agreement offered, an " +
    "allowance assigned, a proposal waiting for a Director, a referral invite, a round invitation, money waiting in a " +
    "claim escrow with its reminders and its taking back, a payslip, a leave, expense claim or advance waiting or " +
    "decided, a stalled head, a ready FDE), with templates, " +
    "recipients and delivery records (sent, retrying, failed). No other concept sends mail, except access' sign-in code, " +
    "which is the operation itself, and contacts' CRM conversations, which are their own command's (notices.mail-channel). It owns no frozen operation: `dev mail notices` reads its delivery records from the " +
    "devnet concept. The old notify actions of every concept and old operator's delivery records.",
  component: B,
  dependsOn: [
    concept_access, concept_parties, concept_indexing, concept_accounts, concept_organizations, concept_board, concept_budgets,
    concept_payments, concept_banking, concept_requests, 
  ],
  was: [`${OLD}/operator/README.md:3`],
});

export const concept_plugs = defineConcept({
  id: "plugs",
  title: "Plugs",
  about:
    "The joins between Capxul Core and each company's Frappe site. Sign-in: Capxul is the OAuth and OpenID provider each site " +
    "signs in through, and only a person a hat created can sign in. The signer: a payment a person starts in Frappe is held " +
    "until the chain confirms it (prepare, the CANON v1 document hash, waiting, sent, failed, hash mismatch, reversal). Roles " +
    "follow hats: the map from a hat to Frappe roles, the grants it makes, the projection, the drift check, and no hand edits. " +
    "Books from the chain: the ordered outbox of chain events a site applies, its delivery, and the event that can never be " +
    "applied. It owns no money itself: payments still moves it, budgets still limits it, and Frappe's books only follow. Written " +
    "from the spike in spikes/skeleton (FINDINGS) in the cut's stage 3; new in the rebuild.",
  component: B,
  dependsOn: [
    concept_access, concept_parties, concept_indexing, concept_approvals, concept_organizations, concept_budgets, concept_books,
    concept_payments,
  ],
});

export const concept_sites = defineConcept({
  id: "sites",
  title: "Sites",
  about:
    "Each Organization's hosted Frappe site (ERPNext, Frappe HR, Frappe CRM and the WhatsApp app, renamed to Capxul): its life " +
    "(creating, ready, suspended, archived), its feature switches (every supported app is installed on every site; a switch " +
    "controls only what is reachable), and the document door, which is how the CLI and SDK reach Frappe's documents, actions " +
    "and reports as the calling person (aaron.one-door). A site is created because its Organization was set up, never by " +
    "connecting one from outside. It replaces organizations' connected head: the head's tables, process and commands are in " +
    "docs/cut-archive. It does not hold Frappe's data; Frappe does.",
  component: B,
  dependsOn: [concept_access, concept_indexing, concept_organizations, concept_plugs],
});

export const concept_devnet = defineConcept({
  id: "devnet",
  title: "Devnet",
  about:
    "Devnet-only tools, refused on staging and production: signing as another person (`dev approve`), feature gates, " +
    "scripted prices, the mail sink and its fail switch, notices' delivery records (`dev mail notices`), running due jobs " +
    "now, and snapshots and time (through the devnet supervisor). Every devnet-only operation is here, so no production " +
    "concept carries one. Its tables are what the integrations' devnet fakes read and write, so no production concept " +
    "depends on it. Replaces old operator: its faucet goes to accounts (`dev fund`, whose `--org` is refused off a devnet), " +
    "its diagnostics to applications' health, its tenancy probes to the generated tenancy evals, its delivery records to " +
    "notices; its proof identities, fixtures and receipt hold give way to worlds built by running operations and saved " +
    "as snapshots, and to the integrations' fault switches.",
  component: B,
  dependsOn: [concept_access, concept_approvals, concept_organizations, concept_notices, concept_plugs, concept_sites],
  was: [`${OLD}/operator/README.md:3`],
});

/** Every target concept, in dependency order. */
export const CONCEPTS: readonly Concept[] = [
  concept_access, concept_media, concept_parties, concept_indexing, concept_approvals, concept_accounts, concept_organizations,
  concept_board, concept_agents, concept_budgets, concept_books, concept_documents, concept_contacts, concept_payments,
  concept_banking, concept_requests, concept_applications, concept_activity, concept_notices, concept_plugs, concept_sites,
  concept_devnet,
];

// ── environments ────────────────────────────────────────────────────────────────────────────

export const environment_devnet = defineEnvironment({
  id: "devnet",
  title: "Devnet",
  about:
    "The whole stack on one machine from one command, for development and every machine eval. One per machine, on fixed " +
    "loopback ports. A self-contained world (aaron.world-clock): one clock, the supervisor's, frozen or running at a rate " +
    "(one to sixty world seconds a real second, decision devnet.clock-rate), which the chain, the backend, Ponder, the " +
    "stand-ins and a connected head all follow, and nothing it sends leaves the machine (time.world-channels). It runs the " +
    "lean world (devnet.lean-world): one small Capxul service per world on one SQLite file, with the chain reader folded " +
    "in, and no Postgres, no Ponder and no bundler, except the one canary world that keeps the real bundler " +
    "(thin-line.bundler); which package builds that service waits on devnet.core-service-home. Worlds " +
    "are the supervisor's named snapshots of the chain and the service's database file together, with the clock, " +
    "restored in seconds. Devnet-only rpcs (the devnet concept) answer only here and in a shared world. Fakes: the mock paymaster, " +
    "the mail sink, the stand-in WhatsApp, the stand-in head and FDE host, scripted prices and gates, Bridge's sandbox or " +
    "a local stand-in.",
  runs: [
    { component: component_chain, on: "Anvil forking Base Sepolia (84532) at a pinned block, 127.0.0.1:8545; Companies House deploys and verifies every v4 contract at `up`." },
    { component: component_bundler_paymaster, on: "Only in the canary world (devnet.lean-world, point 3): alto on 127.0.0.1:4337 behind the mock paymaster on 127.0.0.1:4338, which sponsors every operation. Other worlds have none." },
    { component: component_backend, on: "The lean world service (devnet.lean-world): one Node process on loopback with one SQLite file and the chain reader folded in (no Postgres, no Ponder), with the devnet integration layers (fakes) and devnet-only rpcs. The Postgres and Ponder design is staging's." },
    { component: component_core_sdk, on: "Inside the CLI, the MCP server and a local browser app on the same machine; its devnet entry reaches the supervisor." },
    { component: component_react_sdk, on: "A local browser app, for the approval page and browser-mode evals." },
    { component: component_cli, on: "On the same machine after `capxul use env devnet`, with the devnet's fixed test identities." },
    { component: component_mcp_server, on: "A local MCP server on loopback, for assistant evals." },
    {
      component: component_devnet,
      on: "The supervisor: its time authority, capxul.devnet/1 on loopback with an owner-only handoff file beside its owner-only socket; `capxul-devnet up [--rate <n>]`, `reset`, `down`.",
    },
    {
      component: component_frappe_app,
      on: "Imitated by the stand-in head (the `frappe-head` integration's fake); a head eval installs it on a local Frappe bench that follows the clock.",
    },
  ],
  config: [
    "CAPXUL_ENV",
    "DATABASE_URL",
    "CHAIN_ID",
    "BASE_SEPOLIA_RPC_URLS",
    "BUNDLER_RPC_URL",
    "PROTOCOL_V4_DEPLOYMENT",
    "COMPANIES_HOUSE_NAMESPACE",
    "SITE_URL",
    "TRUSTED_ORIGINS",
    "SENDER_EMAIL",
    "BRIDGE_URL",
    "OTLP_ENDPOINT",
    "DEVNET_CONTROL_SOCKET",
    "SEAT_PRICE",
    "FDE_HOSTING_PRICE",
    "CAPXUL_RECEIVING_SAFE",
    "FDE_HOST_URL",
    "WHATSAPP_API_URL",
    "CRM_MAIL_DOMAIN",
  ],
  secrets: [
    "SESSION_SIGNING_KEY",
    "RECORD_ENCRYPTION_KEY",
    "COMPANIES_HOUSE_CLAIM_KEY",
    "COMPANIES_HOUSE_TIER_KEY",
    "BUDGETS_EXECUTOR_KEY",
    "ESCROW_RELAYER_KEY",
    "FAUCET_KEY",
    "BRIDGE_API_KEY",
    "BRIDGE_WEBHOOK_PUBLIC_KEY",
    "OPENFORT_PUBLISHABLE_KEY",
    "SHIELD_PUBLISHABLE_KEY",
    "SHIELD_SECRET_KEY",
    "SHIELD_ENCRYPTION_SHARE",
    "FDE_HOST_TOKEN",
    "RESEND_WEBHOOK_SECRET",
  ],
  deploy:
    "`capxul-devnet up` boots everything in order (Postgres, Anvil, v4 through Companies House, Ponder, alto and the mock " +
    "paymaster, the stand-ins, the backend) with the clock running at rate 1, or `--frozen`, `--rate <n>` and `--start-at " +
    "<date>`, and prints the environment for the CLI; `--json` for agents. `capxul-devnet world save|restore " +
    "<name>` snapshots the chain, Postgres and Ponder's state together. The keys are fixed devnet values the supervisor " +
    "writes, funded on Anvil at boot; Bridge's sandbox key comes from the operator's store when a banking eval needs it, " +
    "otherwise the local Bridge stand-in runs. No Docker. Boot from a golden snapshot within 2 minutes (spec 40).",
  bootMs: 120_000,
  was: ["packages/devnet/README.md:5", "docs/spec/40-capxul-team.md"],
});

export const environment_staging = defineEnvironment({
  id: "staging",
  title: "Staging",
  about:
    "Deployment status (10 November 2026): target plan only, not an evidenced new staging deployment. Real: old staging remains separately operated; cloud.md's Convex worker is not this target. Stand-ins: sandbox/test provider accounts, never production money; recipients remain allow-listed. Needs Aaron: host/spend, provider credentials and retirement of old staging. " +
    "The new standing tier: merged code together on Base Sepolia, allowed to break, measured by the `live:*` evals. A fresh " +
    "Protocol v4 deployment through Companies House; nothing is migrated from old staging (P9), which keeps running until " +
    "Aaron turns it off. The host is chosen at the spine (Y3). It runs the backend, one managed Postgres with Ponder on it, " +
    "the AA gateway and the MCP server; the CLI and the SDKs are published packages. A world on the real clock (time.worlds): " +
    "now is its hosts' clock, at rate 1, never moved, because Base Sepolia's time is not Capxul's. It is self-contained by " +
    "its channels (time.world-channels): its mail goes only to the mailboxes MAIL_ALLOWED_RECIPIENTS lists, its WhatsApp " +
    "only from the test numbers WHATSAPP_ALLOWED_NUMBERS lists to their registered recipients, and its FDEs and heads run on their hosts' clocks.",
  runs: [
    { component: component_chain, on: "Base Sepolia (84532), through the configured node list, with a fresh v4 deployment." },
    { component: component_postgres, on: "One managed Postgres on the spine's host, `app` and `ponder` schemas, row-level security on, point-in-time recovery." },
    { component: component_ponder, on: "One Ponder service on the same Postgres, polling Base Sepolia every 2,000 ms." },
    { component: component_bundler_paymaster, on: "The AA gateway container (alto plus the verifying paymaster), its token in the bundler URL." },
    { component: component_backend, on: "The backend service, two or more instances behind one HTTPS endpoint, sharing the workflow engine's Postgres storage." },
    { component: component_core_sdk, on: "The published npm package, inside the CLI, the MCP server and the web app." },
    { component: component_react_sdk, on: "The published npm package, inside the staging web app and its approval page." },
    { component: component_cli, on: "The published npm package on the person's machine, after `capxul use env staging`." },
    { component: component_mcp_server, on: "The MCP server service on the spine's host, at its own HTTPS endpoint." },
    {
      component: component_frappe_app,
      on: "Installed by each Organization's head host on the Frappe site it connects, from the published app; Capxul reaches it over HTTPS.",
    },
  ],
  config: [
    "CAPXUL_ENV",
    "CHAIN_ID",
    "BASE_SEPOLIA_RPC_URLS",
    "PROTOCOL_V4_DEPLOYMENT",
    "COMPANIES_HOUSE_NAMESPACE",
    "PONDER_SCHEMA",
    "PONDER_START_BLOCK",
    "SITE_URL",
    "TRUSTED_ORIGINS",
    "CHECKOUT_ORIGIN",
    "SENDER_EMAIL",
    "BRIDGE_URL",
    "OTLP_ENDPOINT",
    "DEPLOYED_GIT_SHA",
    "SEAT_PRICE",
    "FDE_HOSTING_PRICE",
    "CAPXUL_RECEIVING_SAFE",
    "FDE_HOST_URL",
    "WHATSAPP_API_URL",
    "MAIL_ALLOWED_RECIPIENTS",
    "WHATSAPP_ALLOWED_NUMBERS",
    "CRM_MAIL_DOMAIN",
  ],
  secrets: [
    "DATABASE_URL",
    "SESSION_SIGNING_KEY",
    "RECORD_ENCRYPTION_KEY",
    "BUNDLER_RPC_URL",
    "AA_PAYMASTER_SIGNER_KEY",
    "COMPANIES_HOUSE_CLAIM_KEY",
    "COMPANIES_HOUSE_TIER_KEY",
    "BUDGETS_EXECUTOR_KEY",
    "ESCROW_RELAYER_KEY",
    "FAUCET_KEY",
    "BRIDGE_API_KEY",
    "BRIDGE_WEBHOOK_PUBLIC_KEY",
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
    "CONNECTOR_GATEWAY_TOKEN",
    "OPENFORT_PUBLISHABLE_KEY",
    "SHIELD_PUBLISHABLE_KEY",
    "SHIELD_SECRET_KEY",
    "SHIELD_ENCRYPTION_SHARE",
    "FDE_HOST_TOKEN",
  ],
  deploy:
    "Chosen at the spine (Y3): one pipeline builds the backend, Ponder and MCP images from a merged commit, runs the " +
    "migrations (generated from the book's tables, with their row-level security policies), deploys the images and records " +
    "DEPLOYED_GIT_SHA. v4 is deployed once by Companies House (`companies-house protocol deploy`), and its address book " +
    "entry is committed before the first deploy. Secrets come from the operator's store at deploy; the PostHog key stays " +
    "in the connector gateway.",
  was: ["docs/runbooks/environments.md:3", "docs/decisions/README.md"],
});

export const environment_shared_world = defineEnvironment({
  id: "shared-world",
  title: "Shared world",
  about:
    "A devnet's whole stack run on a host for several people, so one story can be shared (aaron.world-clock; decision " +
    "devnet.shared-world): one chain, one backend, one clock (frozen, or running at a rate: up to four world hours each " +
    "real hour at rate 4), one mail sink and one set of stand-ins. Its owner controls its clock, and anyone else joins " +
    "only by a grant the owner makes for their email, over HTTPS at the world's address. (Seasons, a schedule of starts, " +
    "jumps and resets that ran it like a game, are dropped for now: aaron.seasons-dropped, cut.seasons.) Self-contained: everything " +
    "in it follows its clock, and nothing it sends leaves it (time.world-channels). It runs the devnet build of the " +
    "backend, so devnet-only rpcs answer here too, behind the world's gateway, each by the grant's role.",
  runs: [
    { component: component_chain, on: "Anvil forking Base Sepolia (84532) at a pinned block on the world's host, mined only by its supervisor at the world's now; reached only through the gateway." },
    { component: component_bundler_paymaster, on: "Only when the shared world is the canary world (devnet.lean-world, point 3; thin-line.bundler): alto behind the mock paymaster on the world's host, both following its clock." },
    { component: component_backend, on: "The lean world service (devnet.lean-world) on the world's host, one SQLite file with the chain reader folded in (no Postgres, no Ponder), behind the world's gateway (HTTPS), which admits a request only with a world grant." },
    { component: component_core_sdk, on: "Inside each joiner's CLI and MCP server, pointed at the world by CAPXUL_BOOTSTRAP_URL and carrying the joiner's grant." },
    { component: component_react_sdk, on: "The world's web app, served behind its gateway, for the approval page and browser use." },
    { component: component_cli, on: "On each joiner's machine, with CAPXUL_BOOTSTRAP_URL set to the world's address and CAPXUL_WORLD_GRANT to the joiner's grant file; its CLI home stays there." },
    { component: component_mcp_server, on: "An MCP server on the world's host, behind the gateway." },
    {
      component: component_devnet,
      on: "The world's supervisor: its time authority and capxul.devnet/1 over HTTPS at the world's address, each request answered by its grant's role.",
    },
    {
      component: component_frappe_app,
      on: "Imitated by the stand-in head, or installed on a real Frappe bench that follows the world's clock over HTTPS with a follower grant.",
    },
  ],
  config: [
    "CAPXUL_ENV",
    "DATABASE_URL",
    "CHAIN_ID",
    "BASE_SEPOLIA_RPC_URLS",
    "BUNDLER_RPC_URL",
    "PROTOCOL_V4_DEPLOYMENT",
    "COMPANIES_HOUSE_NAMESPACE",
    "SITE_URL",
    "TRUSTED_ORIGINS",
    "SENDER_EMAIL",
    "BRIDGE_URL",
    "OTLP_ENDPOINT",
    "DEVNET_CONTROL_SOCKET",
    "SEAT_PRICE",
    "FDE_HOSTING_PRICE",
    "CAPXUL_RECEIVING_SAFE",
    "FDE_HOST_URL",
    "WHATSAPP_API_URL",
    "WORLD_URL",
    "CRM_MAIL_DOMAIN",
  ],
  secrets: [
    "SESSION_SIGNING_KEY",
    "RECORD_ENCRYPTION_KEY",
    "COMPANIES_HOUSE_CLAIM_KEY",
    "COMPANIES_HOUSE_TIER_KEY",
    "BUDGETS_EXECUTOR_KEY",
    "ESCROW_RELAYER_KEY",
    "FAUCET_KEY",
    "BRIDGE_API_KEY",
    "BRIDGE_WEBHOOK_PUBLIC_KEY",
    "OPENFORT_PUBLISHABLE_KEY",
    "SHIELD_PUBLISHABLE_KEY",
    "SHIELD_SECRET_KEY",
    "SHIELD_ENCRYPTION_SHARE",
    "FDE_HOST_TOKEN",
    "WORLD_GRANT_KEY",
    "RESEND_WEBHOOK_SECRET",
  ],
  deploy:
    "`capxul-devnet up --shared <name> --public <host> [--rate <n>] [--frozen]` on the world's host boots the devnet's " +
    "stack as `up` does, then serves the world's gateway at the host's HTTPS address, writes the owner's grant and prints " +
    "the world's bootstrap address. `capxul-devnet world grant <email>` writes a joiner's grant file (its holder, its " +
    "mailboxes and their dev signers' keys, never the seed), which the owner hands over outside the world, `world " +
    "grant --follower <name>` a follower's, and `world revoke <email|name>` ends one at the gateway. Worlds are saved " +
    "and restored as on a devnet; the grants stay on the host outside the snapshots, so a restore changes no one's " +
    "access. The keys are devnet values the supervisor writes; WORLD_GRANT_KEY signs the grants. Bridge runs only as the local stand-in, never Bridge's " +
    "sandbox, which keeps its own real clock outside the world. The host is the owner's to choose; nothing in staging or " +
    "production depends on it.",
  bootMs: 120_000,
});

// ── which concept designs each frozen operation ─────────────────────────────────────────────
// The concept whose folder holds the operation record and its implementation (an rpc in that
// concept, or a Core SDK flow in that concept's flows.ts). Areas map to concepts by default; the
// exceptions are marked and decided in `operations.owners`.

/** The concept each old-book area maps to; the per-operation exceptions are in OPERATION_OWNERS. */
export const AREA_CONCEPTS = {
  accounts: concept_accounts,
  activity: concept_activity,
  banking: concept_banking,
  books: concept_books,
  departments: concept_budgets,
  devnet: concept_devnet,
  governance: concept_board,
  organizations: concept_organizations,
  payments: concept_payments,
  payroll: concept_payments,
} as const;
