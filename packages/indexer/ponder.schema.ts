import { index, onchainTable, primaryKey, uniqueIndex, type PgColumnsBuilders } from "ponder";

// The receipt ordinal, not the block-global log index, identifies a re-included transaction's log.
const log = (t: PgColumnsBuilders) => ({
  log_id: t.text().primaryKey(), chain_id: t.integer().notNull(),
  block_number: t.bigint().notNull(), block_hash: t.hex().notNull(), block_time: t.bigint().notNull(),
  tx_hash: t.hex().notNull(), tx_log_ordinal: t.integer().notNull(), log_index: t.integer().notNull(),
});
export const chainLogs = onchainTable("chain_logs", (t) => ({
  ...log(t), contract: t.text().notNull(), contract_address: t.hex().notNull(), event: t.text().notNull(),
  safes: t.hex().array().notNull(), args: t.jsonb().notNull(),
}), (t) => ({
  event: index("chain-logs-by-event").on(t.contract, t.event, t.block_number, t.log_index),
  tx: uniqueIndex("chain-logs-by-tx").on(t.chain_id, t.tx_hash, t.tx_log_ordinal),
  safe: index("chain-logs-by-safe").on(t.safes, t.contract, t.block_number),
}));
export const transfers = onchainTable("transfers", (t) => ({
  ...log(t), token: t.hex().notNull(), from_address: t.hex().notNull(), to_address: t.hex().notNull(), amount: t.bigint().notNull(),
}), (t) => ({
  incoming: index("transfers-by-to").on(t.to_address, t.block_number, t.log_index),
  outgoing: index("transfers-by-from").on(t.from_address, t.block_number, t.log_index),
  tx: uniqueIndex("transfers-by-tx").on(t.chain_id, t.tx_hash, t.tx_log_ordinal),
}));
export const chainPayments = onchainTable("chain_payments", (t) => ({
  ...log(t), payment_id: t.hex().notNull(), sender: t.hex().notNull(), recipient: t.hex().notNull(),
  token: t.hex().notNull(), amount: t.bigint().notNull(), kind: t.integer().notNull(), document_hash: t.hex().notNull(),
  budget_id: t.text(), scheduled_id: t.text(), agreement_id: t.text(), escrow_address: t.hex(),
}), (t) => ({
  payment: uniqueIndex("chain-payments-by-payment-id").on(t.chain_id, t.payment_id),
  sender: index("chain-payments-by-sender").on(t.sender, t.block_number, t.log_index),
  recipient: index("chain-payments-by-recipient").on(t.recipient, t.block_number, t.log_index),
  budget: index("chain-payments-by-budget").on(t.budget_id, t.block_number),
  tx: uniqueIndex("chain-payments-by-tx").on(t.chain_id, t.tx_hash, t.tx_log_ordinal),
}));
export const userOperations = onchainTable("user_operations", (t) => ({
  ...log(t), user_op_hash: t.hex().notNull(), sender: t.hex().notNull(), paymaster: t.hex().notNull(),
  nonce_key: t.text().notNull(), nonce_sequence: t.text().notNull(),
  success: t.boolean().notNull(), actual_gas_cost: t.bigint().notNull(), actual_gas_used: t.bigint().notNull(),
}), (t) => ({
  hash: uniqueIndex("user-operations-by-hash").on(t.user_op_hash),
  nonce: uniqueIndex("user-operations-by-sender-nonce").on(t.sender, t.nonce_key, t.nonce_sequence),
  tx: uniqueIndex("user-operations-by-tx").on(t.chain_id, t.tx_hash, t.tx_log_ordinal),
}));
export const progress = onchainTable("indexer_progress", (t) => ({
  chain_id: t.integer().primaryKey(), indexed_block: t.bigint().notNull(), indexed_block_hash: t.hex().notNull(), indexed_block_time: t.bigint().notNull(),
}));
export const knownSafes = onchainTable("known_safes", (t) => ({ address: t.hex().primaryKey() }));
export const hatTrees = onchainTable("hat_trees", (t) => ({
  root: t.text().primaryKey(), company_safe: t.hex().notNull(), tree: t.text().notNull(),
}));

