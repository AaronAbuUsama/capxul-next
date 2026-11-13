import { onchainTable } from "ponder";

export const pings = onchainTable("pings", (t) => ({
  id: t.text().primaryKey(),
  block_number: t.bigint().notNull(),
  block_hash: t.hex().notNull(),
  tx_hash: t.hex().notNull(),
}));
