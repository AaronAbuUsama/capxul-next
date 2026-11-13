// Indexing's tables: Ponder's read model of the chain, as the backend reads it (tenancy `chain`).
//
// Ponder writes the `ponder` schema of the one Postgres and nothing else does (components.ponder).
// Each record below is a view in `app` over Ponder's tables, with a generated row-level security
// policy that joins parties' directory (`parties.safe_address`, `owner_kind`, `owner_id`): an rpc
// sees a row only when a Safe it names belongs to a Party its session's tenant owns; a workflow
// acts for the system and sees every row (decision indexing.scope-by-parties). Nothing in `app`
// holds a foreign key into these views: Ponder rebuilds its schema on a reindex.
//
// Every indexed log is stored once (decision indexing.one-row-per-log): in its typed fact table
// when readers query it by its columns (transfers, chain-payments, user-operations, safe-approvals,
// safe-executions), else in chain-logs, the one decoded log that replaces the old fifteen
// `v4_<contract>_event` evidence tables and `safe_event`. Projections hold what a
// fact log alone cannot answer cheaply: the current state of a Safe, a hat, a budget, an agreement,
// an escrow or an equity position. Reorgs are Ponder's: it rolls back a reorganised block's rows
// and replays the canonical ones, so every view is the chain at Ponder's head
// (decision indexing.reorgs-are-ponders). Finality is the reader's: a fact is final when its block is
// the deployment's finality depth behind `indexer-progress` (or read through `indexer.factsOf`).
//
// No state machine and no event: a status here is the chain's, written by Ponder from a chain
// event, and every concept that reacts is triggered by that chain event (`contract_x.e.<Event>`),
// never by a `<machine>_transitioned` of indexing (decision indexing.no-machines).
//
// Columns are Postgres snake_case. Addresses, hashes and hat ids are lowercase hex strings; uint256
// values (amounts, budget, agreement and escrow ids, nonces) are decimal strings in the smallest
// unit; block times are epoch milliseconds (the block timestamp times 1,000). A log's identity is
// `log_id` = `<chain id>:<tx hash>:<tx log ordinal>`, stable when a reorg re-includes the same
// transaction elsewhere; `log_index` is the block-global index a receipt shows
// (decision indexing.log-identity).

import { Schema } from "effect";
import { defineTable } from "../../packages/blueprint-engine/src/index.ts";
import { concept_indexing } from "../shared/foundation.ts";

const PONDER = "apps/indexer/ponder.schema.ts";
const V4 = "apps/indexer/src/v4";

const S = Schema.String;
const N = Schema.Number;
const Int = Schema.Int;
const B = Schema.Boolean;
const Null = Schema.NullOr;
const Addresses = Schema.Array(S);

/** The identity and place of one indexed log; every fact table starts with these columns. */
const LOG = {
  log_id: S,
  chain_id: Int,
  block_number: Int,
  block_hash: S,
  block_time: N,
  tx_hash: S,
  tx_log_ordinal: Int,
  log_index: Int,
} as const;

/** Where a projection's current state came from: the last log that set it. */
const SET_BY = {
  created_log_id: S,
  last_log_id: S,
  updated_block: Int,
} as const;

/** The scope every Safe-scoped view's policy uses, by the columns that name Safes. */
const scope = (columns: string) =>
  `${columns} = parties.safe_address for a Party whose (owner_kind, owner_id) is the session's tenant; a workflow (the system) reads every row.`;

/** The admissions that scope (above) makes: one read-only clause per Safe column, matched through parties' directory. */
const bySafe = (...columns: string[]) =>
  columns.map((field) => ({
    match: "safe" as const,
    field,
    reads: true,
    writes: false,
    about: `A session whose tenant owns the Safe in \`${field}\` (parties' directory) reads the row; only Ponder writes it (indexing.scope-by-parties).`,
  }));

const BY_TX = (table: string) => ({
  name: `${table}-by-tx`,
  fields: ["chain_id", "tx_hash", "tx_log_ordinal"],
  unique: true,
  for: "`indexer.factsOf`: every fact of one transaction, read together at the finality depth (the one settlement path).",
});

const CANONICAL = "Ponder's: kept while the log is canonical; a reorg removes its row and the replay writes the canonical one.";
const PROJECTION = "Ponder's: one row per object for good, rewritten by each event that changes it and rolled back with a reorg.";

// ── Ponder's progress ───────────────────────────────────────────────────────────────────────

