// The company module against the seeded v4 chain. It needs a chain started from state/core.json
// (packages/contracts/bin/chain-up.sh) and a forge build (for the token and Installer artifacts), so it runs only when
// DEVNET_RPC names that chain: `DEVNET_RPC=http://127.0.0.1:18545 pnpm devnet:test`.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { encodeFunctionData, keccak256, stringToHex, type Abi, type Hex } from "viem";

import { connect, send } from "../chain/service.ts";
import type { DeploymentRecord } from "../protocol/types.ts";
import { testKey } from "../test-keys/service.ts";
import { createCompany, createDepartment, ERC20, grantHat, leftOf, pay, setBudget, wears, type Protocol } from "./service.ts";

const rpc = process.env.DEVNET_RPC;
const contracts = join(fileURLToPath(new URL(".", import.meta.url)), "../../../../contracts");
const UNIT = 1_000_000n;
const hash = (text: string): Hex => keccak256(stringToHex(text));

test("a company is born, gets a department with a hat and a budget, and its wearer pays with a document hash; the refusals hold", { skip: rpc === undefined && "DEVNET_RPC is not set" }, async () => {
  const chain = await connect(rpc as string);
  const record = JSON.parse(await readFile(join(contracts, "deployments/devnet.json"), "utf8")) as DeploymentRecord;
  const artifact = async (file: string, name: string) => JSON.parse(await readFile(join(contracts, "out", file, `${name}.json`), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  const installer = await artifact("Installer.sol", "Installer");
  const tokenArtifact = await artifact("MockERC20.sol", "MockERC20");
  const p: Protocol = { chain, record, installerAbi: installer.abi };
  const deployer = testKey("deployer");

  const deployHash = await chain.walletFor(deployer.key).deployContract({ abi: tokenArtifact.abi, bytecode: tokenArtifact.bytecode.object, args: ["Test USD", "TUSD", 6] });
  const token = (await chain.client.waitForTransactionReceipt({ hash: deployHash })).contractAddress as Hex;

  const name = `company-test-${Date.now()}`;
  const company = await createCompany(p, { tierService: testKey("tierService").key, relayer: deployer.key, founder: testKey("founder").key }, {
    founderEmail: `${name}@acme.test`,
    company: name,
    token,
    officers: [{ details: "Finance", maxSupply: 3 }],
    ceiling: 50_000n * UNIT,
    topAmount: 50_000n * UNIT,
    salt: hash(name),
  });
  assert.equal(await wears(p, company.companySafe, company.boardTopHat), true, "the company Safe wears the Board's top hat");
  await send(chain, { from: deployer.key, to: token, data: encodeFunctionData({ abi: ERC20, functionName: "mint", args: [company.companySafe, 10_000n * UNIT] }) });

  const finance = company.officerHats[0] as bigint;
  const department = await createDepartment(p, company, finance);
  const holder = testKey("second");
  await grantHat(p, company, finance, holder.address);
  assert.equal(await wears(p, holder.address, finance), true);
  await setBudget(p, company, department, 2_000n * UNIT);
  assert.equal(await leftOf(p, department), 2_000n * UNIT);

  const payee = testKey("payee").address;
  const before = await chain.client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [payee] });
  const doc = hash(`${name} PINV-0001`);
  const paid = await pay(p, { key: holder.key, budget: department, to: payee, amount: 125_500_000n, kind: 1, documentHash: doc, jobNonce: hash(`${name} job 1`) });
  assert.equal(paid.ok, true, JSON.stringify(paid));
  const after = await chain.client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [payee] });
  assert.equal(after - before, 125_500_000n, "the payee gained exactly 125.50");

  const stranger = await pay(p, { key: testKey("stranger").key, budget: department, to: payee, amount: UNIT, kind: 1, documentHash: hash("x"), jobNonce: hash(`${name} x`) });
  assert.deepEqual([stranger.ok, !stranger.ok && stranger.reason], [false, "NOT_AUTHORISED"]);
  const over = await pay(p, { key: holder.key, budget: department, to: payee, amount: 5_000n * UNIT, kind: 1, documentHash: hash("y"), jobNonce: hash(`${name} y`) });
  assert.deepEqual([over.ok, !over.ok && over.reason], [false, "OVER_BUDGET"]);
});
