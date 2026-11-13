// Opt-in native proof of the test-only local signed sponsor (decision devnet.local-signed-sponsor). Not a unit test and not
// in the test glob: run only inside a Runtime-granted slot, from the repository root, under an outer timeout:
//   LOCAL_SPONSOR_NATIVE_GRANTED=1 timeout 180s node --experimental-strip-types --no-warnings packages/devnet/src/modules/bundler/local-sponsor.native.ts
// It starts one disposable Anvil (loading core.json read-only), one real foreground Alto and the in-process HTTP sponsor,
// then composes the verified-sponsorship adapter with them. Every send goes through Alto; nothing calls handleOps directly.
// It proves a component, not product or staging policy conformance or same-run acceptance.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { encodeFunctionData, parseEventLogs, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
// The adapter and SafeOp codec (PR84). Approvals exports them through its door after integration; this proof reads source.
import { approvalSponsor, sponsorHttpTransport, type SponsorshipRequest, type VerifiedSponsorship } from "../../../../backend/src/approvals/sponsorship.ts";
import { ENTRY_POINT_07_ADDRESS, MULTI_SEND_CALL_ONLY, SAFE_4337_MODULE, entryPointHash, safeOpDigest, toRpcUserOperation } from "../../../../sdk/src/approvals/safe-op.ts";
import { connect, send } from "../chain/service.ts";
import { claimPersonalSafe, ENTRY_POINT } from "../company/service.ts";
import { testKey } from "../test-keys/service.ts";
import { bundlerProvider, canaryBundlerKeys, httpTransport, probeBundler, suppliedAlto, type RpcUserOperation } from "./service.ts";
import { deploySingletonPaymaster07, SINGLETON_PAYMASTER_07, startLocalSponsor } from "./local-sponsor.ts";