export const table_indexer_progress = defineTable({
  id: "indexer-progress",
  title: "Ponder's progress: how far it has indexed, and whether its views are ready",
  about:
    "One row per indexed chain, over Ponder's own checkpoint and status tables: the last block Ponder has indexed (number, " +
    "hash, time), the chain head its node last reported, and whether the views are ready (false while Ponder backfills " +
    "after a deploy or rebuilds after a reindex, when a read would answer with less than the chain holds). `build_id` " +
    "changes with every reindex. This is what the `indexer` integration's `head` and `awaitBlock` read, so a lagging or " +
    "rebuilding Ponder is a call that fails with a code, never a read that answers with nothing (integrations.indexer). " +
    "The devnet's `dev clock show` reports from it whether the indexer has caught up.",
  was: ["apps/indexer/ponder.config.ts:106", "apps/indexer/README.md:3", "packages/backend/src/integrations/ponder/service.ts:45"],
  concept: concept_indexing,
  tenancy: "chain",
  scope: "Not scoped: one row per chain, Ponder's own progress, which names no Safe; every reader may see it.",
  admits: [
    {
      match: "anyone",
      reads: true,
      writes: false,
      about: "Every reader may see Ponder's progress: it names no Safe and holds nothing private (indexing.scope-by-parties).",
    },
  ],
  fields: Schema.Struct({
    chain_id: Int,
    indexed_block: Int,
    indexed_block_hash: S,
    indexed_block_time: N,
    head_block: Int,
    head_seen_at: N,
    ready: B,
    build_id: S,
    updated_at: N,
  }),
  key: ["chain_id"],
  indexes: [],
  retention: "Ponder's: one row per chain, rewritten as it indexes.",
});

// ── the decoded log ─────────────────────────────────────────────────────────────────────────

/** The contracts whose logs land in chain-logs (the fact tables hold the rest). */
const LOGGED_CONTRACTS = [
  "companies-house-claimer",
  "company-safe-minter",
  "installer",
  "budgets",
  "agreements",
  "escrow-factory",
  "escrow",
  "agent-owner",
  "captable",
  "share-class",
  "vesting",
  "options",
  "rounds",
  "exits",
  "governor",
  "safe",
  "hats",
] as const;

export const table_chain_logs = defineTable({
  id: "chain-logs",
  title: "Chain logs: every other admitted log of Protocol v4, Safe and Hats, decoded",
  about:
    "One row per admitted log that has no typed fact table of its own: every event of the v4 contracts (Companies House's " +
    "claims and mints, the Installer, Budgets, Agreements, the escrow factory and each escrow, AgentOwner, the equity " +
    "clones), the owner, threshold and module events of a Capxul Safe, and the Hats events of a Capxul hat tree. `contract` " +
    "names the record in shared/external.ts and `event` the event as that record names it; `args` are the decoded arguments " +
    "(addresses and hashes lowercase, uints as decimal strings). `safes` lists every Capxul Safe the log concerns: the " +
    "company Safe a v4 event is keyed by (for an equity clone, the company of its Installer deployment, since the clones' " +
    "events do not name it), the Safe that emitted a Safe event, the owner or sender Safe an escrow event names, the Safe an agent event names. A " +
    "log is admitted when its contract is Capxul's, or its Safe, hat tree or escrow is one a Capxul event made known " +
    "(CapxulSafeClaimed, CompanySafeMinted, AgentCreated, MoneyDeployed, EscrowDeployed); Hats events of other trees are " +
    "not indexed. This is the source of the `chainEvent` triggers of every concept above and of `indexer.factsOf`; the " +
    "projections below are built from it. It replaces the old fifteen `v4_<contract>_event` evidence tables and " +
    "`safe_event`, which held the same log shape once per contract. Roles' events are not indexed (indexing.roles-not-indexed).",
  was: [`${V4}/evidence-table.ts:9`, `${V4}/evidence.ts:38`, `${PONDER}:75`, `${PONDER}:152`, `${V4}/schema.ts:1`],
  concept: concept_indexing,
  tenancy: "chain",
  scope: scope("Any of `safes`"),
  admits: bySafe("safes"),
  fields: Schema.Struct({
    ...LOG,
    contract: Schema.Literals(LOGGED_CONTRACTS),
    contract_address: S,
    event: S,
    safes: Addresses,
    args: Schema.Record(S, Schema.Unknown),
  }),
  key: ["log_id"],
  indexes: [
    {
      name: "chain-logs-by-event",
      fields: ["contract", "event", "block_number", "log_index"],
      for: "Each `chainEvent` trigger: one contract event's logs in canonical order, from where its delivery last stopped.",
    },
    BY_TX("chain-logs"),
    {
      name: "chain-logs-by-safe",
      fields: ["safes", "contract", "block_number"],
      for: "The scope join (a GIN index on `safes`), and one company's history of one contract: its votes, rounds, grants and sales.",
    },
  ],
  retention: CANONICAL,
});

// ── money facts ─────────────────────────────────────────────────────────────────────────────

