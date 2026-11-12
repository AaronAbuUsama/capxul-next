import { readFileSync } from "node:fs";
import { createConfig } from "ponder";
import { COMPANY, ENTRY_POINT, HATS, INSTALLER, PAYMENT, TOKEN } from "./abis.ts";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (no file-backed indexer fallback)`);
  return value;
}
const deployment = JSON.parse(readFileSync(env("DEPLOYMENT_FILE"), "utf8")) as {
  chainId: number; usdc: `0x${string}`; payments: `0x${string}`; hats: `0x${string}`;
  companiesHouse: `0x${string}`; installer: `0x${string}`; deployedBlock: number;
};
const one = { chain: "world" as const, startBlock: deployment.deployedBlock };
export default createConfig({
  database: { kind: "postgres", connectionString: env("PONDER_DATABASE_URL"), poolConfig: { max: 10 } },
  chains: { world: {
    id: deployment.chainId, rpc: env("RPC_URL"), pollingInterval: 100, cacheRpcRequests: false,
  } },
  contracts: {
    Company: { ...one, abi: COMPANY, address: deployment.companiesHouse },
    Installer: { ...one, abi: INSTALLER, address: deployment.installer },
    Payments: { ...one, abi: PAYMENT, address: deployment.payments },
    Token: { ...one, abi: TOKEN, address: deployment.usdc },
    Hats: { ...one, abi: HATS, address: deployment.hats },
    EntryPoint: { ...one, abi: ENTRY_POINT, address: env("ENTRY_POINT_ADDRESS") as `0x${string}` },
  },
  blocks: { Head: { chain: "world", startBlock: deployment.deployedBlock, interval: 1 } },
});
