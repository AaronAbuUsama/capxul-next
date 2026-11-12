// Indexing's own judgments: that it is tables only, how its views are scoped and keyed, how a log is
// identified and stored once, who handles reorgs, why it has no machine, what Ponder admits, the
// shape of each family of views, and what of old Ponder and old indexing is not ported. The
// architecture's judgments about indexing (it owns every chain view and no workflow; parties is the
// scope; the indexer integration) are in shared/decisions.ts; these refine them. Indexing owns no
// operation, so it names no refusal and introduces no world.

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import {
  component_ponder,
  component_postgres,
  concept_activity,
  concept_agents,
  concept_approvals,
  concept_books,
  concept_budgets,
  concept_indexing,
  concept_organizations,
  concept_parties,
  concept_payments,
} from "../shared/foundation.ts";
import {
  contract_agent_owner,
  contract_entry_point,
  contract_erc20,
  contract_hats,
  contract_installer,
  contract_payments,
  contract_roles,
  integration_indexer,
} from "../shared/external.ts";
import {
  decision_components_ponder,
  decision_concepts_books_token_scan,
  decision_concepts_indexing,
  decision_concepts_parties_scope,
  decision_concepts_permissions,
  decision_integrations_indexer,
  decision_operations_owners,
  decision_responsibilities_keepers,
} from "../shared/decisions.ts";
import {
  table_chain_agreements,
  table_chain_budgets,
  table_chain_deployments,
  table_chain_hats,
  table_chain_logs,
  table_chain_payments,
  table_equity_instruments,
  table_equity_positions,
  table_escrows,
  table_hat_wearers,
  table_indexer_progress,
  table_safe_approvals,
  table_safe_balances,
  table_safe_executions,
  table_safe_owners,
  table_transfers,
  table_user_operations,
} from "./data.ts";

const BY = "Claude, indexing target design, 8 November 2026";
const by = (evidence: string) => `${BY}; evidence: ${evidence}`;

/** Every view, for the decisions that shape them all. */
const ALL_VIEWS = [
  table_indexer_progress,
  table_chain_logs,
  table_transfers,
  table_chain_payments,
  table_user_operations,
  table_safe_owners,
  table_safe_approvals,
  table_safe_executions,
  table_safe_balances,
  table_chain_deployments,
  table_chain_hats,
  table_hat_wearers,
  table_chain_budgets,
  table_chain_agreements,
  table_escrows,
  table_equity_instruments,
  table_equity_positions,
];

/** The views that hold one row per log, kept while the log is canonical. */
const FACT_VIEWS = [table_chain_logs, table_transfers, table_chain_payments, table_user_operations, table_safe_approvals, table_safe_executions];

/** The views that hold one row per object, rewritten by each event that changes it. */
const PROJECTIONS = [
  table_safe_owners,
  table_chain_deployments,
  table_chain_hats,
  table_hat_wearers,
  table_chain_budgets,
  table_chain_agreements,
  table_escrows,
  table_equity_instruments,
  table_equity_positions,
];

// ── what indexing is ────────────────────────────────────────────────────────────────────────