export const table_transfers = defineTable({
  id: "transfers",
  title: "Transfers: every ERC-20 Transfer of the deployment's admitted assets",
  about:
    "One row per Transfer log of an admitted asset (the deployment's money tokens: USDC, EURC and the other test tokens on " +
    "Base Sepolia), from each token's deployment block, whoever sends or receives it, so a Safe's balance is the sum of its " +
    "rows and outside money sent to a Safe before it is deployed is not missed. A token an Organization adds at run time " +
    "is not here: books scans it (concepts.books-token-scan). Payments reads it to tell outside money from a Payment's own " +
    "transfer, activity for a Safe's history, books to reconcile. Replaces the old `transfer` table and `activity_transfer` " +
    "view, whose pre-v4 matching of a Transfer to a V2 PaymentSent is gone (payments matches by the transaction's facts); " +
    "native ETH is not indexed (no frozen operation moves or shows it).",
  was: [`${PONDER}:3`, `${PONDER}:243`, "apps/indexer/ponder.config.ts:23", "apps/indexer/src/native-schema.ts:6"],
  concept: concept_indexing,
  tenancy: "chain",
  scope: scope("`from_address` or `to_address`"),
  admits: bySafe("from_address", "to_address"),
  fields: Schema.Struct({
    ...LOG,
    token: S,
    from_address: S,
    to_address: S,
    amount: S,
  }),
  key: ["log_id"],
  indexes: [
    {
      name: "transfers-by-from",
      fields: ["from_address", "block_number", "log_index"],
      for: "A Safe's outgoing transfers, newest first: activity's feed, books' reconcile, a Safe's balance.",
    },
    {
      name: "transfers-by-to",
      fields: ["to_address", "block_number", "log_index"],
      for: "A Safe's incoming transfers, newest first: outside money, a bank deposit's token, an escrow's funding.",
    },
    BY_TX("transfers"),
  ],
  retention: CANONICAL,
});

export const table_chain_payments = defineTable({
  id: "chain-payments",
  title: "Chain payments: every PaymentSent, with its budget, agreement or escrow",
  about:
    "One row per `Payments.PaymentSent`: on v4 every movement of money ends in one, whoever started it, and it is the fact a " +
    "Payment settles from or is born from (concepts.payments). Every PaymentSent of the deployment's Payments contract is " +
    "here, whatever the token. When the same transaction carries the event that names the payment id, Ponder fills in where " +
    "it came from: `budget_id` from Budgets' Spent or ScheduledPaid (with `scheduled_id`), `agreement_id` from Agreements' " +
    "Collected, `escrow_address` from an escrow's EscrowPaid; each stays null otherwise. So a budget's spends are its rows " +
    "here, with no table of their own. `payment_id` is unique: Payments consumes an id once. Replaces the old `payment` " +
    "table, which v4's handler wrote beside its own evidence row (the same log twice) and whose `commitment` sibling had no " +
    "v4 writer (P9).",
  was: [`${PONDER}:179`, `${PONDER}:212`, `${V4}/payments/handlers.ts:20`, `${V4}/budgets/handlers.ts:6`],
  concept: concept_indexing,
  tenancy: "chain",
  scope: scope("`sender` or `recipient`"),
  admits: bySafe("sender", "recipient"),
  fields: Schema.Struct({
    ...LOG,
    payment_id: S,
    sender: S,
    recipient: S,
    token: S,
    amount: S,
    kind: Int,
    document_hash: S,
    budget_id: Null(S),
    scheduled_id: Null(S),
    agreement_id: Null(S),
    escrow_address: Null(S),
  }),
  key: ["log_id"],
  indexes: [
    {
      name: "chain-payments-by-payment-id",
      fields: ["chain_id", "payment_id"],
      unique: true,
      for: "Settle a Payment by its payment id, and refuse a second birth from the same fact (payments).",
    },
    {
      name: "chain-payments-by-sender",
      fields: ["sender", "block_number", "log_index"],
      for: "A Safe's payments out, newest first: activity, books' reconcile.",
    },
    {
      name: "chain-payments-by-recipient",
      fields: ["recipient", "block_number", "log_index"],
      for: "A Safe's payments in, newest first: activity, a request's payment.",
    },
    {
      name: "chain-payments-by-budget",
      fields: ["budget_id", "block_number"],
      for: "A budget's spends in a period: `org department show` and the tree's spent figures.",
    },
    BY_TX("chain-payments"),
  ],
  retention: CANONICAL,
});

export const table_user_operations = defineTable({
  id: "user-operations",
  title: "User operations: each UserOperationEvent sent from a Capxul Safe",
  about:
    "One row per EntryPoint v0.7 `UserOperationEvent` whose sender is a Capxul Safe (a person's or an agent's, known from " +
    "CapxulSafeClaimed and AgentCreated), whatever paid for it: every approval is sponsored by Capxul's paymaster, but an " +
    "operation that takes an approval's nonce may not be, and it must still be seen. `paymaster` says who paid. `nonce` " +
    "is split into its key (the approval's own nonce key) and sequence. It is the chain proof that ends an approval: the " +
    "event at the approval's sender and nonce lands or reverts it (its own hash) or displaces it (another hash) " +
    "(concepts.approvals). The old indexer did not index it; the old backend read receipts through chain-evidence instead.",
  was: ["packages/backend/src/integrations/chain-evidence/service.ts:76", "packages/backend/src/payments/executions/external/sends.ts:145"],
  concept: concept_indexing,
  tenancy: "chain",
  scope: scope("`sender`"),
  admits: bySafe("sender"),
  fields: Schema.Struct({
    ...LOG,
    user_op_hash: S,
    sender: S,
    paymaster: S,
    nonce_key: S,
    nonce_sequence: S,
    success: B,
    actual_gas_cost: S,
    actual_gas_used: S,
  }),
  key: ["log_id"],
  indexes: [
    {
      name: "user-operations-by-hash",
      fields: ["user_op_hash"],
      unique: true,
      for: "What became of one signed operation, by its hash.",
    },
    {
      name: "user-operations-by-sender-nonce",
      fields: ["sender", "nonce_key", "nonce_sequence"],
      unique: true,
      for: "The operation that used an approval's sender and nonce: its own (landed or reverted) or another's (displaced).",
    },
    BY_TX("user-operations"),
  ],
  retention: CANONICAL,
});

