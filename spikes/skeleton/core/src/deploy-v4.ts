// The v4 contracts are already in the seeded state, so a world's setup only deploys its
// test token (packages/contracts' MockERC20, 6 decimals) and the mock paymaster that pays its UserOperations' gas
// (MockPaymaster, funded at the EntryPoint; thin-line.bundler), and writes deployment.json in the stand-in's shape, with mode v4.
// Run by bin/chain-up.sh.
import { writeFileSync } from "node:fs";
import type { Address } from "viem";
import { config } from "./config.ts";
import { operatorKey } from "./people.ts";
import { ensurePaymaster, fundPeople, proto, tokenArtifact, v4Addresses } from "./v4.ts";

const p = await proto();
await fundPeople();
const t = tokenArtifact();
const hash = await p.chain.walletFor(operatorKey).deployContract({ abi: t.abi, bytecode: t.bytecode.object, args: ["Test USD Coin", "USDC", 6] });
const r = await p.chain.client.waitForTransactionReceipt({ hash });
if (!r.contractAddress) throw new Error("the test token did not deploy");
const a = await v4Addresses();
const out = {
  mode: "v4", chainId: p.chain.chainId, deployer: p.chain.walletFor(operatorKey).account.address,
  usdc: r.contractAddress as Address, hats: a.hats, payments: a.payments, budgets: a.budgets, orgs: a.budgets,
  companiesHouse: p.record.companiesHouse, deployedBlock: Number(r.blockNumber),
};
writeFileSync(config.deploymentFile, JSON.stringify(out, null, 2));
const paymaster = await ensurePaymaster();   // after deployment.json exists: it records itself there
console.log(`  test USDC ${out.usdc}; paymaster ${paymaster}; v4 Payments ${out.payments}, Budgets ${out.budgets}, Hats ${out.hats}\nwrote ${config.deploymentFile}`);