assert.equal(process.env.LOCAL_SPONSOR_NATIVE_GRANTED, "1", "requires Runtime's explicit disposable native slot grant");
const root = process.cwd(), statePath = join(root, "packages/contracts/state/core.json");
const sha = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
const seedBefore = await sha(statePath);
const freePort = async () => {
  const s = createServer(); await new Promise<void>(r => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as { port: number }; await new Promise<void>(r => s.close(() => r())); return port;
};
const peakRss = async (pid: number | undefined) => {
  try { return (await readFile(`/proc/${pid}/status`, "utf8")).match(/VmHWM:\s+(\d+) kB/)?.[1] + " kB"; } catch { return "unavailable"; }
};
const redact = (s: string) => s.replace(/0x[0-9a-fA-F]{64}/g, "[redacted]");
const log = (line: string) => console.log(line);
const children: { name: string; child: ChildProcess; url: string; output: string }[] = [];
const started = new Date().toISOString();
async function stop(entry: (typeof children)[number]) {
  if (entry.child.exitCode === null && entry.child.signalCode === null) { const exited = once(entry.child, "exit"); entry.child.kill("SIGTERM"); await exited; }
}
process.once("SIGTERM", () => { for (const c of children) c.child.kill("SIGTERM"); });

const anvilPort = await freePort(), anvilUrl = `http://127.0.0.1:${anvilPort}`;
const anvil = spawn("anvil", ["--host", "127.0.0.1", "--port", String(anvilPort), "--chain-id", "84532", "--silent", "--load-state", statePath], { stdio: ["ignore", "ignore", "pipe"] });
children.push({ name: "anvil", child: anvil, url: anvilUrl, output: "" });
anvil.stderr!.on("data", b => { children[0]!.output += String(b); });
let sponsorClose: (() => Promise<void>) | undefined;
const summary: Record<string, unknown> = { started, anvilPid: anvil.pid, anvilPort };
try {
  let chain;
  for (let i = 0; ; i++) {
    try { chain = await connect(anvilUrl); break; } catch { if (i > 50) throw new Error(`anvil not ready: ${children[0]!.output}`); await new Promise(r => setTimeout(r, 100)); }
  }
  assert.equal(chain.chainId, 84532);
  // core.json's last block is weeks old. Real Alto 0.0.21 admits validity windows by its host Date.now() while EntryPoint
  // uses block time, so a bounded window can satisfy both only on a chain synced to wall time.
  summary.seedChainBehindWallSeconds = Math.floor(Date.now() / 1000) - Number((await chain.client.getBlock()).timestamp);
  await chain.client.request({ method: "anvil_setTime" as never, params: [Math.floor(Date.now() / 1000)] as never });
  await chain.client.request({ method: "evm_mine" as never });
  const record = JSON.parse(await readFile(join(root, "packages/contracts/deployments/devnet.json"), "utf8"));
  const p = { chain, record, installerAbi: [] };
  const deployer = testKey("deployer"), holder = testKey("second"), outsider = testKey("founder");
  const nonce = Date.now();
  const safe = await claimPersonalSafe(p, testKey("tierService").key, `local-sponsor-${nonce}@capxul.test`, holder.address);
  const otherSafe = await claimPersonalSafe(p, testKey("tierService").key, `local-sponsor-outsider-${nonce}@capxul.test`, outsider.address);
  await send(chain, { from: deployer.key, to: safe, data: "0x", value: 1_000n });
  const keys = canaryBundlerKeys();
  for (const key of [keys.executorKey, keys.utilityKey]) await send(chain, { from: deployer.key, to: chain.walletFor(key).account.address, data: "0x", value: 10n ** 19n });
  const signerKey = generatePrivateKey(); // fresh and disposable: never written anywhere
  const paymaster = await deploySingletonPaymaster07(chain, deployer.key, privateKeyToAccount(signerKey).address);
  await send(chain, { from: deployer.key, to: ENTRY_POINT_07_ADDRESS, value: 10n ** 18n, data: encodeFunctionData({ abi: ENTRY_POINT, functionName: "depositTo", args: [paymaster] }) });
  log(`PASS claimed Safes, funded canary executor/utility and deployed upstream SingletonPaymaster07 ${SINGLETON_PAYMASTER_07.version} with a fresh disposable signer, deposit 1 ETH`);

  const altoPort = await freePort();
  const alto = suppliedAlto({ ...keys, rpcUrl: anvilUrl, port: altoPort, paymaster, executable: join(root, "packages/devnet/node_modules/.bin/alto") });
  const altoChild = spawn(alto.argv[0]!, alto.argv.slice(1), { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...alto.env }, stdio: ["ignore", "pipe", "pipe"] });
  const altoEntry = { name: "alto", child: altoChild, url: alto.url, output: "" };
  children.push(altoEntry);
  altoChild.stdout!.on("data", b => { altoEntry.output += String(b); }); altoChild.stderr!.on("data", b => { altoEntry.output += String(b); });
  for (const deadline = Date.now() + 60_000; ;) {
    if (altoChild.exitCode !== null) throw new Error(`Alto exited before readiness: ${redact(altoEntry.output)}`);
    try { await probeBundler(alto.url); break; } catch { if (Date.now() > deadline) throw new Error("Alto readiness timed out"); await new Promise(r => setTimeout(r, 200)); }
  }
  Object.assign(summary, { altoPid: altoChild.pid, altoPort });
  log("PASS real foreground Alto 0.0.21 serves EntryPoint v0.7 on loopback");

  // This disposable world's canonical clock is wall time. Alto 0.0.21 admits validAfter by its host Date.now(), not chain
  // time, and Anvil blocks never run behind it, so a clock ahead of wall time would be refused until wall time caught up.
  const now = () => new Date();
  // Wait for wall time, then mine so Alto's simulation block is inside the window too.
  const until = async (instant: Date) => {
    while (Date.now() <= instant.getTime()) await new Promise(r => setTimeout(r, 100));
    await chain.client.request({ method: "evm_mine" as never });
  };
  summary.chainAheadOfWallSeconds = Number((await chain.client.getBlock()).timestamp) - Math.floor(Date.now() / 1000);
  assert.ok(Math.abs(summary.chainAheadOfWallSeconds as number) <= 15, "disposable chain follows wall time");
  const sponsorServer = await startLocalSponsor({ admission: "test-only", chain, entryPoint: ENTRY_POINT_07_ADDRESS, paymaster, signerKey, senders: [safe],
    now, maxWindowSeconds: 900, bundler: httpTransport(alto.url), maxPaymasterGas: 1_000_000n, maxCostWei: 10n ** 17n });
  sponsorClose = sponsorServer.close;
  summary.sponsorUrl = sponsorServer.url;
  const sponsor = approvalSponsor({ client: chain.client, gateway: sponsorHttpTransport(sponsorServer.url), module: SAFE_4337_MODULE, entryPoint: ENTRY_POINT_07_ADDRESS,
    multiSend: MULTI_SEND_CALL_ONLY, paymaster, claimOwner: record.companiesHouse, now });
  const recipientA = deployer.address, recipientB = outsider.address;
  const calls = [{ to: recipientA, value: "19", data: "0x" }, { to: recipientB, value: "23", data: "0x" }];
  const request = (key: bigint, sendAfter: Date | null, deadlineSeconds = 600, sender: Address = safe): SponsorshipRequest => ({
    chain_id: 84532, sender, calls, nonce_key: key.toString(), nonce: null, send_after: sendAfter, deadline: new Date(now().getTime() + deadlineSeconds * 1000) });
  const provider = bundlerProvider(httpTransport(alto.url));
  const signed = async (v: VerifiedSponsorship, paymasterData = v.user_operation.paymasterData): Promise<{ operation: RpcUserOperation; expectedHash: Hex }> => {
    const after = BigInt(v.valid_after.getTime() / 1000), until = BigInt(v.valid_until.getTime() / 1000), op = { ...v.user_operation, paymasterData };
    const digest = paymasterData === v.user_operation.paymasterData ? v.digest as Hex : safeOpDigest(op, { chainId: 84532, module: SAFE_4337_MODULE, entryPoint: ENTRY_POINT_07_ADDRESS, validAfter: after, validUntil: until });
    const sig = await privateKeyToAccount(holder.key).sign({ hash: digest });
    return { operation: toRpcUserOperation(op, after, until, sig) as RpcUserOperation, expectedHash: v.user_op_hash as Hex };
  };
  const mined = async (hash: Hex) => {
    for (let i = 0; i < 300; i++) { const { receipt } = await provider.lookup(hash); if (receipt) return receipt; await new Promise(r => setTimeout(r, 100)); }
    throw new Error("Alto never included the operation");
  };
  const code = async (promise: Promise<unknown>) => { try { await promise; return "accepted"; } catch (e) { return (e as { code?: string }).code ?? "unknown"; } };

  // Refusal controls through real HTTP: the adapter maps the sponsor's -32501 to a stored refusal, not a retry.
  assert.deepEqual(await sponsor(request(11n, null, 600, otherSafe)), { code: "TRANSACTION_FAILED", reason: "The gateway refused sponsorship validation" });
  assert.deepEqual(await sponsor(request(12n, null, 3_600)), { code: "TRANSACTION_FAILED", reason: "The gateway refused sponsorship validation" });
  log("PASS real HTTP sponsor refuses an unadmitted claimed Safe and a window beyond its test admission");

  // 1. Immediate approval: sponsor, owner-sign, send once through Alto, mine.
  const balances = async () => Promise.all([recipientA, recipientB, safe].map(a => chain.client.getBalance({ address: a })));
  const before = await balances();
  const now1 = await sponsor(request((1n << 191n) + 517n, null));
  assert.ok("user_operation" in now1, JSON.stringify(now1));
  assert.equal(now1.signer_address.toLowerCase(), holder.address.toLowerCase());
  assert.equal(now1.valid_after.getTime() / 1000, Math.ceil(now1.valid_after.getTime() / 1000));
  await until(now1.valid_after); // Alto refuses validAfter beyond its wall clock
  const op1 = await signed(now1);
  assert.equal(await provider.send({ ...op1, entryPoint: ENTRY_POINT_07_ADDRESS }), now1.user_op_hash);
  const receipt1 = await mined(now1.user_op_hash as Hex);
  assert.equal(receipt1.success, true);
  const tx1 = await chain.client.getTransactionReceipt({ hash: receipt1.receipt.transactionHash });
  const event = parseEventLogs({ abi: ENTRY_POINT, logs: tx1.logs, eventName: "UserOperationEvent" })[0]!;
  assert.equal(event.args.paymaster.toLowerCase(), paymaster.toLowerCase());
  assert.equal(event.args.success, true);
  assert.equal(tx1.from.toLowerCase(), chain.walletFor(keys.executorKey).account.address.toLowerCase(), "Alto's executor carried it, not a direct handleOps");
  const after1 = await balances();
  assert.deepEqual([after1[0]! - before[0]!, after1[1]! - before[1]!, before[2]! - after1[2]!], [19n, 23n, 42n], "exact ordered transfers; the Safe paid no gas");
  log(`PASS signed window ${now1.valid_after.toISOString()}..${now1.valid_until.toISOString()} sponsored over real HTTP, sent once via Alto and mined: userOp ${now1.user_op_hash} tx ${receipt1.receipt.transactionHash}`);

  // 2. Dated approval: Alto refuses it before its start, then accepts the same signed operation once world time reaches it.
  const dated = await sponsor(request((1n << 191n) + 518n, new Date(now().getTime() + 10_000)));
  assert.ok("user_operation" in dated, JSON.stringify(dated));
  const op2 = await signed(dated);
  const early = await code(provider.send({ ...op2, entryPoint: ENTRY_POINT_07_ADDRESS }));
  assert.equal(early, "TRANSACTION_FAILED", "real Alto refuses a not-yet-valid signed sponsorship");
  await until(dated.valid_after);
  assert.equal(await provider.send({ ...op2, entryPoint: ENTRY_POINT_07_ADDRESS }), dated.user_op_hash);
  assert.equal((await mined(dated.user_op_hash as Hex)).success, true);
  log(`PASS dated window ${dated.valid_after.toISOString()}..${dated.valid_until.toISOString()}: Alto refused before validAfter (${early}), then mined after world time advanced`);

  // 3. Tampered paymaster signature, with a valid owner signature over the tampered operation: the deployed paymaster refuses.
  const third = await sponsor(request((1n << 191n) + 519n, null));
  assert.ok("user_operation" in third, JSON.stringify(third));
  const data = third.user_operation.paymasterData, flip = data.slice(-4, -2) === "00" ? "01" : "00";
  const badData = `${data.slice(0, -4)}${flip}${data.slice(-2)}`;
  const tampered = await signed(third, badData);
  await until(third.valid_after);
  const tamperedCode = await code(provider.send({ ...tampered, entryPoint: ENTRY_POINT_07_ADDRESS, expectedHash: entryPointHash({ ...third.user_operation, paymasterData: badData }, 84532) }));
  assert.equal(tamperedCode, "TRANSACTION_FAILED");
  log("PASS a tampered sponsor signature is refused by real Alto against the deployed paymaster");
  log("BOUNDARY test-only admission on a disposable chain; not product or staging sponsorship policy, not same-run acceptance");
} catch (error) {
  console.log(`FAIL; Alto log tail (hashes redacted): ${redact(children[1]?.output.slice(-3000) ?? "")}`);
  throw error;
} finally {
  if (sponsorClose) await sponsorClose();
  summary.peakRss = { gatewayAndProof: `${process.resourceUsage().maxRSS} kB` } as Record<string, string>;
  for (const c of [...children].reverse()) { (summary.peakRss as Record<string, string>)[c.name] = await peakRss(c.child.pid); await stop(c); }
  summary.exits = Object.fromEntries(children.map(c => [c.name, { code: c.child.exitCode, signal: c.child.signalCode }]));
  const listeners = await Promise.all([...children.map(c => c.url), ...(summary.sponsorUrl ? [summary.sponsorUrl as string] : [])].map(u => fetch(u, { method: "POST" }).then(() => u, () => null)));
  summary.listenersLeft = listeners.filter(Boolean);
  summary.seedUnchanged = (await sha(statePath)) === seedBefore;
  summary.finished = new Date().toISOString();
  log(JSON.stringify(summary));
  assert.deepEqual(summary.listenersLeft, []);
  assert.equal(summary.seedUnchanged, true);
  log("PASS disposable Anvil, Alto and sponsor exited with no listener left; seed core.json unchanged");
}
