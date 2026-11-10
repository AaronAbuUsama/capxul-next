// Deploys the STAND-IN contracts to the chain at RPC_URL and writes deployment.json.
// Run by bin/chain-up.sh after `forge build`.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Abi, Hex } from "viem";
import { readFileSync } from "node:fs";
import { publicClient, wallet } from "./chain.ts";
import { config } from "./config.ts";
import { operatorKey } from "./people.ts";

const w = wallet(operatorKey);
const artifact = (file: string, name: string) =>
  JSON.parse(readFileSync(`${config.outDir}/${file}.sol/${name}.json`, "utf8")) as { abi: Abi; bytecode: { object: Hex } };

async function deploy(file: string, name: string, args: unknown[] = []) {
  const a = artifact(file, name);
  const hash = await w.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args });
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (!r.contractAddress) throw new Error(`${name}: no contract address in receipt`);
  console.log(`  ${name} ${r.contractAddress}`);
  return { address: r.contractAddress, abi: a.abi };
}

async function call(c: { address: Hex; abi: Abi }, functionName: string, args: unknown[]) {
  const hash = await w.writeContract({ address: c.address, abi: c.abi, functionName, args });
  await publicClient.waitForTransactionReceipt({ hash });
}

const usdc = await deploy("TestUSDC", "TestUSDC");
const hats = await deploy("Hats", "Hats");
const payments = await deploy("Payments", "Payments", [hats.address, usdc.address]);
const orgs = await deploy("Orgs", "Orgs", [hats.address, payments.address, usdc.address]);
await call(hats, "setOrgs", [orgs.address]);
await call(payments, "setOrgs", [orgs.address]);

const out = {
  _note: "STAND-IN contracts for the walking skeleton. Not Capxul's v4 contracts.",
  chainId: await publicClient.getChainId(),
  rpc: config.rpcUrl,
  deployer: w.account.address,
  usdc: usdc.address, hats: hats.address, orgs: orgs.address, payments: payments.address,
  deployedBlock: Number(await publicClient.getBlockNumber()),
  deployedAt: new Date().toISOString(),
};
mkdirSync(dirname(config.deploymentFile), { recursive: true });
writeFileSync(config.deploymentFile, JSON.stringify(out, null, 2));
console.log(`wrote ${config.deploymentFile}`);
