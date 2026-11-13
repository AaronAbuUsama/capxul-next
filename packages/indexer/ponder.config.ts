import { readFileSync } from "node:fs";
import { createConfig, factory } from "ponder";
import { parseAbiItem } from "viem";
import { AGENT_OWNER, AGREEMENTS, BUDGETS, COMPANY, ENTRY_POINT, HATS, INSTALLER, PAYMENT, SAFE, TOKEN } from "./abis.ts";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (no file-backed indexer fallback)`);
  return value;
}
const deployment = JSON.parse(readFileSync(env("DEPLOYMENT_FILE"), "utf8")) as {
  chainId: number; usdc: `0x${string}`; payments: `0x${string}`; hats: `0x${string}`;
  companiesHouse: `0x${string}`; installer: `0x${string}`; deployedBlock: number;
  budgets: `0x${string}`; agreements: `0x${string}`; agentOwner: `0x${string}`;
};
for (const name of ["budgets", "agreements", "agentOwner"] as const)
  if (!/^0x[0-9a-fA-F]{40}$/.test(deployment[name])) throw new Error(`DEPLOYMENT_FILE requires ${name} from the real v4 deployment`);
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
    Budgets: { ...one, abi: BUDGETS, address: deployment.budgets },
    Agreements: { ...one, abi: AGREEMENTS, address: deployment.agreements },
    AgentOwner: { ...one, abi: AGENT_OWNER, address: deployment.agentOwner },
    CompanySafe: { ...one, abi: SAFE, address: factory({ address: deployment.companiesHouse, event: COMPANY[0], parameter: "safe" }) },
    PersonSafe: { ...one, abi: SAFE, address: factory({ address: deployment.companiesHouse, event: COMPANY[1], parameter: "safe" }) },
    AgentSafe: { ...one, abi: SAFE, address: factory({ address: deployment.agentOwner,
      event: parseAbiItem("event AgentCreated(address indexed safe,address indexed owner,address indexed signer)"), parameter: "safe" }) },
  },
  blocks: { Head: { chain: "world", startBlock: deployment.deployedBlock, interval: 1 } },
});