// ── Safes ───────────────────────────────────────────────────────────────────────────────────

export const table_safe_owners = defineTable({
  id: "safe-owners",
  title: "Capxul Safes: owners, threshold, nonce, modules and guard",
  about:
    "One row per Safe a Capxul event made known: a person's (CapxulSafeClaimed: claimed, with their signer), a company's " +
    "(CompanySafeMinted, with its founder's Safe) and an agent's (AgentCreated, with its owner). Its owners, threshold, " +
    "nonce, modules and guard are read by Ponder at the block of each event that changes them (the Safe's setup, " +
    "AddedOwner, RemovedOwner, ChangedThreshold, a module or guard change, an execution), so a Safe deployed before " +
    "Capxul knew it still reads right. For a " +
    "company Safe the owners are the seated Directors' Safes and the Gate its one module and guard; for an agent, " +
    "AgentOwner's state rides on the same row (`agent_owner`, `frozen`, `removed`), so an agent needs no table of its own. " +
    "A person's row existing is the chain's answer to 'is this Safe claimed', which is why no lower concept needs accounts " +
    "for it. Replaces the old `safe` table (its singleton and code-hash checks were for pre-v4 Safes Capxul did not make) " +
    "and old permissions' receipt-verified chain record.",
  was: [`${PONDER}:62`, `${V4}/companies-house-claimer/schema.ts:4`, `${V4}/company-safe-minter/schema.ts:4`, `${V4}/agent-owner/schema.ts:4`, "packages/backend/src/permissions/tables/permissions.ts:239"],
  concept: concept_indexing,
  tenancy: "chain",
  scope: scope("`safe_address`, any of `owners`, or `agent_owner`"),
  admits: bySafe("safe_address", "owners", "agent_owner"),
  fields: Schema.Struct({
    safe_address: S,
    chain_id: Int,
    kind: Schema.Literals(["person", "company", "agent"]),
    deployed: B,
    owners: Addresses,
    threshold: Int,
    nonce: Int,
    modules: Addresses,
    guard: Null(S),
    founder_safe: Null(S),
    agent_owner: Null(S),
    frozen: B,
    removed: B,
    ...SET_BY,
  }),
  key: ["safe_address"],
  indexes: [
    {
      name: "safe-owners-by-owner",
      fields: ["owners", "kind"],
      for: "The company Safes a Director's Safe signs for (a GIN index on `owners`): the Boards a person sits on.",
    },
    {
      name: "safe-owners-by-agent-owner",
      fields: ["agent_owner", "removed"],
      for: "The agents a person's or an Organization's Safe owns: `agent list`, and an agent's sign-in proof beside `AgentOwner.agentOf`.",
    },
  ],
  retention: PROJECTION,
});

export const table_safe_approvals = defineTable({
  id: "safe-approvals",
  title: "Safe approvals: each ApproveHash of a company Safe transaction",
  about:
    "One row per `Safe.ApproveHash` a company Safe emits: a Director's Safe approving the hash of one company Safe " +
    "transaction (a Board proposal, or the founder's install batch). `owner` is the approving Safe. A proposal waits until " +
    "the approvals of current owners reach the threshold; whether those owners are still Directors is the Gate's, read " +
    "live where it matters.",
  was: [`${PONDER}:75`, "apps/indexer/src/abis.ts:12"],
  concept: concept_indexing,
  tenancy: "chain",
  scope: scope("`safe_address` or `owner`"),
  admits: bySafe("safe_address", "owner"),
  fields: Schema.Struct({
    ...LOG,
    safe_address: S,
    safe_tx_hash: S,
    owner: S,
  }),
  key: ["log_id"],
  indexes: [
    {
      name: "safe-approvals-by-safe-tx",
      fields: ["safe_address", "safe_tx_hash", "owner"],
      for: "A Board proposal's approvals so far: which Directors' Safes approved its hash.",
    },
    {
      name: "safe-approvals-by-owner",
      fields: ["owner", "block_number"],
      for: "What a Director's Safe has approved, newest first: the proposals still waiting for them.",
    },
    BY_TX("safe-approvals"),
  ],
  retention: CANONICAL,
});

