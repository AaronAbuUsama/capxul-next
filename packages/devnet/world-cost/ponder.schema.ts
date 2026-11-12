// A cut-down copy of the blueprint's indexing tables (blueprint/indexing/data.ts): the one decoded log (chain-logs),
// two fact tables (transfers, chain-payments) and three projections (safe-owners, chain-budgets, hat-wearers). Enough
// to give Ponder an honest write load per event; the real package (a separate task) owns the full set.
import { index, onchainTable } from "ponder";

const logColumns = (t: any) => ({
  logId: t.text().primaryKey(),
  chainId: t.integer().notNull(),
  blockNumber: t.bigint().notNull(),
  logIndex: t.integer().notNull(),
  txHash: t.hex().notNull(),
  blockTime: t.bigint().notNull(),
});

export const chainLogs = onchainTable(
  "chain_logs",
  (t) => ({ ...logColumns(t), contract: t.text().notNull(), contractAddress: t.hex().notNull(), event: t.text().notNull(), args: t.jsonb().notNull(), safes: t.text().array().notNull() }),
  (t) => ({ byEvent: index().on(t.contract, t.event, t.blockNumber, t.logIndex) }),
);

export const transfers = onchainTable(
  "transfers",
  (t) => ({ ...logColumns(t), token: t.hex().notNull(), from: t.hex().notNull(), to: t.hex().notNull(), amount: t.bigint().notNull() }),
  (t) => ({ byFrom: index().on(t.from), byTo: index().on(t.to) }),
);

export const chainPayments = onchainTable("chain_payments", (t) => ({
  ...logColumns(t),
  paymentId: t.hex().notNull(),
  sender: t.hex().notNull(),
  recipient: t.hex().notNull(),
  token: t.hex().notNull(),
  amount: t.bigint().notNull(),
  kind: t.integer().notNull(),
  documentHash: t.hex().notNull(),
}));

export const safeOwners = onchainTable("safe_owners", (t) => ({
  safe: t.hex().primaryKey(),
  kind: t.text().notNull(),
  owners: t.text().array().notNull(),
  threshold: t.integer().notNull(),
  nonce: t.bigint().notNull(),
  updatedBlock: t.bigint().notNull(),
}));

export const chainBudgets = onchainTable("chain_budgets", (t) => ({
  budgetId: t.bigint().primaryKey(),
  safe: t.hex(),
  amount: t.bigint().notNull(),
  spent: t.bigint().notNull(),
  updatedBlock: t.bigint().notNull(),
}));

export const hatWearers = onchainTable(
  "hat_wearers",
  (t) => ({ id: t.text().primaryKey(), hatId: t.text().notNull(), wearer: t.hex().notNull(), wearing: t.boolean().notNull(), updatedBlock: t.bigint().notNull() }),
);
