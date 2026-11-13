// The world's configuration of the real index (packages/indexer): the same six contracts and the same block
// handler, read from the same ABIs. It differs from packages/indexer/ponder.config.ts in three ways, each forced by
// where it runs:
//   - the addresses come from the contracts' own deployment record, which is in the image, not from a file written
//     when a devnet is born; the token is the world's test USDC, which is put on the chain at the same address in
//     every world when the world is created (src/chain/faucet.ts); indexing starts at the seed's first block;
//   - reorgWindow is 0: a world's chain has one writer and never reorganises, and the seeded chain keeps nine blocks
//     of history, so Ponder's default search for a block 180 seconds back asks for blocks that do not exist;
//   - it polls once a second, not ten times: every call crosses the world's door.
import { readFileSync } from "node:fs";
import { createConfig } from "ponder";
import { COMPANY, ENTRY_POINT, HATS, INSTALLER, PAYMENT, TOKEN } from "./abis.ts";

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const record = JSON.parse(readFileSync(new URL("./deployment-record.json", import.meta.url), "utf8")) as {
  chainId: number;
  companiesHouse: `0x${string}`;
  contracts: { Payments: { address: `0x${string}` }; Installer: { address: `0x${string}` } };
};

/** The first block of packages/contracts/state/core.json that holds a transaction. */
const SEED_START = 47_893_252;
const one = { chain: "world" as const, startBlock: SEED_START };

export default createConfig({
  database: { kind: "postgres", connectionString: need("DATABASE_URL"), poolConfig: { max: 5 } },
  chains: {
    world: { id: record.chainId, rpc: need("RPC_URL"), pollingInterval: 1000, cacheRpcRequests: false, reorgWindow: 0 },
  },
  contracts: {
    Company: { ...one, abi: COMPANY, address: record.companiesHouse },
    Installer: { ...one, abi: INSTALLER, address: record.contracts.Installer.address },
    Payments: { ...one, abi: PAYMENT, address: record.contracts.Payments.address },
    Token: { ...one, abi: TOKEN, address: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6" },
    Hats: { ...one, abi: HATS, address: "0x3bc1A0Ad72417f2d411118085256fC53CBdDd137" },
    EntryPoint: { ...one, abi: ENTRY_POINT, address: "0x0000000071727De22E5E9d8BAf0edAc6f37da032" },
  },
  blocks: { Head: { chain: "world", startBlock: SEED_START, interval: 1 } },
});