export const table_safe_executions = defineTable({
  id: "safe-executions",
  title: "Safe executions: each company Safe transaction that ran, by hash and nonce",
  about:
    "One row per `Safe.ExecutionSuccess` or `ExecutionFailure` of a Capxul Safe: the transaction's hash (`safe_tx_hash`), " +
    "whether it succeeded, and the Safe nonce it used (`safe_nonce`, the Safe's nonce before the execution). A Board " +
    "proposal executed, or another transaction at its nonce displaced it; an invitation's grants were minted. A Safe nonce " +
    "is used once, so a hash and a nonce each have at most one row. SafeL2's SafeMultiSigTransaction in the same " +
    "transaction gives the execution's `msg_sender` (an owner executing signs with v=1 as the caller, which emits no " +
    "ApproveHash) and the `threshold` the Safe checked it against; a Safe execution without that log is kept untyped in " +
    "chain-logs instead.",
  was: [`${PONDER}:75`, "apps/indexer/src/abis.ts:12"],
  concept: concept_indexing,
  tenancy: "chain",
  scope: scope("`safe_address`"),
  admits: bySafe("safe_address"),
  fields: Schema.Struct({
    ...LOG,
    safe_address: S,
    safe_tx_hash: S,
    safe_nonce: Int,
    success: B,
    msg_sender: S,
    threshold: Int,
  }),
  key: ["log_id"],
  indexes: [
    {
      name: "safe-executions-by-safe-tx",
      fields: ["safe_address", "safe_tx_hash"],
      unique: true,
      for: "Whether a company Safe transaction (a Board proposal, an install batch, an invitation's grants) ran, and how.",
    },
    {
      name: "safe-executions-by-safe-nonce",
      fields: ["safe_address", "safe_nonce"],
      unique: true,
      for: "Which transaction used a company Safe nonce: a proposal displaced by another executed at its nonce.",
    },
    BY_TX("safe-executions"),
  ],
  retention: CANONICAL,
});

export const table_safe_balances = defineTable({
  id: "safe-balances",
  title: "Safe balances: what each Capxul Safe or escrow holds of each admitted asset",
  about:
    "A view over transfers: for each Safe in safe-owners and each escrow, and each admitted asset, the sum of what it " +
    "received less what it sent, with the block of its last Transfer. Exact because transfers holds every Transfer of the " +
    "asset from its deployment block. Activity's balances and an escrow's funding read it; a send that must not overdraw " +
    "reads `balanceOf` live at build time instead, because the view is the chain at Ponder's head. Replaces the old " +
    "`balance` view, which grouped every address on chain.",
  was: [`${PONDER}:31`],
  concept: concept_indexing,
  tenancy: "chain",
  scope: scope("`address`"),
  admits: bySafe("address"),
  fields: Schema.Struct({
    chain_id: Int,
    address: S,
    token: S,
    balance: S,
    last_block: Int,
  }),
  key: ["chain_id", "address", "token"],
  indexes: [],
  retention: "A view: computed from transfers on every read, nothing stored.",
});

// ── an Organization's deployment and its hats ───────────────────────────────────────────────

export const table_chain_deployments = defineTable({
  id: "chain-deployments",
  title: "Chain deployments: what the Installer made for each company Safe",
  about:
    "One row per company Safe the Installer deployed for: from `MoneyDeployed`, its founder's Safe, the Board's and the " +
    "Shareholders' top hats, the Director hat, the officer hats by position (Books, Invoicing, People), the Roles modifier " +
    "and the Signer Gate; from `EquityDeployed`, once equity is installed, its clones (Captable, Governor, Options, Rounds, " +
    "Exits, Elections). Ponder uses it to attribute what follows to the company: a hat to its tree, an equity clone's " +
    "event to its company Safe. Organizations keeps its own once-written copy of the money half for its setup " +
    "(organizations.deployment-row); equity reads the clones here. Replaces the old `v4_equity_company`.",
  was: [`${V4}/installer/schema.ts:12`, `${V4}/installer/handlers.ts:1`],
  concept: concept_indexing,
  tenancy: "chain",
  scope: scope("`company_safe` or `founder_safe`"),
  admits: bySafe("company_safe", "founder_safe"),
  fields: Schema.Struct({
    company_safe: S,
    chain_id: Int,
    founder_safe: S,
    board_top_hat: S,
    shareholders_top_hat: S,
    director_hat: S,
    books_hat: S,
    invoicing_hat: S,
    people_hat: S,
    roles_address: S,
    gate_address: S,
    money_log_id: S,
    captable: Null(S),
    governor: Null(S),
    options: Null(S),
    rounds: Null(S),
    exits: Null(S),
    elections: Null(S),
    equity_log_id: Null(S),
    updated_block: Int,
  }),
  key: ["company_safe"],
  indexes: [
    {
      name: "chain-deployments-by-captable",
      fields: ["captable"],
      unique: true,
      for: "Attribute an equity clone's event to its company Safe: the clones' own events do not name it.",
    },
  ],
  retention: PROJECTION,
});

