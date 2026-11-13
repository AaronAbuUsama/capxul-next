// The smallest Ponder app that proves the path: one contract, one event, one table.
// Postgres is the world's Neon branch; the chain is reached through the world's door, never directly.
import { createConfig } from "ponder";
import { parseAbi } from "viem";

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export default createConfig({
  database: { kind: "postgres", connectionString: need("DATABASE_URL"), poolConfig: { max: 5 } },
  // reorgWindow 0: the world's chain has one writer and never reorganises, and the seeded chain keeps only nine
  // blocks of history, so Ponder's default search for a block 180 seconds back asks for blocks that do not exist.
  chains: { world: { id: 84532, rpc: need("RPC_URL"), pollingInterval: 2000, cacheRpcRequests: false, reorgWindow: 0 } },
  contracts: {
    Pinger: {
      chain: "world",
      abi: parseAbi(["event Ping()"]),
      address: "0x00000000000000000000000000000000000c0de1",
      startBlock: Number(need("START_BLOCK")),
    },
  },
});
