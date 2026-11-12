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
import { approvedBy, approveProposal, claimPersonalSafe, createCompany, createDepartment, ENTRY_POINT, ENTRY_POINT_V07, ERC20, grantHat, leftOf, pay, payByUserOp, proposeGrant, revokeHat, setBudget, viaEntryPoint, wears, type Protocol } from "./service.ts";

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

  await revokeHat(p, company, finance, holder.address);
  assert.equal(await wears(p, holder.address, finance), false, "the hat is gone after the Board takes it back");
  const revoked = await pay(p, { key: holder.key, budget: department, to: payee, amount: UNIT, kind: 1, documentHash: hash("z"), jobNonce: hash(`${name} z`) });
  assert.deepEqual([revoked.ok, !revoked.ok && revoked.reason], [false, "NOT_AUTHORISED"]);
});

test("with a second Director, a grant waits as a Board proposal until that Director approves; a stale proposal is refused", { skip: rpc === undefined && "DEVNET_RPC is not set" }, async () => {
  const chain = await connect(rpc as string);
  const record = JSON.parse(await readFile(join(contracts, "deployments/devnet.json"), "utf8")) as DeploymentRecord;
  const artifact = async (file: string, name: string) => JSON.parse(await readFile(join(contracts, "out", file, `${name}.json`), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  const p: Protocol = { chain, record, installerAbi: (await artifact("Installer.sol", "Installer")).abi };
  const deployer = testKey("deployer");
  const tokenArtifact = await artifact("MockERC20.sol", "MockERC20");
  const deployHash = await chain.walletFor(deployer.key).deployContract({ abi: tokenArtifact.abi, bytecode: tokenArtifact.bytecode.object, args: ["Test USD", "TUSD", 6] });
  const token = (await chain.client.waitForTransactionReceipt({ hash: deployHash })).contractAddress as Hex;
  const name = `board-test-${Date.now()}`;
  const second = testKey("directorTwo");
  const company = await createCompany(p, { tierService: testKey("tierService").key, relayer: deployer.key, founder: testKey("founder").key }, {
    founderEmail: `${name}@acme.test`,
    company: name,
    token,
    officers: [{ details: "Finance", maxSupply: 3 }],
    ceiling: 1_000n * UNIT,
    topAmount: 1_000n * UNIT,
    salt: hash(name),
    coDirectors: [{ email: `${name}-two@acme.test`, key: second.key }],
  });
  const director = company.coDirectors?.[0];
  assert.ok(director, "the company has its second Director");

  const finance = company.officerHats[0] as bigint;
  const wearer = testKey("second").address;
  const proposal = await proposeGrant(p, company, finance, wearer);
  assert.deepEqual([await approvedBy(p, company, company.founderSafe, proposal.safeTxHash), await approvedBy(p, company, director.safe, proposal.safeTxHash), await wears(p, wearer, finance)], [true, false, false], "the founder approved; the grant waits");
  const done = await approveProposal(p, company, proposal, director);
  assert.equal(done.executed, true);
  assert.equal(await wears(p, wearer, finance), true, "after the second Director approves, the member wears the hat");

  const first = await proposeGrant(p, company, finance, testKey("payee").address);
  await grantHat(p, company, finance, testKey("agent").address);
  await assert.rejects(approveProposal(p, company, first, director), /STALE_PROPOSAL/);
});

test("a hat worn by a personal Safe pays by UserOperation through the EntryPoint, with a paymaster paying the gas", { skip: rpc === undefined && "DEVNET_RPC is not set" }, async () => {
  const chain = await connect(rpc as string);
  const record = JSON.parse(await readFile(join(contracts, "deployments/devnet.json"), "utf8")) as DeploymentRecord;
  const artifact = async (file: string, name: string) => JSON.parse(await readFile(join(contracts, "out", file, `${name}.json`), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  const p: Protocol = { chain, record, installerAbi: (await artifact("Installer.sol", "Installer")).abi };
  const deployer = testKey("deployer");
  const deploy = async (file: string, name: string, args: readonly unknown[]) => {
    const a = await artifact(file, name);
    const h = await chain.walletFor(deployer.key).deployContract({ abi: a.abi, bytecode: a.bytecode.object, args });
    return { address: (await chain.client.waitForTransactionReceipt({ hash: h })).contractAddress as Hex, abi: a.abi };
  };
  const token = (await deploy("MockERC20.sol", "MockERC20", ["Test USD", "TUSD", 6])).address;
  const paymaster = await deploy("MockPaymaster.sol", "MockPaymaster", [ENTRY_POINT_V07]);
  await send(chain, { from: deployer.key, to: ENTRY_POINT_V07, value: 10n ** 18n, data: encodeFunctionData({ abi: ENTRY_POINT, functionName: "depositTo", args: [paymaster.address] }) });

  const name = `userop-test-${Date.now()}`;
  const company = await createCompany(p, { tierService: testKey("tierService").key, relayer: deployer.key, founder: testKey("founder").key }, {
    founderEmail: `${name}@acme.test`, company: name, token, officers: [{ details: "Finance", maxSupply: 3 }],
    ceiling: 50_000n * UNIT, topAmount: 50_000n * UNIT, salt: hash(name),
  });
  await send(chain, { from: deployer.key, to: token, data: encodeFunctionData({ abi: ERC20, functionName: "mint", args: [company.companySafe, 10_000n * UNIT] }) });
  const finance = company.officerHats[0] as bigint;
  const department = await createDepartment(p, company, finance);
  await setBudget(p, company, department, 2_000n * UNIT);

  const holder = testKey("second");
  const safe = await claimPersonalSafe(p, testKey("tierService").key, `holder-${name}@acme.test`, holder.address);
  assert.equal(await claimPersonalSafe(p, testKey("tierService").key, `holder-${name}@acme.test`, holder.address), safe, "claiming again is a no-op");
  await grantHat(p, company, finance, safe);
  const gasBefore = await chain.client.getBalance({ address: safe });
  const payee = testKey("payee").address;
  const before = await chain.client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [payee] });
  const submit = viaEntryPoint(chain, deployer.key);
  const paid = await payByUserOp(p, { safe, ownerKey: holder.key, paymaster: paymaster.address, submit, budget: department, to: payee, amount: 125_500_000n, kind: 1, documentHash: hash(`${name} PINV-0001`), jobNonce: hash(`${name} job 1`) });
  assert.equal(paid.ok, true, JSON.stringify(paid, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  assert.match(paid.ok ? (paid.userOpHash ?? "") : "", /^0x[0-9a-f]{64}$/, "the payment names its UserOperation");
  const after = await chain.client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [payee] });
  assert.equal(after - before, 125_500_000n, "the payee gained exactly 125.50");
  assert.equal(await chain.client.getBalance({ address: safe }), gasBefore, "the paymaster paid the gas, not the Safe");

  const wrongSigner = await payByUserOp(p, { safe, ownerKey: testKey("stranger").key, paymaster: paymaster.address, submit, budget: department, to: payee, amount: UNIT, kind: 1, documentHash: hash("w"), jobNonce: hash(`${name} w`) }).catch((e: Error) => e);
  assert.ok(wrongSigner instanceof Error, "an op signed by someone who does not own the Safe is refused by the EntryPoint");
  const over = await payByUserOp(p, { safe, ownerKey: holder.key, paymaster: paymaster.address, submit, budget: department, to: payee, amount: 5_000n * UNIT, kind: 1, documentHash: hash("y"), jobNonce: hash(`${name} y`) });
  assert.deepEqual([over.ok, !over.ok && over.reason], [false, "OVER_BUDGET"]);
});