export const decision_indexing_tables_only = defineDecision({
  id: "indexing.tables-only",
  title: "Indexing is tables only: no procedure, rpc, workflow, flow or operation",
  question:
    "Indexing owns every chain view and no workflow (concepts.indexing). Does it own any behaviour: read rpcs for other concepts, the indexer service, a procedure, a flow?",
  options: [
  {
    "label": "current-scope",
    "text": "Indexing owns chain read views; concepts read them through their own behavior and progress-dependent calls use the indexer integration. Only the reader writes them. Ponder writes them in every environment, worlds included (aaron.postgres-and-ponder), so tables-only is an ownership boundary over Ponder's schema."
  },
  {
    "label": "historical",
    "text": "The former answer to indexing.tables-only is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Indexing owns chain read views; concepts read them through their own behavior and progress-dependent calls use the indexer integration. Only the reader writes them. Ponder writes them in every environment, worlds included (aaron.postgres-and-ponder), so tables-only is an ownership boundary over Ponder's schema. Authority: devnet.lean-world; plugs.event-order; plugs.reversal-not-deletion.",
  source: "The coordinator, round 2, m1-old-decisions; devnet.lean-world; plugs.event-order; plugs.reversal-not-deletion",
  affects: [
    concept_indexing,
    integration_indexer,
    decision_concepts_indexing,
    decision_integrations_indexer,
    decision_operations_owners,
    decision_components_ponder,
  ],
});

export const decision_indexing_scope_by_parties = defineDecision({
  id: "indexing.scope-by-parties",
  title: "A view's row-level security joins parties' directory on its Safe columns",
  question:
    "P8 reads chain facts only through views joined to the Safe-ownership table, which is parties' directory " +
    "(concepts.parties-scope). How does one view decide which rows a caller sees, and what does a workflow see?",
  options: [
    {
      label: "rls-join",
      text:
        "Each view names the columns that hold Safes (`scope`). Its generated policy shows a row when any of them is the " +
        "Safe of a Party whose owner is the session's tenant. A workflow runs as the system role and sees every row.",
    },
    { label: "filter-in-rpc", text: "Views are unscoped; every reading rpc adds the Safe filter itself." },
    { label: "safes-claim", text: "Keep the old signed `safes` claim, checked against compiled query shapes." },
  ],
  chosen: "rls-join",
  why:
    "With a policy, a reader that forgets the filter gets no rows instead of another tenant's (P8 option B). A row is " +
    "visible when any Safe it names is the caller's, so a payment between two Organizations shows to both, an escrow to " +
    "its payer and its payee, and a hat's wearers to the company and to each wearer. A row that names no Capxul Safe (a " +
    "Transfer between two outside addresses of an admitted asset) is visible to no session, only to workflows, which act " +
    "for the system: settling a Payment, collecting a claim escrow, following an agreement. Indexer-progress names no Safe " +
    "and is not scoped. The old claim needed the indexer to verify the backend's keys (the component cycle " +
    "components.ponder removes) and a compiled shape for every query; a hand filter in every rpc is the option P8 rejected.",
  source: by("apps/indexer/src/auth.ts:149 (signed safes claim); apps/indexer/src/query-authorization.ts; P8 option B"),
  affects: [...ALL_VIEWS, concept_parties, component_postgres, decision_concepts_parties_scope, decision_components_ponder],
});

export const decision_indexing_keys = defineDecision({
  id: "indexing.keys",
  title: "A projection is keyed by its chain identity; one deployment indexes one chain",
  question: "Chain tables have no tenant column. What leads their keys, and does every key start with the chain id?",
  options: [
    {
      label: "chain-identity",
      text:
        "A fact is keyed by its `log_id` (which carries the chain id); a projection by the object's own chain identity: a " +
        "Safe or escrow address, a hat id, a Budgets or Agreements id. `chain_id` stays a column on every row.",
    },
    { label: "chain-first", text: "Every key and index starts with `chain_id`, as if one Postgres indexed several chains." },
  ],
  chosen: "chain-identity",
  why:
    "Each environment runs one chain with one v4 deployment (components.chain: Base Sepolia on staging, an Anvil fork on " +
    "a devnet), and Budgets and Agreements number their ids from one global counter (`++_budgetCount`, " +
    "`++agreementCount`), so an address or an id is unique within it. A chain-id prefix would lead every index with a " +
    "constant. The column stays so a row says where it came from, and the lookups by a hash or a payment id (`BY_TX`, " +
    "payment id) keep it first because those values are only unique per chain. A second chain is a new deployment.",
  source: by("packages/contracts/v4/src/money/Budgets.sol:423; packages/contracts/v4/src/money/Agreements.sol:94; apps/indexer/ponder.schema.ts:62"),
  affects: ALL_VIEWS,
});

// ── logs ────────────────────────────────────────────────────────────────────────────────────

export const decision_indexing_log_identity = defineDecision({
  id: "indexing.log-identity",
  title: "A log is its chain, tx hash and tx log ordinal; its block index is a column",
  question: "What identifies one indexed log, so that a Payment's consumed log or a book fact's key never moves?",
  options: [
    {
      label: "tx-ordinal",
      text:
        "`log_id` = chain id, transaction hash and the log's ordinal in its transaction's receipt; `log_index`, the " +
        "block-global index, is kept as a column.",
    },
    { label: "block-index", text: "Block number and block-global log index, as Ponder's own event id." },
    { label: "tx-index", text: "Transaction hash and block-global log index." },
  ],
  chosen: "tx-ordinal",
  why:
    "A reorg can re-include the same transaction in another block, which changes the block number and the block-global " +
    "index of each of its logs but not the transaction's own log sequence. Payments' consumed log (K9), books' money key " +
    "and a Movement's key are keyed by the log, so a key that moves with a reorg would book the same money twice. The old " +
    "indexer chose the same identity (SPEC D3) and kept `log_index` because receipts and UserOperation membership name " +
    "it; both readers of a log must agree on it (P12 #2003). Ponder's handler derives the ordinal from the transaction's " +
    "receipt, as the old one did.",
  source: by("apps/indexer/CONTEXT.md:126 (Identity and reorgs); apps/indexer/src/event.ts; apps/indexer/ponder.schema.ts:11"),
  affects: FACT_VIEWS,
});

export const decision_indexing_one_row_per_log = defineDecision({
  id: "indexing.one-row-per-log",
  title: "Each log is stored once: in a typed fact table, or in chain-logs",
  question:
    "The old indexer kept one `v4_<contract>_event` evidence table per contract (15), and v4's PaymentSent handler wrote " +
    "the same log again into `payment`. How are the logs stored in the target?",
  options: [
    {
      label: "typed-plus-decoded",
      text:
        "A typed fact table for each log readers query by its columns (Transfer, PaymentSent, UserOperationEvent, " +
        "ApproveHash, ExecutionSuccess and ExecutionFailure); every other admitted log once in chain-logs, decoded.",
    },
    { label: "per-contract", text: "Keep one evidence table per contract, and read models that copy what they need." },
    { label: "typed-everything", text: "One typed table per event of every contract." },
  ],
  chosen: "typed-plus-decoded",
  why:
    "Settling a Payment by payment id, ending an approval by sender and nonce, counting a Board proposal's approvals by " +
    "Safe transaction hash and listing a Safe's transfers by address are column lookups that need typed columns and " +
    "indexes. Every other log is read in one of two ways: in canonical order per contract event (each chain-event " +
    "trigger) or by the Safes it concerns, and one table with `contract`, `event` and a GIN index on `safes` serves both. " +
    "Fifteen evidence tables were one shape repeated; a typed table for each of some sixty events would be read by one " +
    "trigger each. Storing a log once means `indexer.factsOf` reads a transaction's facts by (chain, tx hash) from six " +
    "tables with one index each, and no two rows can disagree about one log.",
  source: by("apps/indexer/src/v4/evidence-table.ts:9; apps/indexer/src/v4/payments/handlers.ts:20; apps/indexer/ponder.schema.ts:179"),
  affects: [...FACT_VIEWS, integration_indexer],
});

export const decision_indexing_reorgs_are_ponders = defineDecision({
  id: "indexing.reorgs-are-ponders",
  title: "Ponder handles reorgs; finality is the reader's, through the indexer integration",
  question: "Who handles a chain reorganisation, and how does a reader know a fact will not be rolled back?",
  options: [
  {
    "label": "current-scope",
    "text": "The chain reader rolls back reorganized views and replays canonical logs. Money readers wait for configured finality and reconcile later reorgs; Ponder does this in every environment, worlds included (aaron.postgres-and-ponder). Site corrections use explicit ordered reversal events, not silent deletion of a posted payment."
  },
  {
    "label": "historical",
    "text": "The former answer to indexing.reorgs-are-ponders is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: The chain reader rolls back reorganized views and replays canonical logs. Money readers wait for configured finality and reconcile later reorgs; Ponder does this in every environment, worlds included (aaron.postgres-and-ponder). Site corrections use explicit ordered reversal events, not silent deletion of a posted payment. Authority: devnet.lean-world; plugs.event-order; plugs.reversal-not-deletion.",
  source: "The coordinator, round 2, m1-old-decisions; devnet.lean-world; plugs.event-order; plugs.reversal-not-deletion",
  affects: [...FACT_VIEWS, ...PROJECTIONS, table_indexer_progress, integration_indexer, component_ponder],
});

export const decision_indexing_no_machines = defineDecision({
  id: "indexing.no-machines",
  title: "No state machine and no event: a standing in a view is the chain's",
  question:
    "Agreements, escrows, hat wearers and equity positions have a standing that changes. Does indexing model them as " +
    "state machines with `<machine>_transitioned` events?",
  options: [
    {
      label: "no-machines",
      text:
        "No: a standing column is written by Ponder from a chain event; a concept that reacts is triggered by that chain " +
        "event; the concept that owns the business object keeps its machine.",
    },
    { label: "machines", text: "Machines on the projections (agreement, escrow, wearer), each sending its `_transitioned` event." },
  ],
  chosen: "no-machines",
  why:
    "A target transition is driven by an rpc or a workflow, and its event goes to the outbox in that transaction (P7). " +
    "Ponder is neither and writes no outbox, so a machine here would have no driver and its event would repeat the chain " +
    "event the reacting concept is already triggered by. The business objects that wait on these facts keep their own " +
    "machines: payroll's agreement, requests' checkout, accounts' setup, approvals' approval. An agreement offer past its " +
    "expiry reads as lapsed from `offer_expires_at`, because no event marks it.",
  source: by("P7; rules.outbox; apps/indexer/CONTEXT.md:124 (handlers assert no product settlement)"),
  affects: [table_chain_agreements, table_escrows, table_hat_wearers, table_equity_instruments, table_equity_positions, table_chain_budgets, table_safe_owners],
});

export const decision_indexing_admission = defineDecision({
  id: "indexing.admission",
  title: "Ponder admits Capxul's contracts and what their events make known",
  question: "Which logs does Ponder index: everything on chain from Safe, Hats and the EntryPoint, or only Capxul's?",
  options: [
    {
      label: "made-known",
      text:
        "Capxul's v4 contracts; the Safes, hat trees and escrows a Capxul event makes known (CapxulSafeClaimed, " +
        "CompanySafeMinted, AgentCreated, MoneyDeployed, EscrowDeployed), as Ponder factory sources; UserOperationEvents " +
        "sent by those Safes; every Transfer of an admitted asset.",
    },
    { label: "everything", text: "Every Safe, Hats and EntryPoint event on the chain." },
    { label: "configured", text: "A configured list of Safes and trees, as the old `sources.safe` block did." },
  ],
  chosen: "made-known",
  why:
    "Rows nobody can be scoped to would only cost index time and storage on a public testnet. A Capxul event is the " +
    "provenance of each Safe, tree and escrow, which also retires the old singleton and code-hash checks (they verified " +
    "Safes Capxul did not make). UserOperationEvents are admitted by sender, not by paymaster, so an operation that " +
    "takes an approval's nonce is seen even when Capxul did not sponsor it. Transfers are the exception: money can reach a " +
    "Safe or an escrow before the event that makes it known (a CREATE2 escrow funded first, a person's Safe paid before " +
    "its claim), so every Transfer of an admitted asset is indexed and a balance is exact.",
  source: by("apps/indexer/ponder.config.ts:121; apps/indexer/ponder.schema.ts:62 (singleton, codeHash); apps/indexer/src/v4/sources.ts"),
  affects: [table_chain_logs, table_safe_owners, table_chain_hats, table_hat_wearers, table_escrows, table_user_operations, table_transfers, contract_entry_point],
});

// ── money ───────────────────────────────────────────────────────────────────────────────────

export const decision_indexing_transfers = defineDecision({
  id: "indexing.transfers",
  title: "Transfers of the admitted assets only, whoever is party; no native ETH",
  question:
    "The old indexer had `transfer`, `native_transfer` and the `activity_transfer` view that paired a Transfer with a V2 " +
    "PaymentSent. What does the target index of money moving?",
  options: [
    {
      label: "admitted-assets",
      text:
        "Every ERC-20 Transfer of the deployment's admitted assets from each token's deployment block; no native ETH; no " +
        "pairing view; tokens an Organization adds at run time are books' scan.",
    },
    { label: "known-safes", text: "Only Transfers to or from a Safe Ponder already knows." },
    { label: "keep-native", text: "As admitted-assets, plus native ETH transfers into and out of Safes (old CAP-979)." },
  ],
  chosen: "admitted-assets",
  why:
    "A filter on known Safes misses money sent before the Safe is known (indexing.admission), and a balance summed from " +
    "transfers must see every one. No frozen operation moves or shows native ETH, so its table has no reader. The " +
    "`activity_transfer` view matched a Transfer to a V2 PaymentSent by amount and ordering, a pre-v4 shape (P9); on v4 " +
    "payments explains a Transfer by the facts of its transaction (`indexer.factsOf`). A token added at run time has no " +
    "Ponder source, and its only reader is books (concepts.books-token-scan).",
  source: by("apps/indexer/ponder.schema.ts:3; apps/indexer/ponder.schema.ts:243; apps/indexer/src/native-schema.ts:6; apps/indexer/ponder.config.ts:23"),
  affects: [table_transfers, table_safe_balances, contract_erc20, concept_books, decision_concepts_books_token_scan],
});

export const decision_indexing_chain_payments = defineDecision({
  id: "indexing.chain-payments",
  title: "PaymentSent carries its budget, agreement or escrow; spends need no table",
  question:
    "Every v4 movement of money ends in a PaymentSent, and the same transaction names its source (Budgets' Spent or " +
    "ScheduledPaid, Agreements' Collected, an escrow's EscrowPaid). Where is that link kept?",
  options: [
    {
      label: "attributed",
      text: "On the PaymentSent row: Ponder fills `budget_id`, `scheduled_id`, `agreement_id` or `escrow_address` from the event that names its payment id.",
    },
    { label: "spends-table", text: "A budget-spends table from Spent and ScheduledPaid, beside chain-payments." },
    { label: "join-logs", text: "PaymentSent alone; readers join chain-logs by transaction to find the source." },
  ],
  chosen: "attributed",
  why:
    "Budgets' spent figures, books' reconcile and activity's feed all ask 'what paid this, from where', on lists. A " +
    "spends table would store the Spent log a second time (it is in chain-logs), and a join by transaction on every list " +
    "read is the work Ponder can do once. The payment id ties the two logs exactly, and Payments consumes an id once, so " +
    "the row is unique by it. The old `payment` table copied the v4 evidence row, and its `commitment` sibling had no v4 " +
    "writer (P9); both go.",
  source: by("apps/indexer/ponder.schema.ts:179; apps/indexer/ponder.schema.ts:212; apps/indexer/src/v4/payments/handlers.ts:20"),
  affects: [table_chain_payments, table_chain_budgets, contract_payments, concept_budgets, concept_payments],
});

export const decision_indexing_balances_view = defineDecision({
  id: "indexing.balances-view",
  title: "A Safe's balance is a view over transfers, not a stored table",
  question: "Activity shows balances and books reconciles them. Does Ponder store balances, or are they computed?",
  options: [
    { label: "view", text: "A view summing transfers per Safe or escrow and asset; a send that must not overdraw reads `balanceOf` live." },
    { label: "stored", text: "Ponder keeps a balances table, updated on every Transfer." },
    { label: "live", text: "Every balance is a `balanceOf` read on the chain." },
  ],
  chosen: "view",
  why:
    "Transfers holds every Transfer of each admitted asset from its deployment block, so the sum is exact and rolls back " +
    "with its rows. The by-from and by-to indexes keep one Safe's sum cheap at the beta's scale. A stored balance is a " +
    "second row for the same fact, and a live read per Safe per token would put every balance list in the chain-read " +
    "class. The old `balance` was a view too, over every address on chain; this one covers only the Safes and escrows " +
    "Capxul knows.",
  source: by("apps/indexer/ponder.schema.ts:31"),
  affects: [table_safe_balances, table_transfers, concept_activity],
});

export const decision_indexing_user_operations = defineDecision({
  id: "indexing.user-operations",
  title: "Index UserOperationEvent, so an approval ends on an indexed chain fact",
  question:
    "An approval ends only on chain proof: landed, reverted or displaced (concepts.approvals). The old backend read " +
    "receipts through chain-evidence and asked the bundler. Where does the target read that proof?",
  options: [
    { label: "indexed", text: "Ponder indexes UserOperationEvent from Capxul's Safes, unique by hash and by sender and nonce." },
    { label: "receipts", text: "Approvals reads each operation's receipt from the chain, by its hash." },
    { label: "bundler", text: "Approvals asks the bundler for each operation's status." },
  ],
  chosen: "indexed",
  why:
    "Displacement is another operation on the same sender and nonce, which no receipt for the approval's own hash shows; a " +
    "unique (sender, nonce key, sequence) index answers it in one read. An indexed event is also reorg-safe and comes " +
    "with the transaction's other facts, so approvals' process waits on Ponder like every other chain fact instead of " +
    "polling a receipt, and a bundler forgets an operation it dropped.",
  source: by("packages/backend/src/integrations/chain-evidence/service.ts:76; packages/backend/src/payments/executions/external/sends.ts:145"),
  affects: [table_user_operations, contract_entry_point, concept_approvals],
});

// ── authority ───────────────────────────────────────────────────────────────────────────────

export const decision_indexing_hats_indexed = defineDecision({
  id: "indexing.hats-indexed",
  title: "Hats and their wearers are indexed; a write that must be exact reads Hats live",
  question:
    "On v4 every permission is a hat (responsibilities.keepers). The old system read hats from the chain on each request " +
    "and copied grants into permissions' tables. How does the target know who wears what?",
  options: [
    {
      label: "indexed",
      text:
        "Ponder keeps every Capxul hat (chain-hats) and every wearer (hat-wearers) from Hats' events; `wearing` is held, " +
        "in good standing and active. A check that must be exact at a write reads `isWearerOfHat` live.",
    },
    { label: "live", text: "Read `isWearerOfHat` and the hat's details from the chain on every request." },
    { label: "copied", text: "Board writes a grants table when a grant's proposal lands, as old permissions did." },
  ],
  chosen: "indexed",
  why:
    "Board, budgets, books, requests, banking, applications and organizations ask who wears a hat on most reads, and two of " +
    "the questions are lists (an Organization's Directors, the hats a Safe wears) that Hats cannot answer: it has no " +
    "enumeration. Budgets plans a new hat's id from its admin's children, which only an index of HatCreated can count. A " +
    "copied table drifts, which is why old permissions kept receipts and old indexing a reconcile. The install gives " +
    "every hat an address for eligibility and toggle, so Hats' events are the whole story until a company attaches " +
    "elections (low priority): the Elections module rules a Director out at a term's end with no event, so that hat's " +
    "readers read Hats live.",
  source: by("packages/contracts/v4/src/authority/InstallerMoney.sol:130; packages/contracts/v4/src/interfaces/IInstaller.sol:291; packages/backend/src/permissions/tables/permissions.ts:57"),
  affects: [table_chain_hats, table_hat_wearers, contract_hats, decision_concepts_permissions, decision_responsibilities_keepers],
});

export const decision_indexing_deployments = defineDecision({
  id: "indexing.deployments",
  title: "The Installer's deployments are indexed, so Ponder can attribute hats and equity",
  question:
    "Hats events name a hat, not a company, and the equity clones' events do not name the company Safe. How does Ponder " +
    "attribute them?",
  options: [
    {
      label: "indexed",
      text:
        "chain-deployments: one row per company Safe from MoneyDeployed (hat ids, officer hats by position, Roles, the Gate) " +
        "and EquityDeployed (the clones); Ponder attributes a hat by its top hat and a clone's event by its address.",
    },
    { label: "backend", text: "Ponder reads organizations' deployment row from the app schema." },
  ],
  chosen: "indexed",
  why:
    "Ponder reads only the chain and its own schema (components.ponder), so attribution must come from a chain event, and " +
    "the Installer's two events carry every address and hat id. The officer hats arrive as an array in install order " +
    "(Books, Invoicing, People), so the row names them by position. Organizations keeps its own once-written copy of the " +
    "money half for its setup; equity reads the clones here, replacing old `v4_equity_company`.",
  source: by("packages/contracts/v4/src/interfaces/IInstaller.sol:53; packages/contracts/v4/src/interfaces/IInstaller.sol:115; apps/indexer/src/v4/installer/schema.ts:12"),
  affects: [table_chain_deployments, table_chain_hats, table_equity_instruments, table_equity_positions, contract_installer, concept_organizations],
});

export const decision_indexing_agents_on_safe_owners = defineDecision({
  id: "indexing.agents-on-safe-owners",
  title: "An agent's AgentOwner state rides on its Safe's row",
  question: "AgentOwner's events (created, frozen, unfrozen, key swapped, swept, removed) describe an agent's Safe. Where are they kept?",
  options: [
    { label: "safe-row", text: "On the agent Safe's row in safe-owners: `agent_owner`, `frozen`, `removed`; the events stay in chain-logs." },
    { label: "agents-table", text: "A chain-agents table of its own, from AgentOwner's events." },
  ],
  chosen: "safe-row",
  why:
    "An agent is a Safe with an owner and a frozen flag: one Safe, one row, and its signer is that Safe's one owner, kept " +
    "current by the Safe's own owner events when the key rotates. `agent list` reads the agents an owner holds by the " +
    "`agent_owner` index, and an agent's sign-in proof checks the same row beside `AgentOwner.agentOf`. A separate table " +
    "would repeat the address and owners.",
  source: by("apps/indexer/src/v4/agent-owner/schema.ts:4; apps/indexer/ponder.schema.ts:62"),
  affects: [table_safe_owners, contract_agent_owner, concept_agents],
});

export const decision_indexing_roles_not_indexed = defineDecision({
  id: "indexing.roles-not-indexed",
  title: "Roles is not indexed: the payout ceiling is read live",
  question:
    "The old indexer kept `roles_module`, `role_assignment` and `role_authority` for the Zodiac Roles permissions. What " +
    "does v4 need from Roles' events?",
  options: [
    { label: "drop", text: "Index nothing of Roles; budgets reads the payout ceiling with `Roles.allowances` when it builds a ceiling batch." },
    { label: "keep", text: "Index Roles' events and the effective assignments, as the old P04 tables did." },
  ],
  chosen: "drop",
  why:
    "On v4 Roles carries only the payout role the install wires and its per-token ceiling; the Roles commands that " +
    "granted permissions are gone (P9, concepts.permissions). Nothing lists Roles assignments, and the one reader of the " +
    "ceiling builds a write from it, which must read the chain at the latest block anyway. The old projection existed " +
    "because Convex could see confirmations out of order. The Roles address stays on chain-deployments.",
  source: by("apps/indexer/ponder.schema.ts:92; apps/indexer/ponder.schema.ts:120; apps/indexer/ponder.schema.ts:152"),
  affects: [table_chain_deployments, contract_roles, concept_budgets, decision_concepts_permissions],
});

// ── equity (low priority) ───────────────────────────────────────────────────────────────────

export const decision_indexing_equity_two_tables = defineDecision({
  id: "indexing.equity-two-tables",
  title: "Equity's twelve read models become instruments and positions",
  question:
    "The old indexer had a table per equity struct (share classes, priced rounds, SAFE rounds and invitations, sales, " +
    "claims, share transfers, balances, vesting and option grants, round positions, SAFE notes). What does the target keep?",
  options: [
    {
      label: "two-tables",
      text:
        "equity-instruments (a company's classes, rounds, sales and transfer offers, with decoded terms) and " +
        "equity-positions (what a holder holds of each); votes stay in chain-logs.",
    },
    { label: "per-struct", text: "Keep one table per contract struct." },
    { label: "logs-only", text: "Equity folds chain-logs at every read." },
  ],
  chosen: "two-tables",
  why:
    "Equity is low priority and its readers ask two questions: a company's instruments, and a holder's positions across " +
    "companies. The old tables had the same key shape and differed only in their terms, which a decoded `terms` holds. A " +
    "cap table folded from logs at every read is too slow for `shares`. Votes are read by the company's Governor (its " +
    "ProposalCreated and VoteCast), which chain-logs' by-safe index serves.",
  source: by("apps/indexer/src/v4/captable/schema.ts:12; apps/indexer/src/v4/rounds/schema.ts:11; apps/indexer/src/v4/exits/schema.ts:8; apps/indexer/src/v4/share-class/schema.ts:12"),
  affects: [table_equity_instruments, table_equity_positions, table_chain_logs],
});

// ── what is not ported ──────────────────────────────────────────────────────────────────────

export const decision_indexing_not_ported = defineDecision({
  id: "indexing.not-ported",
  title: "What of old Ponder and old indexing is not ported",
  question: "Which old tables, endpoints and backend records of the indexed chain have no place in the target?",
  options: [
    {
      label: "drop",
      text:
        "Ponder's `/sql` HTTP endpoints, the `safes` claim and compiled query shapes; the `safe` table's singleton and " +
        "code-hash checks; `native_transfer`; `activity_transfer`; `commitment`; the `payment` copy; Roles' tables; old " +
        "indexing's drift cycles and movement-scan checkpoints; old permissions' receipt-verified chain record.",
    },
    { label: "keep", text: "Port them beside the new views." },
  ],
  chosen: "drop",
  why:
    "Each existed for a store or a shape the target does not have. The HTTP path and its claim served readers outside " +
    "Postgres; views under row-level security replace them (components.ponder). The singleton checks, `activity_transfer` " +
    "and `commitment` are pre-v4 (P9), and native ETH has no reader (indexing.transfers). Drift cycles reconciled Convex's " +
    "copies against Ponder, and the receipt record proved a Convex copy of chain state: nothing copies chain rows now " +
    "(concepts.indexing, concepts.permissions). Movement-scan checkpoints followed Transfers Ponder already indexes; " +
    "payments' Movements are triggered by the Transfer itself, and an added token is books' scan.",
  source: by("docs/as-is/archive/indexing/data.ts; docs/as-is/archive/indexing/drifts.ts; docs/as-is/archive/indexing/movements.ts; apps/indexer/ponder.schema.ts:62"),
  affects: [concept_indexing, table_safe_owners, table_transfers, table_chain_payments, decision_concepts_indexing, decision_concepts_permissions, decision_components_ponder],
});