export const table_chain_hats = defineTable({
  id: "chain-hats",
  title: "Chain hats: every hat in a Capxul company's two hat trees",
  about:
    "One row per hat in a company's Board tree or Shareholders tree (HatCreated, attributed to the company by its top hat " +
    "in chain-deployments): its admin hat (null for a top hat), level, details, max supply, current supply (wearers " +
    "now), eligibility, toggle and whether it is active, kept current by Hats' max supply, eligibility, toggle and " +
    "status change events. `live` when its eligibility or toggle answers Hats itself (a module, such as the Elections " +
    "clone on an elected Director hat, probed with Hats' own getWearerStatus/getHatStatus calls at each of its events): " +
    "its wearers and status then change with no event, so readers of this index refuse that hat (HISTORICAL_UNAVAILABLE) " +
    "and its callers read `isWearerOfHat` live (indexing.hats-indexed). Budgets plans a new office or allowance hat's id from its admin's children here, with " +
    "Ponder at the chain head (Hats ids are positional, so the next child is the count of children so far); board names " +
    "the officer and Director hats from it. Hats of other trees are not indexed.",
  was: ["packages/protocol/src/evm/company-hats.ts:11"],
  concept: concept_indexing,
  tenancy: "chain",
  scope: scope("`company_safe`"),
  admits: bySafe("company_safe"),
  fields: Schema.Struct({
    hat_id: S,
    chain_id: Int,
    company_safe: S,
    tree: Schema.Literals(["board", "shareholders"]),
    admin_hat_id: Null(S),
    level: Int,
    details: S,
    max_supply: Int,
    supply: Int,
    eligibility: S,
    toggle: S,
    active: B,
    mutable: B,
    live: B,
    ...SET_BY,
  }),
  key: ["hat_id"],
  indexes: [
    {
      name: "chain-hats-by-admin",
      fields: ["admin_hat_id", "hat_id"],
      for: "A hat's children in id order: plan the next child hat id under an admin (`org department create`, `org allowance create`).",
    },
    {
      name: "chain-hats-by-company",
      fields: ["company_safe", "tree", "level"],
      for: "An Organization's hats by tree and level: the officer hats, the Director hat, the budgets' office hats.",
    },
  ],
  retention: PROJECTION,
});

export const table_hat_wearers = defineTable({
  id: "hat-wearers",
  title: "Hat wearers: who wears which Capxul hat now",
  about:
    "One row per hat and wearer that ever held it, from Hats' TransferSingle (minted, moved or burned) and " +
    "WearerStandingChanged: `holds` while the wearer's balance is one, `standing` while in good standing, and `wearing` " +
    "when both hold and the hat is active (chain-hats), which is what every reader asks (an officer hat, the Director hat, " +
    "a budget's office hat). The install gives every hat an address, not a module, for eligibility and toggle (the company " +
    "Safe; the founder's Safe, then the Governor, for the Director hat), so these events are the whole story. Once a " +
    "company attaches elections (equity, low priority), its Director hat's eligibility is the Elections module, whose " +
    "term end rules wearers out with no event; that hat's readers, and any check that must be exact at the moment of a " +
    "write (the Gate seating a signer), read `isWearerOfHat` live (indexing.hats-indexed). `company_safe` is the company whose " +
    "tree holds the hat. Board, budgets, books, requests, banking, applications and organizations read it. New: the old " +
    "system read hats from the chain on every request.",
  was: ["packages/protocol/src/evm/company-hats.ts:11", "packages/backend/src/permissions/tables/permissions.ts:57"],
  concept: concept_indexing,
  tenancy: "chain",
  scope: scope("`wearer` or `company_safe`"),
  admits: bySafe("wearer", "company_safe"),
  fields: Schema.Struct({
    hat_id: S,
    wearer: S,
    chain_id: Int,
    company_safe: S,
    holds: B,
    standing: B,
    wearing: B,
    since_block: Int,
    ...SET_BY,
  }),
  key: ["hat_id", "wearer"],
  indexes: [
    {
      name: "hat-wearers-by-wearer",
      fields: ["wearer", "company_safe", "wearing"],
      for: "The hats a Safe wears in an Organization: a member's officer hats, `org me`, a guard that needs the Books or Invoicing hat.",
    },
    {
      name: "hat-wearers-by-company",
      fields: ["company_safe", "hat_id", "wearing"],
      for: "An Organization's wearers of one hat now: its Directors, an office's holders, the People hat's wearers.",
    },
  ],
  retention: PROJECTION,
});

// ── Budgets and Agreements ──────────────────────────────────────────────────────────────────

