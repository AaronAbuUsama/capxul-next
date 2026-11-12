// The company module against the seeded v4 chain. It needs a chain started from state/core.json
// (packages/contracts/bin/chain-up.sh) and a forge build (for the token and Installer artifacts), so it runs only when
// DEVNET_RPC names that chain: `DEVNET_RPC=http://127.0.0.1:18545 pnpm devnet:test`.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { decodeEventLog, encodeFunctionData, keccak256, stringToHex, type Abi, type Hex } from "viem";

import { connect, send } from "../chain/service.ts";
import type { DeploymentRecord } from "../protocol/types.ts";
import { testKey } from "../test-keys/service.ts";
import { httpTransport, prepareBundler, probeBundler, suppliedAlto, type UserOpReceipt } from "../bundler/service.ts";
import { approvedBy, approveProposal, claimPersonalSafe, createCompany, createDepartment, ENTRY_POINT, ENTRY_POINT_V07, ERC20, grantHat, leftOf, pay, payByUserOp, proposeGrant, revokeHat, setBudget, viaBundler, viaEntryPoint, wears, type Protocol } from "./service.ts";

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

for (const ingress of ["direct EntryPoint", "Alto RPC / SIGINT", "Alto RPC / SIGTERM"] as const) test(`a hat worn by a personal Safe pays by UserOperation through ${ingress}, with a paymaster paying the gas`, { skip: rpc === undefined && "DEVNET_RPC is not set", timeout: 120_000 }, async (t) => {
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
  const prepared = await prepareBundler({ chain, fundingKey: deployer.key, paymasterArtifact: await artifact("MockPaymaster.sol", "MockPaymaster") });
  const paymaster = { address: prepared.paymaster };
  const setupNonce = await chain.client.getTransactionCount({ address: deployer.address });
  await prepareBundler({ chain, fundingKey: deployer.key, paymasterArtifact: await artifact("MockPaymaster.sol", "MockPaymaster"), paymaster: prepared.paymaster });
  assert.equal(await chain.client.getTransactionCount({ address: deployer.address }), setupNonce, "reusing fully funded setup sends no transactions");
  let bundlerUrl: string | undefined;
  if (ingress !== "direct EntryPoint") {
    const socket = createServer();
    await new Promise<void>(r => socket.listen(0, "127.0.0.1", r));
    const port = (socket.address() as { port: number }).port;
    await new Promise<void>(r => socket.close(() => r()));
    const config = suppliedAlto({ ...prepared, rpcUrl: chain.rpcUrl, port, executable: join(contracts, "../devnet/node_modules/.bin/alto") });
    const child = spawn(config.argv[0]!, config.argv.slice(1), { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...config.env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", b => { output += b; }); child.stderr.on("data", b => { output += b; });
    const exited = once(child, "exit");
    t.after(async () => {
      const stopSignal = ingress.endsWith("SIGTERM") ? "SIGTERM" : "SIGINT";
      child.kill(stopSignal);
      const [code, signal] = await exited;
      assert.deepEqual([code, signal], [0, null], `foreground Alto shuts down cleanly on ${stopSignal}`);
      assert.equal(await fetch(config.url).then(() => true, () => false), false, "no listener remains after Alto exits");
    });
    const deadline = Date.now() + 60_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`Alto exited before readiness: ${output.replace(/0x[0-9a-fA-F]{64}/g, "[redacted]")}`);
      try { await probeBundler(config.url); break; } catch {
        if (Date.now() > deadline) throw new Error("Alto readiness timed out");
        await new Promise(r => setTimeout(r, 200));
      }
    }
    bundlerUrl = config.url;
  }

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
  const submit = bundlerUrl ? viaBundler(bundlerUrl) : viaEntryPoint(chain, deployer.key);
  const paid = await payByUserOp(p, { safe, ownerKey: holder.key, paymaster: paymaster.address, submit, budget: department, to: payee, amount: 125_500_000n, kind: 1, documentHash: hash(`${name} PINV-0001`), jobNonce: hash(`${name} job 1`) });
  assert.equal(paid.ok, true, JSON.stringify(paid, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  assert.match(paid.ok ? (paid.userOpHash ?? "") : "", /^0x[0-9a-f]{64}$/, "the payment names its UserOperation");
  const after = await chain.client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [payee] });
  assert.equal(after - before, 125_500_000n, "the payee gained exactly 125.50");
  assert.equal(await chain.client.getBalance({ address: safe }), gasBefore, "the paymaster paid the gas, not the Safe");
  if (bundlerUrl) {
    assert.ok(paid.ok);
    const carrying = await chain.client.getTransaction({ hash: paid.txHash });
    assert.equal(carrying.from.toLowerCase(), chain.walletFor(prepared.executorKey).account.address.toLowerCase(), "the dedicated Alto executor carried the operation, not a direct relayer fallback");
    assert.equal(carrying.to?.toLowerCase(), ENTRY_POINT_V07.toLowerCase());
    t.diagnostic(`Alto receipt: ${paid.ok && paid.txHash}; UserOperation: ${paid.ok && paid.userOpHash}; supplier received 125500000 units`);
    const real = httpTransport(bundlerUrl);
    let sends = 0;
    const uncertain = viaBundler(bundlerUrl, { async request(method, params) {
      const answer = await real.request(method, params);
      if (method === "eth_sendUserOperation") { sends++; throw new Error("simulated lost reply after actual acceptance"); }
      return answer;
    } });
    const recovered = await payByUserOp(p, { safe, ownerKey: holder.key, paymaster: paymaster.address, submit: uncertain, budget: department, to: payee, amount: 3_250_000n, kind: 1, documentHash: hash(`${name} PINV-0002`), jobNonce: hash(`${name} job 2`) });
    assert.equal(recovered.ok, true);
    assert.equal(sends, 1, "uncertain send is never broadcast twice");
    assert.equal((await chain.client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [payee] })) - after, 3_250_000n, "lost reply recovery paid the second invoice exactly once");
    t.diagnostic(`Lost-reply recovery receipt: ${recovered.ok && recovered.txHash}; single broadcast; supplier received 3250000 units`);
    if (ingress.endsWith("SIGTERM")) {
      let mined: UserOpReceipt | undefined;
      const observed = viaBundler(bundlerUrl, { async request(method, params) {
        const answer = await real.request(method, params);
        if (method === "eth_getUserOperationReceipt" && answer) mined = answer as UserOpReceipt;
        return answer;
      } });
      const balanceBefore = await chain.client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [payee] });
      // This hook runs only after payByUserOp's real spend simulation and signature have succeeded.
      const raced = await payByUserOp(p, { safe, ownerKey: holder.key, paymaster: paymaster.address, submit: async op => {
        await setBudget(p, company, department, 128_750_000n); // exactly the already spent amount: no room left
        return observed(op);
      }, budget: department, to: payee, amount: 1_750_000n, kind: 1, documentHash: hash(`${name} PINV-raced`), jobNonce: hash(`${name} raced`) }).catch((error: Error) => error);
      assert.ok(mined, "Alto included the operation despite its execution-phase failure");
      t.diagnostic(`Mined failure receipt: ${mined.receipt.transactionHash}; UserOperation: ${mined.userOpHash}; success=${mined.success}; caller=${raced instanceof Error ? "threw" : "returned refusal"}`);
      assert.equal(mined.success, false);
      const native = await chain.client.getTransactionReceipt({ hash: mined.receipt.transactionHash });
      assert.equal(native.status, "success", "the EntryPoint transaction succeeded while this UserOperation failed");
      const events = native.logs.filter(l => l.address.toLowerCase() === ENTRY_POINT_V07.toLowerCase()).flatMap(l => {
        try { return [decodeEventLog({ abi: ENTRY_POINT, data: l.data, topics: l.topics })]; } catch { return []; }
      });
      assert.ok(events.some(e => e.eventName === "UserOperationEvent" && e.args.userOpHash === mined!.userOpHash && e.args.success === false));
      assert.equal(await chain.client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [payee] }), balanceBefore, "the failed payment moved no supplier funds");
      assert.ok(!(raced instanceof Error), "an included failure returns the existing payment refusal instead of throwing");
      assert.deepEqual([raced.ok, !raced.ok && raced.reason], [false, "REVERTED"]);
      assert.ok(!raced.ok && raced.detail.includes(mined.userOpHash) && raced.detail.includes(mined.receipt.transactionHash), "the refusal retains both on-chain identities");
      await setBudget(p, company, department, 2_000n * UNIT);
    }
  }

  const wrongSigner = await payByUserOp(p, { safe, ownerKey: testKey("stranger").key, paymaster: paymaster.address, submit, budget: department, to: payee, amount: UNIT, kind: 1, documentHash: hash("w"), jobNonce: hash(`${name} w`) }).catch((e: Error) => e);
  assert.ok(wrongSigner instanceof Error, "an op signed by someone who does not own the Safe is refused by the EntryPoint");
  if (bundlerUrl) assert.equal((wrongSigner as Error & { code: string }).code, "TRANSACTION_FAILED", "real Alto validation rejection maps to the public provider code");
  const over = await payByUserOp(p, { safe, ownerKey: holder.key, paymaster: paymaster.address, submit, budget: department, to: payee, amount: 5_000n * UNIT, kind: 1, documentHash: hash("y"), jobNonce: hash(`${name} y`) });
  assert.deepEqual([over.ok, !over.ok && over.reason], [false, "OVER_BUDGET"]);
});
