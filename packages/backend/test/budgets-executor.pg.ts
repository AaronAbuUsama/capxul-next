import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import pg from "pg";
import { decodeFunctionData, defineChain, encodeFunctionData, keccak256, parseAbi, parseTransaction, stringToHex, type Abi, type Hex } from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
// Test-only fixture helpers from the devnet package (relative import, as the eval runners do); no runtime dependency.
import { connect, send } from "../../devnet/src/modules/chain/service.ts";
import { createCompany, createDepartment, ERC20, grantHat, setBudget, type Protocol } from "../../devnet/src/modules/company/service.ts";
import { testKey } from "../../devnet/src/modules/test-keys/service.ts";
import { budgetsExecutor, claimServiceSigner, migrateServiceSigner, ServiceSignerError } from "../src/shared/door.ts";

const url = process.env.SIGNER_TEST_ADMIN_URL;
const rpc = process.env.SIGNER_TEST_RPC;
if (!url || new URL(url).pathname !== "/signer_test" || !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
    !rpc || !["localhost", "127.0.0.1"].includes(new URL(rpc).hostname)) throw new Error("Dedicated loopback signer_test PG and seeded v4 SIGNER_TEST_RPC required");
const UNIT = 1_000_000n;
const BUDGETS = parseAbi([
  "function schedule(uint256 id,address to,uint128 amount,uint16 kind,uint64 payAt,bytes32 documentHash,bytes32 jobNonce) returns (uint256)",
  "function scheduledCount() view returns (uint256)", "function cancel(uint256 scheduledId)", "function execute(uint256 scheduledId) returns (bytes32)",
  "function scheduledOf(uint256 id) view returns ((uint256 budgetId,address to,uint128 amount,uint64 payAt,uint16 kind,uint8 state,bytes32 documentHash,bytes32 jobNonce))",
]);
// A dedicated public Anvil account (index 11): not a Director, the relayer, the claim role or the bundler canary keys.
const executor = (() => {
  const bytes = mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: 11 }).getHdKey().privateKey!;
  return privateKeyToAccount(`0x${Buffer.from(bytes).toString("hex")}`);
})();

