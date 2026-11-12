// One world's Ponder: the v4 contracts of one anvil world, the Safes, hat tree and escrows Capxul made, and the world's
// token. Read from the environment: WORLD_RPC, WORLD_START_BLOCK, WORLD_TOKEN, DEPLOYMENTS, and DATABASE_URL (Postgres;
// without it, PGlite under PGLITE_DIR). Kept small on purpose: it exists to measure what Ponder costs per world
// (docs/mission/world-cost.md), not to be the product's indexer.
import { readFileSync } from "node:fs";
import { createConfig, factory } from "ponder";

import { ERC20, FACTORY, HATS, SAFE, V4 } from "./abis";

const env = (name: string, fallback?: string): string => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`${name} is not set`);
  return v;
};
const deployments = JSON.parse(readFileSync(env("DEPLOYMENTS", "../../contracts/deployments/devnet.json"), "utf8")) as {
  companiesHouse: `0x${string}`;
  contracts: Record<string, { address: `0x${string}` }>;
};
const at = (name: string) => deployments.contracts[name]!.address;
const startBlock = Number(env("WORLD_START_BLOCK", "0"));
const house = deployments.companiesHouse;
const installer = at("Installer");
const chain = "world" as const;
const one = { chain, startBlock };
const equityClone = (parameter: string) => factory({ address: installer, event: FACTORY.equity, parameter: `deployment.${parameter}` as never, startBlock });

export default createConfig({
  database: process.env.DATABASE_URL
    ? { kind: "postgres", connectionString: process.env.DATABASE_URL, poolConfig: { max: Number(env("PG_POOL_MAX", "30")) } }
    : { kind: "pglite", directory: env("PGLITE_DIR", ".ponder/pglite") },
  chains: { world: { id: 84532, rpc: env("WORLD_RPC"), pollingInterval: Number(env("POLL_MS", "1000")), ethGetLogsBlockRange: 10_000 } },
  contracts: {
    // The claimer and minter run by delegatecall from the Companies House Safe, so their events carry its address.
    CompaniesHouse: { ...one, abi: [...V4.CompaniesHouseClaimer, ...V4.CompanySafeMinter], address: house },
    Installer: { ...one, abi: V4.Installer, address: installer },
    Budgets: { ...one, abi: V4.Budgets, address: at("Budgets") },
    Agreements: { ...one, abi: V4.Agreements, address: at("Agreements") },
    Payments: { ...one, abi: V4.Payments, address: at("Payments") },
    EscrowFactory: { ...one, abi: V4.EscrowFactory, address: at("EscrowFactory") },
    AgentOwner: { ...one, abi: V4.AgentOwner, address: at("AgentOwner") },
    Escrow: { ...one, abi: V4.Escrow, address: factory({ address: at("EscrowFactory"), event: FACTORY.escrow, parameter: "escrow", startBlock }) },
    CompanySafe: { ...one, abi: SAFE, address: factory({ address: house, event: FACTORY.companySafe, parameter: "safe", startBlock }) },
    PersonSafe: { ...one, abi: SAFE, address: factory({ address: house, event: FACTORY.personSafe, parameter: "safe", startBlock }) },
    AgentSafe: { ...one, abi: SAFE, address: factory({ address: at("AgentOwner"), event: FACTORY.agentSafe, parameter: "safe", startBlock }) },
    Captable: { ...one, abi: V4.Captable, address: equityClone("captable") },
    Governor: { ...one, abi: V4.Governor, address: equityClone("governor") },
    Options: { ...one, abi: V4.Options, address: equityClone("options") },
    Rounds: { ...one, abi: V4.Rounds, address: equityClone("rounds") },
    Exits: { ...one, abi: V4.Exits, address: equityClone("exits") },
    Hats: { ...one, abi: HATS, address: "0x3bc1A0Ad72417f2d411118085256fC53CBdDd137" },
    Token: { ...one, abi: ERC20, address: env("WORLD_TOKEN") as `0x${string}` },
  },
});