const provenance = (t: PgColumnsBuilders) => ({
  created_log_id: t.text().notNull(), last_log_id: t.text().notNull(), updated_block: t.bigint().notNull(),
});
export const safeOwners = onchainTable("safe_owners", (t) => ({
  safe_address: t.hex().primaryKey(), chain_id: t.integer().notNull(), kind: t.text().notNull(), deployed: t.boolean().notNull(),
  owners: t.hex().array().notNull(), threshold: t.integer().notNull(), nonce: t.bigint().notNull(),
  modules: t.hex().array().notNull(), guard: t.hex(), founder_safe: t.hex(), agent_owner: t.hex(),
  frozen: t.boolean().notNull(), removed: t.boolean().notNull(), ...provenance(t),
}), (t) => ({
  owner: index("safe-owners-by-owner").on(t.owners, t.kind),
  agentOwner: index("safe-owners-by-agent-owner").on(t.agent_owner, t.removed),
}));
export const safeApprovals = onchainTable("safe_approvals", (t) => ({
  ...log(t), safe_address: t.hex().notNull(), safe_tx_hash: t.hex().notNull(), owner: t.hex().notNull(),
}), (t) => ({
  safeTx: index("safe-approvals-by-safe-tx").on(t.safe_address, t.safe_tx_hash, t.owner),
  owner: index("safe-approvals-by-owner").on(t.owner, t.block_number),
  tx: uniqueIndex("safe-approvals-by-tx").on(t.chain_id, t.tx_hash, t.tx_log_ordinal),
}));
export const safeExecutions = onchainTable("safe_executions", (t) => ({
  ...log(t), safe_address: t.hex().notNull(), safe_tx_hash: t.hex().notNull(), safe_nonce: t.bigint().notNull(), success: t.boolean().notNull(),
}), (t) => ({
  safeTx: uniqueIndex("safe-executions-by-safe-tx").on(t.safe_address, t.safe_tx_hash),
  nonce: uniqueIndex("safe-executions-by-safe-nonce").on(t.safe_address, t.safe_nonce),
  tx: uniqueIndex("safe-executions-by-tx").on(t.chain_id, t.tx_hash, t.tx_log_ordinal),
}));
export const chainHats = onchainTable("chain_hats", (t) => ({
  hat_id: t.text().primaryKey(), chain_id: t.integer().notNull(), company_safe: t.hex().notNull(), tree: t.text().notNull(),
  admin_hat_id: t.text(), level: t.integer().notNull(), details: t.text().notNull(), max_supply: t.integer().notNull(),
  supply: t.integer().notNull(), eligibility: t.hex().notNull(), toggle: t.hex().notNull(), active: t.boolean().notNull(), mutable: t.boolean().notNull(),
  ...provenance(t),
}), (t) => ({
  admin: index("chain-hats-by-admin").on(t.admin_hat_id, t.hat_id),
  company: index("chain-hats-by-company").on(t.company_safe, t.tree, t.level),
}));
export const hatWearers = onchainTable("hat_wearers", (t) => ({
  hat_id: t.text().notNull(), wearer: t.hex().notNull(), chain_id: t.integer().notNull(), company_safe: t.hex().notNull(),
  holds: t.boolean().notNull(), standing: t.boolean().notNull(), wearing: t.boolean().notNull(), since_block: t.bigint().notNull(),
  ...provenance(t),
}), (t) => ({
  key: primaryKey({ columns: [t.hat_id, t.wearer] }),
  wearer: index("hat-wearers-by-wearer").on(t.wearer, t.company_safe, t.wearing),
  company: index("hat-wearers-by-company").on(t.company_safe, t.hat_id, t.wearing),
}));
export const chainBudgets = onchainTable("chain_budgets", (t) => ({
  budget_id: t.text().primaryKey(), chain_id: t.integer().notNull(), company_safe: t.hex().notNull(), parent_budget_id: t.text(),
  token: t.hex().notNull(), period: t.integer().notNull(), amount: t.bigint().notNull(), hat_id: t.text().notNull(),
  closed: t.boolean().notNull(), committed: t.bigint().notNull(), ...provenance(t),
}), (t) => ({
  company: index("chain-budgets-by-company").on(t.company_safe, t.parent_budget_id, t.budget_id),
  hat: index("chain-budgets-by-hat").on(t.hat_id, t.closed),
}));