test("Budgets.execute of a real dated payment: refusal before the day, durable bytes, lost answer, one broadcast, lookup", { timeout: 120_000 }, async () => {
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  await admin.query(`create role capxul_core login nosuperuser nobypassrls; create role capxul_worker login nosuperuser nobypassrls;
    create schema app; grant usage on schema app to capxul_core,capxul_worker`);
  await migrateServiceSigner(admin);
  const worker = new pg.Pool({ connectionString: Object.assign(new URL(url), { username: "capxul_worker" }).href });
  const contracts = new URL("../../contracts/", import.meta.url);
  const record = JSON.parse(await readFile(new URL("deployments/devnet.json", contracts), "utf8"));
  const artifact = async (file: string, name: string) => JSON.parse(await readFile(new URL(`out/${file}/${name}.json`, contracts), "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  const chain = await connect(rpc!);
  const p: Protocol = { chain, record, installerAbi: (await artifact("Installer.sol", "Installer")).abi };
  const deployer = testKey("deployer"), holder = testKey("second"), payee = testKey("payee").address;
  const token = (await chain.client.waitForTransactionReceipt({ hash: await chain.walletFor(deployer.key).deployContract({
    abi: (await artifact("MockERC20.sol", "MockERC20")).abi, bytecode: (await artifact("MockERC20.sol", "MockERC20")).bytecode.object, args: ["Test USD", "TUSD", 6] }) })).contractAddress as Hex;
  const name = `executor-${Date.now()}`;
  const company = await createCompany(p, { tierService: testKey("tierService").key, relayer: deployer.key, founder: testKey("founder").key }, {
    founderEmail: `${name}@acme.test`, company: name, token, officers: [{ details: "Finance", maxSupply: 3 }],
    ceiling: 50_000n * UNIT, topAmount: 50_000n * UNIT, salt: keccak256(stringToHex(name)) });
  await send(chain, { from: deployer.key, to: token, data: encodeFunctionData({ abi: ERC20, functionName: "mint", args: [company.companySafe, 10_000n * UNIT] }) });
  const finance = company.officerHats[0] as bigint;
  const department = await createDepartment(p, company, finance);
  await grantHat(p, company, finance, holder.address);
  await setBudget(p, company, department, 2_000n * UNIT);
  await send(chain, { from: deployer.key, to: executor.address, data: "0x", value: 10n ** 18n });
  const budgets = record.contracts.Budgets.address as Hex;
  const payAt = (await chain.client.getBlock()).timestamp + 3_600n;
  await send(chain, { from: holder.key, to: budgets, data: encodeFunctionData({ abi: BUDGETS, functionName: "schedule",
    args: [department, payee, 42n * UNIT, 1, payAt, keccak256(stringToHex(`${name} doc`)), keccak256(stringToHex(`${name} job`))] }) });
  const scheduledId = await chain.client.readContract({ address: budgets, abi: BUDGETS, functionName: "scheduledCount" });

  let broadcasts = 0, dropReply = true, dropBeforeNode = false;
  const errors: unknown[] = [];
  const server = createServer(async (req, res) => {
    try {
      let text = ""; for await (const part of req) text += part;
      const body = JSON.parse(text);
      if (body.method === "eth_sendRawTransaction") {
        broadcasts++;
        const raw = body.params[0] as Hex;
        const stored = (await admin.query("select * from app.service_signer_sends where hash=$1", [keccak256(raw)])).rows[0];
        assert(stored && stored.raw_transaction === raw && stored.attempted === true, "signed bytes are durable on another connection before ingress");
        assert.deepEqual([stored.job, stored.safe, stored.signer], ["budgets-execute", null, null]);
        const tx = parseTransaction(raw);
        assert.equal(tx.to?.toLowerCase(), budgets.toLowerCase()); assert.equal(tx.value ?? 0n, 0n);
        assert.deepEqual(decodeFunctionData({ abi: BUDGETS, data: tx.data! }).args, [BigInt(stored.scheduled_id)], "only Budgets.execute of the recorded id");
      }
      if (body.method === "eth_sendRawTransaction" && dropBeforeNode) { res.destroy(); return; }
      const response = await fetch(rpc!, { method: "POST", headers: { "content-type": "application/json" }, body: text });
      const reply = await response.text();
      if (body.method === "eth_sendRawTransaction" && dropReply) { res.destroy(); return; }
      res.writeHead(response.status, { "content-type": "application/json" }); res.end(reply);
    } catch (error) { errors.push(error); res.writeHead(500); res.end(); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert(address && typeof address !== "string");
  const config = { worker, rpcUrl: `http://127.0.0.1:${address.port}`, chain: defineChain({ id: 84532, name: "executor-proof",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc!] } } }), account: executor, budgets };
  const provider = budgetsExecutor(config);
  const key = `budget-execute:84532:${scheduledId}:1`;
  const refused = (code: string, revert?: string) => (e: unknown) => e instanceof ServiceSignerError && e.code === code && (revert === undefined || e.revert === revert);
  try {
    // Before its day the chain refuses: nothing is signed or recorded, so the same key may simulate again later.
    await assert.rejects(provider.send({ key, scheduledId }), refused("TRANSACTION_FAILED", "NotDue"));
    assert.equal((await admin.query("select * from app.service_signer_sends")).rowCount, 0);
    assert.deepEqual(await provider.lookup({ key }), { hash: null, receipt: null });
    await assert.rejects(provider.send({ key: "budget-execute:x", scheduledId: 0n }), refused("INVALID_INPUT"));
    await chain.client.request({ method: "evm_increaseTime" as never, params: [3_601] as never });
    await chain.client.request({ method: "evm_mine" as never, params: [] as never });

    // Lost answer: PROVIDER_ERROR keeps the hash; one broadcast only.
    const lost = await provider.send({ key, scheduledId }).then(() => assert.fail("answer was dropped"), (e: unknown) => e);
    assert(refused("PROVIDER_ERROR")(lost) && (lost as ServiceSignerError).hash, "lost answer keeps the hash");
    const hash = (lost as ServiceSignerError).hash!;
    assert.equal(broadcasts, 1); assert.deepEqual(errors, []);
    // Another key on this executor after that send was mined but never looked up: the send reads and keeps its receipt,
    // so the lane is free, and only then simulates (this id is already paid).
    await assert.rejects(provider.send({ key: `${key}-other`, scheduledId }), refused("TRANSACTION_FAILED", "NotPending"));
    assert.equal((await admin.query("select receipt->>'status' as status from app.service_signer_sends where request_key=$1", [key])).rows[0].status, "success",
      "the busy lane kept the unread receipt");
    assert.equal(broadcasts, 1);
    // The same key with another scheduled id is not the same request.
    await assert.rejects(provider.send({ key, scheduledId: scheduledId + 1n }), refused("INVALID_INPUT"));
    dropReply = false;
    assert.deepEqual(await provider.send({ key, scheduledId }), { hash }, "retry returns the recorded hash");
    assert.equal(broadcasts, 1, "never broadcast twice");

    for (let i = 0; i < 50 && !(await provider.lookup({ key })).receipt; i++) await new Promise((r) => setTimeout(r, 100));
    const { hash: looked, receipt } = await provider.lookup({ key });
    assert.equal(looked, hash); assert(receipt);
    assert.equal(receipt.status, "success"); assert.equal(receipt.scheduledId, scheduledId.toString());
    assert.match(receipt.paymentId ?? "", /^0x[0-9a-f]{64}$/); assert.equal(receipt.revert, null);
    assert.deepEqual(await provider.waitForReceipt({ key, hash }), receipt, "the persisted receipt");
    const paid = await chain.client.readContract({ address: budgets, abi: BUDGETS, functionName: "scheduledOf", args: [scheduledId] });
    assert.equal(paid.state, 3, "Budgets records the dated payment as Paid (None, Pending, Cancelled, Paid)");
    assert.equal(await chain.client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [payee] }), 42n * UNIT);

    // A new attempt key for an already paid id is the chain's refusal, decoded, and records nothing.
    await assert.rejects(provider.send({ key: `budget-execute:84532:${scheduledId}:2`, scheduledId }), refused("TRANSACTION_FAILED", "NotPending"));
    assert.equal((await admin.query("select count(*)::int as n from app.service_signer_sends")).rows[0].n, 1);

    // The same account configured as another job's signer is refused: one key, one job, one lane.
    const claim = claimServiceSigner({ ...config, companiesHouse: record.companiesHouse, roles: record.companiesHouseRoles,
      claimer: record.contracts.CompaniesHouseClaimer.address, role: `0x${"11".repeat(32)}`, namespace: record.tiers[0].namespace });
    await assert.rejects(claim.send({ key: "setup:person-9:1", email: "x@example.test", signer: holder.address }), refused("INVALID_INPUT"));

    // A broadcast that never reached a node, then the Board cancels: the identical bytes are rebroadcast, mine as a
    // revert, and waitForReceipt records it before refusing with the decoded reason, which frees the lane.
    const second = (await chain.client.getBlock()).timestamp + 60n;
    await send(chain, { from: holder.key, to: budgets, data: encodeFunctionData({ abi: BUDGETS, functionName: "schedule",
      args: [department, payee, UNIT, 1, second, keccak256(stringToHex(`${name} doc 2`)), keccak256(stringToHex(`${name} job 2`))] }) });
    const secondId = await chain.client.readContract({ address: budgets, abi: BUDGETS, functionName: "scheduledCount" });
    await chain.client.request({ method: "evm_increaseTime" as never, params: [61] as never });
    await chain.client.request({ method: "evm_mine" as never, params: [] as never });
    dropBeforeNode = true;
    const keyTwo = `budget-execute:84532:${secondId}:1`;
    const dropped = await provider.send({ key: keyTwo, scheduledId: secondId }).then(() => assert.fail("broadcast was dropped"), (e: unknown) => e as ServiceSignerError);
    assert(refused("PROVIDER_ERROR")(dropped) && dropped.hash);
    // While that send is truly pending (no node has it; its rebroadcast is dropped too), another key is refused.
    await assert.rejects(provider.send({ key: `${keyTwo}-other`, scheduledId: secondId }), refused("WRONG_STATE"));
    dropBeforeNode = false;
    await send(chain, { from: holder.key, to: budgets, data: encodeFunctionData({ abi: BUDGETS, functionName: "cancel", args: [secondId] }) });
    const before = broadcasts;
    await assert.rejects(provider.waitForReceipt({ key: keyTwo, hash: dropped.hash! }), (e: unknown) => refused("TRANSACTION_FAILED", "NotPending")(e) && (e as ServiceSignerError).hash === dropped.hash);
    assert.equal(broadcasts, before + 1, "exactly one rebroadcast of the identical bytes");
    const mined = await provider.lookup({ key: keyTwo });
    assert.equal(mined.hash, dropped.hash); assert.equal(mined.receipt?.status, "reverted"); assert.equal(mined.receipt?.revert, "NotPending");
    assert.equal(mined.receipt?.paymentId, null);
    assert.equal((await admin.query("select count(*)::int as n from app.service_signer_sends where receipt is null")).rows[0].n, 0, "the lane is free");
    assert.deepEqual(errors, [], "every broadcast's bytes were durable and exactly Budgets.execute of its recorded id");
  } finally {
    server.close(); await worker.end(); await admin.end();
  }
});