export const table_chain_budgets = defineTable({
  id: "chain-budgets",
  title: "Chain budgets: the v4 budget tree of each company Safe",
  about:
    "One row per budget in v4 Budgets (BudgetCreated): its company Safe, parent (null for a top budget), token, period, " +
    "amount per period, office hat and whether it is closed, as BudgetAmountSet, BudgetHatSet, BudgetClosed and " +
    "BudgetReopened leave them, and what agreements hold reserved in it (`committed`, from Committed less Released). What " +
    "is left this period is the chain's `leftOf`, read live where a write needs it; what was spent is the budget's rows in " +
    "chain-payments. A budget made outside Capxul is here too, with no Capxul name (budgets joins its own rows by " +
    "`budget_id`). Replaces the old BudgetCreated-only evidence and old permissions' and payroll's copied allowances.",
  was: [`${V4}/budgets/handlers.ts:6`, `${V4}/budgets/schema.ts:4`],
  concept: concept_indexing,
  tenancy: "chain",
  scope: scope("`company_safe`"),
  admits: bySafe("company_safe"),
  fields: Schema.Struct({
    budget_id: S,
    chain_id: Int,
    company_safe: S,
    parent_budget_id: Null(S),
    token: S,
    period: Int,
    amount: S,
    hat_id: S,
    closed: B,
    committed: S,
    ...SET_BY,
  }),
  key: ["budget_id"],
  indexes: [
    {
      name: "chain-budgets-by-company",
      fields: ["company_safe", "parent_budget_id", "budget_id"],
      for: "An Organization's budget tree: its top budgets, and each budget's children (`org department list`, `show`, the tree).",
    },
    {
      name: "chain-budgets-by-hat",
      fields: ["hat_id", "closed"],
      for: "The budgets a hat holds office over: what a wearer may spend from (`org allowance list`, a payment's budget).",
    },
  ],
  retention: PROJECTION,
});

export const table_chain_agreements = defineTable({
  id: "chain-agreements",
  title: "Chain agreements: every v4 agreement and where it stands",
  about:
    "One row per agreement in v4 Agreements (AgreementOffered): its company Safe, budget, token, payee, rate, period, " +
    "start, end, step, offer expiry and document hash, and its standing as the chain's events leave it: offered, accepted, " +
    "paused, ended or withdrawn (an offer past its expiry reads as lapsed from `offer_expires_at`; no event marks it), a " +
    "pending rate change (RateChanged until it takes effect, or RateChangeCancelled), and the total collected. What the " +
    "payee can collect now is the chain's `availableOf`. Budgets counts a budget's offers and running agreements here; " +
    "payroll follows each agreement's events by its id.",
  was: [`${V4}/agreements/schema.ts:4`, `${V4}/agreements/handlers.ts:1`],
  concept: concept_indexing,
  tenancy: "chain",
  scope: scope("`company_safe` or `payee`"),
  admits: bySafe("company_safe", "payee"),
  fields: Schema.Struct({
    agreement_id: S,
    chain_id: Int,
    company_safe: S,
    budget_id: S,
    token: S,
    payee: S,
    rate: S,
    period: Int,
    starts_at: N,
    ends_at: Null(N),
    step: N,
    offer_expires_at: N,
    document_hash: S,
    standing: Schema.Literals(["offered", "accepted", "paused", "ended", "withdrawn"]),
    pending_rate: Null(S),
    pending_rate_at: Null(N),
    collected: S,
    ...SET_BY,
  }),
  key: ["agreement_id"],
  indexes: [
    {
      name: "chain-agreements-by-budget",
      fields: ["budget_id", "standing"],
      for: "A budget's offers and running agreements: `org department show` and the tree's counts.",
    },
    {
      name: "chain-agreements-by-payee",
      fields: ["payee", "standing"],
      for: "The agreements a payee's Safe holds: what a person or Organization is paid, and can accept or collect.",
    },
    {
      name: "chain-agreements-by-company",
      fields: ["company_safe", "standing"],
      for: "An Organization's agreements: `org payroll agreement list` for the payer.",
    },
  ],
  retention: PROJECTION,
});

// ── escrows ─────────────────────────────────────────────────────────────────────────────────

export const table_escrows = defineTable({
  id: "escrows",
  title: "Escrows: each invoice and claim escrow, its terms and whether it paid",
  about:
    "One row per general escrow the EscrowFactory deployed (EscrowDeployed: its CREATE2 address, `owner` who collects, " +
    "`sender` where the money came from and the only address a refund pays, its `authority` and `authority_key` (a " +
    "budget's escrow names Budgets and the budget id; zero for a personal, Board or invoice one), payment id and salt) " +
    "and the terms its EscrowCreated names: token, amount, kind, document hash and condition, named as the contract's " +
    "constants (`amount_reached`: paid out once its balance reaches the amount, an invoice; `owner_collects`: the " +
    "owner collects once it can act, a claim escrow) (payments.general-escrow). `standing` is open until EscrowPaid or " +
    "EscrowRefunded (which names who refunded, `by`). What it holds is its row in safe-balances. Accounts finds the " +
    "claim escrows a person's Safe owns, at setup and by `payment claim`; requests follows an invoice escrow's " +
    "checkout; books and payments read what a sender has in escrow.",
  was: [`${V4}/escrow-factory/schema.ts:4`, `${V4}/escrow-factory/handlers.ts:1`, "blueprint/shared/external.ts (contract_escrow: the general escrow)"],
  concept: concept_indexing,
  tenancy: "chain",
  scope: scope("`sender` or `owner`"),
  admits: bySafe("sender", "owner"),
  fields: Schema.Struct({
    escrow_address: S,
    chain_id: Int,
    /** Where the money came from, and the only address a refund pays (v4's ownerSafe). */
    sender: S,
    /** Who collects (v4's payeeSafe): a mailbox's derived Safe, an issuer's Safe, a shareholder. */
    owner: S,
    /** The view a refund other than the sender's asks (`authorised(key, who)`): Budgets for a budget's escrow, else the zero address. */
    authority: S,
    authority_key: S,
    payment_id: S,
    salt: S,
    token: S,
    amount: S,
    kind: Int,
    document_hash: S,
    condition: Schema.Literals(["amount_reached", "owner_collects"]),
    standing: Schema.Literals(["open", "paid", "refunded"]),
    ...SET_BY,
  }),
  key: ["escrow_address"],
  indexes: [
    {
      name: "escrows-by-owner",
      fields: ["owner", "condition", "standing"],
      for: "The claim escrows a person's Safe owns, collected at its setup or by `payment claim` (payments, over accounts' rpc); an invoice escrow its issuer awaits.",
    },
    {
      name: "escrows-by-sender",
      fields: ["sender", "standing"],
      for: "A sender's open escrows: invoices awaiting checkout, claim escrows to take back (books' reports, payments).",
    },
    {
      name: "escrows-by-payment-id",
      fields: ["chain_id", "payment_id"],
      unique: true,
      for: "An escrow by the payment id its payout will carry: payments and requests match a claim escrow or an invoice to it.",
    },
  ],
  retention: PROJECTION,
});

