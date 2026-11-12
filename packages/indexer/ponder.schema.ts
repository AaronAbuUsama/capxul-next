import { index, onchainTable, type PgColumnsBuilders } from "ponder";

// The receipt ordinal, not the block-global log index, identifies a re-included transaction's log.
const log = (t: PgColumnsBuilders) => ({
  log_id: t.text().primaryKey(), chain_id: t.integer().notNull(),
  block_number: t.bigint().notNull(), block_hash: t.hex().notNull(), block_time: t.bigint().notNull(),
  tx_hash: t.hex().notNull(), tx_log_ordinal: t.integer().notNull(), log_index: t.integer().notNull(),
});
export const chainLogs = onchainTable("chain_logs", (t) => ({
  ...log(t), contract: t.text().notNull(), event: t.text().notNull(), args: t.jsonb().notNull(),
}));
export const transfers = onchainTable("transfers", (t) => ({
  ...log(t), token: t.hex().notNull(), from: t.hex().notNull(), to: t.hex().notNull(), amount: t.bigint().notNull(),
}), (t) => ({ incoming: index().on(t.to, t.block_number), outgoing: index().on(t.from, t.block_number) }));
export const chainPayments = onchainTable("chain_payments", (t) => ({
  ...log(t), payment_id: t.hex().notNull(), sender: t.hex().notNull(), recipient: t.hex().notNull(),
  token: t.hex().notNull(), amount: t.bigint().notNull(), kind: t.integer().notNull(), document_hash: t.hex().notNull(),
}), (t) => ({ bySafe: index().on(t.sender, t.block_number) }));
export const userOperations = onchainTable("user_operations", (t) => ({
  ...log(t), user_op_hash: t.hex().notNull(), sender: t.hex().notNull(), paymaster: t.hex().notNull(),
  nonce: t.bigint().notNull(), success: t.boolean().notNull(), actual_gas_cost: t.bigint().notNull(), actual_gas_used: t.bigint().notNull(),
}));
export const progress = onchainTable("indexer_progress", (t) => ({
  chain_id: t.integer().primaryKey(), indexed_block: t.bigint().notNull(), indexed_block_hash: t.hex().notNull(), indexed_block_time: t.bigint().notNull(),
}));
export const knownSafes = onchainTable("known_safes", (t) => ({ address: t.hex().primaryKey() }));
export const hatTrees = onchainTable("hat_trees", (t) => ({ root: t.text().primaryKey(), company_safe: t.hex().notNull() }));
