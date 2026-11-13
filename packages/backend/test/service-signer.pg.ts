import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import pg from "pg";
import { createPublicClient, createWalletClient, decodeFunctionData, defineChain, http, keccak256, padHex, parseAbi, parseTransaction, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { claimServiceSigner, migrateServiceSigner, ServiceSignerError, type ClaimSignerConfig } from "../src/shared/door.ts";

const url = process.env.SIGNER_TEST_ADMIN_URL;
const rpc = process.env.SIGNER_TEST_RPC;
if (!url || new URL(url).pathname !== "/signer_test" || !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
    !rpc || !["localhost", "127.0.0.1"].includes(new URL(rpc).hostname)) throw new Error("Dedicated loopback signer_test PG and seeded v4 SIGNER_TEST_RPC required");
// Anvil's published account 3 is the actual member of the seeded Companies House claim role, not a stand-in sender.
const account = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const signer = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a").address;
const ROLES = parseAbi(["function execTransactionWithRole(address to,uint256 value,bytes data,uint8 operation,bytes32 roleKey,bool shouldRevert) returns (bool success)"]);
const CLAIM = parseAbi(["function claim(string namespace,string email,address signer) returns (address safe)"]);

test("real v4 role claim: durable bytes before ingress, lost-answer recovery, lane and exact-key isolation", { timeout: 40_000 }, async () => {
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  await admin.query(`create role capxul_core login nosuperuser nobypassrls; create role capxul_worker login nosuperuser nobypassrls;
    create schema app; grant usage on schema app to capxul_core,capxul_worker`);
  await migrateServiceSigner(admin);
  const roleUrl = (role: string) => { const u = new URL(url); u.username = role; return u.href; };
  const worker = new pg.Pool({ connectionString: roleUrl("capxul_worker") });
  const tenant = new pg.Pool({ connectionString: roleUrl("capxul_core") });
  const record = JSON.parse(readFileSync(new URL("../../contracts/deployments/devnet.json", import.meta.url), "utf8"));
  const chain = defineChain({ id: 84532, name: "isolated-signer-proof", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc!] } } });
  const chainClient = createPublicClient({ chain, transport: http(rpc) });
  let broadcasts = 0, dropReply = true, failBeforePrepare = false, crashChild: ChildProcess | undefined;
  const errors: unknown[] = [];
  const server = createServer(async (req, res) => {
    try {
      let text = ""; for await (const part of req) text += part;
      const body = JSON.parse(text);
      if (failBeforePrepare) { res.writeHead(503); res.end(); return; }
      if (body.method === "eth_sendRawTransaction") {
        broadcasts++;
        const raw = body.params[0] as Hex;
        const stored = (await admin.query("select * from app.service_signer_sends where hash=$1", [keccak256(raw)])).rows[0];
        assert(stored, "signed bytes must be visible on independent PG connection before node ingress");
        assert.equal(stored.raw_transaction, raw); assert.equal(stored.attempted, true);
        const transaction = parseTransaction(raw);
        assert.equal(transaction.chainId, 84532); assert.equal(transaction.to?.toLowerCase(), record.companiesHouseRoles.toLowerCase());
        assert.equal(transaction.value ?? 0n, 0n);
        const decoded = decodeFunctionData({ abi: ROLES, data: transaction.data! });
        assert.equal(decoded.args[0].toLowerCase(), record.contracts.CompaniesHouseClaimer.address.toLowerCase());
        assert.deepEqual([decoded.args[1], decoded.args[3], decoded.args[4], decoded.args[5]], [0n, 1, padHex(stringToHex("capxul.claim.devnet"), { dir: "right", size: 32 }), true]);
        const claim = decodeFunctionData({ abi: CLAIM, data: decoded.args[2] });
        assert.equal(claim.args[0], record.tiers[0].namespace); assert.equal(claim.args[2], signer);
      }
      const response = await fetch(rpc!, { method: "POST", headers: { "content-type": "application/json" }, body: text });
      const reply = await response.text();
      if (body.method === "eth_sendRawTransaction" && crashChild) { crashChild.kill("SIGKILL"); res.destroy(); return; }
      if (body.method === "eth_sendRawTransaction" && dropReply) { res.destroy(); return; }
      res.writeHead(response.status, { "content-type": "application/json" }); res.end(reply);
    } catch (error) { errors.push(error); res.writeHead(500); res.end(); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert(address && typeof address !== "string");
  const config: ClaimSignerConfig = { worker, rpcUrl: `http://127.0.0.1:${address.port}`, chain, account,
    companiesHouse: record.companiesHouse, roles: record.companiesHouseRoles, claimer: record.contracts.CompaniesHouseClaimer.address,
    role: padHex(stringToHex("capxul.claim.devnet"), { dir: "right", size: 32 }), namespace: record.tiers[0].namespace };
  const provider = claimServiceSigner(config);
  const input = { key: "setup:person-731:1", email: "signer-proof-731@example.test", signer };
  const code = (expected: string) => (e: unknown) => e instanceof ServiceSignerError && e.code === expected && !e.message.includes(input.email);
  try {
    await assert.rejects(tenant.query("select raw_transaction from app.service_signer_sends"), /permission denied/);
    await assert.rejects(provider.send({ ...input, email: "Capitalized@example.test" }), code("INVALID_INPUT"));
    assert.equal(broadcasts, 0);
    failBeforePrepare = true;
    await assert.rejects(provider.send(input), code("PROVIDER_ERROR"));
    assert.equal((await admin.query("select * from app.service_signer_sends")).rowCount, 0);
    failBeforePrepare = false;
    await assert.rejects(provider.send(input), (e: unknown) => code("PROVIDER_ERROR")(e) && !!(e as ServiceSignerError).hash);
    assert.deepEqual(errors, []); assert.equal(broadcasts, 1);
    const stored = (await admin.query("select * from app.service_signer_sends")).rows[0];
    assert(stored && stored.attempted);
    // A fresh provider recovers the same durable hash; changed args and another job cannot get a new send.
    const recovered = await claimServiceSigner(config).send(input);
    assert.equal(recovered.hash, stored.hash); assert.equal(broadcasts, 1);
    await assert.rejects(provider.send({ ...input, email: "different@example.test" }), code("INVALID_INPUT"));
    // That claim was mined but nobody has read it: another key's send keeps its receipt, so the lane is free, and only
    // then simulates (this one is refused by the chain, so nothing is signed).
    const otherRole = claimServiceSigner({ ...config, namespace: "ungranted:namespace" });
    await assert.rejects(otherRole.send({ ...input, key: "setup:person-732:1", email: "next@example.test" }), code("TRANSACTION_FAILED"));
    assert.equal((await admin.query("select receipt->>'status' as status from app.service_signer_sends where request_key=$1", [input.key])).rows[0].status, "success");
    assert.equal(broadcasts, 1);
    const receipt = await provider.waitForReceipt({ key: input.key, hash: recovered.hash });
    assert.equal(receipt.status, "success"); assert.equal(receipt.errorCode, null); assert(receipt.safe);
    const owners = await chainClient.readContract({ address: receipt.safe, abi: parseAbi(["function getOwners() view returns (address[])"]), functionName: "getOwners" });
    assert.deepEqual(owners, [signer], "the actual personal Safe has the requested sole signer after the role delegatecall");
    assert.deepEqual(await claimServiceSigner(config).waitForReceipt({ key: input.key, hash: recovered.hash }), receipt);
    assert.equal(broadcasts, 1);
    await assert.rejects(provider.waitForReceipt({ key: "setup:other-person:1", hash: recovered.hash }), code("INVALID_INPUT"));
    dropReply = false;
    // The same on-chain claim cannot swap Companies House a second time; it must not sign or broadcast.
    await assert.rejects(provider.send({ ...input, key: "setup:person-731:2" }), code("TRANSACTION_FAILED"));
    assert.equal(broadcasts, 1);
    const wrongRole = claimServiceSigner({ ...config, namespace: "ungranted:namespace" });
    await assert.rejects(wrongRole.send({ ...input, key: "setup:person-733:1", email: "role-refused@example.test" }), code("TRANSACTION_FAILED"));
    assert.equal(broadcasts, 1); assert.deepEqual(errors, []);

    // Kill a real sender after chain ingress but before it can observe the hash, then restart from durable PG state.
    const next = { ...input, key: "setup:person-734:1", email: "signer-crash-734@example.test" };
    const childCode = `import pg from 'pg'; import {privateKeyToAccount} from 'viem/accounts';
      import {claimServiceSigner} from ${JSON.stringify(new URL("../src/shared/door.ts", import.meta.url).href)};
      const {workerUrl,config,input}=JSON.parse(process.env.SIGNER_CHILD);
      const worker=new pg.Pool({connectionString:workerUrl});
      await claimServiceSigner({...config,worker,account:privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6')}).send(input);
      await worker.end();`;
    crashChild = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", childCode], {
      cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, SIGNER_CHILD: JSON.stringify({ workerUrl: roleUrl("capxul_worker"), config: { ...config, worker: undefined, account: undefined }, input: next }) },
    });
    let stderr = ""; crashChild.stderr?.on("data", (part) => { stderr += part; });
    const [, signal] = await once(crashChild, "exit");
    assert.equal(signal, "SIGKILL", stderr); crashChild = undefined;
    assert.equal(broadcasts, 2); assert.deepEqual(errors, []);
    const [a, b] = await Promise.allSettled([claimServiceSigner(config).send(next), claimServiceSigner(config).send(next)]);
    const recoveredCrash = [a, b].find((r) => r.status === "fulfilled"); assert(recoveredCrash?.status === "fulfilled");
    for (const result of [a, b]) if (result.status === "rejected") assert(code("WRONG_STATE")(result.reason));
    const crashedReceipt = await provider.waitForReceipt({ key: next.key, hash: recoveredCrash.value.hash });
    assert.equal(crashedReceipt.status, "success"); assert(crashedReceipt.safe); assert.equal(broadcasts, 2);

    // A mined success that carries no CapxulSafeClaimed is a failed claim: its receipt is kept (the lane is free), then
    // refused on every read, never returned as a success.
    const plain = await createWalletClient({ chain, account, transport: http(rpc) }).sendTransaction({ to: account.address, value: 0n });
    assert.equal((await chainClient.waitForTransactionReceipt({ hash: plain })).status, "success");
    await admin.query(`insert into app.service_signer_sends (account,chain_id,request_key,request_digest,raw_transaction,hash,safe,signer,attempted)
      values ($1,84532,'setup:person-735:1','digest','0x',$2,$3,$4,true)`, [account.address.toLowerCase(), plain, crashedReceipt.safe, signer]);
    for (let read = 0; read < 2; read++)
      await assert.rejects(provider.waitForReceipt({ key: "setup:person-735:1", hash: plain }), code("TRANSACTION_FAILED"), `read ${read}`);
    const kept = (await admin.query("select receipt from app.service_signer_sends where request_key='setup:person-735:1'")).rows[0].receipt;
    assert.deepEqual([kept.status, kept.safe, kept.errorCode], ["success", null, "TRANSACTION_FAILED"]);
  } finally {
    crashChild?.kill("SIGKILL");
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.all([worker.end(), tenant.end()]); await admin.end();
  }
});