// ── equity (low priority) ───────────────────────────────────────────────────────────────────

export const table_equity_instruments = defineTable({
  id: "equity-instruments",
  title: "Equity instruments: a company's share classes, rounds and sales",
  about:
    "One row per company-level instrument of the equity clones: a share class (ClassCreated, with its token), a priced " +
    "round, a SAFE round, a sale and a secondary transfer offer, each with its terms as the clone's events give them " +
    "(`terms`, decoded) and its standing (open, closed, cancelled, settled). The company Safe comes from the clone's " +
    "Installer deployment. Equity reads it for the cap table, `org round` and exits; votes stay in chain-logs (Governor's " +
    "ProposalCreated and VoteCast), read by the company's Governor. Replaces seven of the old v4 read models " +
    "(`v4_share_class`, `v4_priced_round`, `v4_safe_round`, `v4_safe_invitation`, `v4_exit_sale`, `v4_exit_claim`, " +
    "`v4_share_transfer`), which kept one table per contract struct.",
  was: [`${V4}/captable/schema.ts:12`, `${V4}/rounds/schema.ts:11`, `${V4}/rounds/schema.ts:58`, `${V4}/exits/schema.ts:8`, `${V4}/exits/schema.ts:51`],
  concept: concept_indexing,
  tenancy: "chain",
  scope: scope("`company_safe`"),
  admits: bySafe("company_safe"),
  fields: Schema.Struct({
    company_safe: S,
    instrument: Schema.Literals(["share_class", "priced_round", "safe_round", "sale", "share_transfer"]),
    instrument_id: S,
    chain_id: Int,
    clone_address: S,
    token: Null(S),
    terms: Schema.Record(S, Schema.Unknown),
    standing: Schema.Literals(["open", "closed", "cancelled", "settled"]),
    document_hash: Null(S),
    ...SET_BY,
  }),
  key: ["company_safe", "instrument", "instrument_id"],
  indexes: [],
  retention: PROJECTION,
});

export const table_equity_positions = defineTable({
  id: "equity-positions",
  title: "Equity positions: what each holder's Safe holds in a company",
  about:
    "One row per holder and instrument: shares of a class (the ShareClass token's Transfers), a vesting grant, an option " +
    "grant, a round invitation or commitment, and a SAFE note, with the amount, its standing (offered, accepted, paid, " +
    "converted, ended) and its document hash. 'The indexer's positions for your Safe' in the frozen text (class balances, " +
    "Options grants, SAFE notes) are these rows; a grant's unvested part is the chain's `lockedOf`, read live. Replaces the " +
    "old `v4_equity_balance`, `v4_vesting_grant`, `v4_option_grant`, `v4_round_position` and `v4_safe_note`.",
  was: [`${V4}/share-class/schema.ts:12`, `${V4}/vesting/schema.ts:12`, `${V4}/options/schema.ts:12`, `${V4}/rounds/schema.ts:36`, `${V4}/rounds/schema.ts:96`],
  concept: concept_indexing,
  tenancy: "chain",
  scope: scope("`holder` or `company_safe`"),
  admits: bySafe("holder", "company_safe"),
  fields: Schema.Struct({
    company_safe: S,
    instrument: Schema.Literals(["shares", "vesting_grant", "option_grant", "round_position", "safe_note"]),
    instrument_id: S,
    holder: S,
    chain_id: Int,
    class_id: Null(Int),
    amount: S,
    standing: Schema.Literals(["held", "offered", "accepted", "paid", "converted", "ended"]),
    document_hash: Null(S),
    ...SET_BY,
  }),
  key: ["company_safe", "instrument", "instrument_id", "holder"],
  indexes: [
    {
      name: "equity-positions-by-holder",
      fields: ["holder", "company_safe", "instrument"],
      for: "A holder's positions across companies: `shares`, an investor's commitments, a grantee's grants.",
    },
  ],
  retention: PROJECTION,
});
