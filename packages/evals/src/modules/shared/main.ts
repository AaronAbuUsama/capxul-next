import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { concat, createPublicClient, decodeEventLog, http, pad, parseAbi, parseAbiItem, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { entryPoint07Address, getUserOperationHash } from "viem/account-abstraction";
import { parseRunReceipt } from "@capxul/blueprint-engine";
import { ChainRpcError, chainRpc, type ChainNode } from "../../../../backend/src/shared/door.ts";
import { bundlerProvider, httpTransport, ProviderError, type RpcUserOperation } from "../../../../devnet/src/modules/bundler/service.ts";
import { fixtureFrom, type Fixture } from "../acceptance/fixture.ts";
import { httpGate, type HttpGate, type HttpMode } from "./fault-gate.ts";

type World = { fixture: Fixture; rpc: string; bundler: string | null; paymaster: Address | null; chainId: number; evidence: string };
type Check = (w: World, note: (key: string, value: unknown) => void) => Promise<void>;
const loopback = (port: number) => `http://127.0.0.1:${port}`;
const ERC20 = parseAbi(["function decimals() view returns (uint8)", "function owner() view returns (address)"]);
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const USER_OPERATION = parseAbiItem("event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)");
const OUTAGES: HttpMode[] = [{ kind: "down" }, { kind: "timeout" }, { kind: "throttle" }];

async function gates<T>(targets: string[], run: (g: HttpGate[]) => Promise<T>): Promise<T> {
  const open = await Promise.all(targets.map((t) => httpGate(t)));
  try { return await run(open); } finally { await Promise.all(open.map((g) => g.close())); }
}
async function refused(code: string, run: () => Promise<unknown>): Promise<void> {
  try { await run(); } catch (error) {
    if ((error instanceof ChainRpcError || error instanceof ProviderError) && error.code === code) return;
    throw new Error(`expected ${code}, got ${error instanceof Error ? (error as { code?: string }).code ?? error.message : String(error)}`);
  }
  throw new Error(`expected ${code}, the call answered`);
}
const count = (list: string[], method: string) => list.filter((m) => m === method).length;

/** Every configured node down, hung or throttled: three attempts in node order, then PROVIDER_ERROR; a live second node answers. */
const unavailable = (method: string, call: (rpc: ReturnType<typeof chainRpc>, w: World) => Promise<unknown>, rpcMethod: string, wide = false): Check =>
  async (w, note) => gates([w.rpc, w.rpc, w.rpc], async ([a, b, c]) => {
    OUTAGES.forEach((mode, i) => [a, b, c][i]!.set({ "*": mode }));
    const nodes: ChainNode[] = [a!, b!, c!].map((g) => ({ url: g.url, wideLogs: wide }));
    const started = Date.now();
    await refused("PROVIDER_ERROR", () => call(chainRpc({ nodes }), w));
    assert.deepEqual([a, b, c].map((g) => count(g!.received, rpcMethod)), [1, 1, 1], "one attempt per node, three in all");
    assert.deepEqual([a, b, c].map((g) => g!.forwarded.length), [0, 0, 0]);
    a!.set({ "*": { kind: "down" } }); b!.set({ "*": { kind: "pass" } });
    await call(chainRpc({ nodes: [a!, b!].map((g) => ({ url: g.url, wideLogs: wide })) }), w);
    assert.equal(count(b!.forwarded, rpcMethod), 1, "the live node answered through to the world's chain");
    note(method, { outages: OUTAGES.map((m) => m.kind), refusedAfterMs: Date.now() - started, fallbackAnswered: true });
  });

/** The world's chain answered, rewritten so it no longer decodes: PROVIDER_RESPONSE_INVALID, with no second attempt. */
const unusable = (method: string, rpcMethod: string, rewrite: (upstream: any) => unknown, call: (rpc: ReturnType<typeof chainRpc>, w: World) => Promise<unknown>, wide = false): Check =>
  async (w, note) => gates([w.rpc], async ([g]) => {
    await call(chainRpc({ nodes: [{ url: g!.url, wideLogs: wide }] }), w);
    g!.set({ [rpcMethod]: { kind: "rewrite", body: (_req, upstream) => rewrite(upstream) } });
    await refused("PROVIDER_RESPONSE_INVALID", () => call(chainRpc({ nodes: [{ url: g!.url, wideLogs: wide }, { url: w.rpc, wideLogs: wide }] }), w));
    assert.equal(count(g!.forwarded, rpcMethod), 2, "one real control read, then one rewritten answer; an unusable answer is final");
    note(method, { control: "real answer decoded", rewritten: rpcMethod });
  });

async function paymentWindow(w: World) {
  const client = createPublicClient({ transport: http(w.rpc, { retryCount: 0 }) });
  const receipt = await client.getTransactionReceipt({ hash: w.fixture.txHash as Hex });
  assert.equal(receipt.status, "success");
  return { client, receipt, block: receipt.blockNumber };
}
const readDecimals = (rpc: ReturnType<typeof chainRpc>, w: World) => rpc.readContract({ address: w.fixture.token as Address, abi: ERC20, functionName: "decimals" });
const readLogs = async (rpc: ReturnType<typeof chainRpc>, w: World) => {
  const { block } = await paymentWindow(w);
  const logs = await rpc.getLogs({ address: w.fixture.token as Address, event: TRANSFER, fromBlock: block, toBlock: block });
  assert(logs.some((l) => l.transactionHash === w.fixture.txHash.toLowerCase() && (l.args as { from: string }).from.toLowerCase() === w.fixture.safe.toLowerCase()), "the selected payment's Transfer is read");
  return logs;
};

/** A UserOperation from the selected company Safe that no owner signed. The real bundler must refuse it in validation. */
async function unsignedOperation(w: World, nonceOffset = 0n): Promise<{ operation: RpcUserOperation; expectedHash: Hex }> {
  const client = createPublicClient({ transport: http(w.rpc, { retryCount: 0 }) });
  const nonce = await client.readContract({ address: entryPoint07Address, abi: parseAbi(["function getNonce(address,uint192) view returns (uint256)"]), functionName: "getNonce", args: [w.fixture.safe as Address, 0n] });
  assert(nonce + nonceOffset >= 0n, "a used nonce needs an earlier operation");
  const fees = await client.estimateFeesPerGas();
  assert(w.paymaster, "the selected world has no saved sponsor");
  const base = { sender: w.fixture.safe as Address, nonce: nonce + nonceOffset, callData: "0x" as Hex, callGasLimit: 100_000n, verificationGasLimit: 600_000n,
    preVerificationGas: 100_000n, maxFeePerGas: fees.maxFeePerGas * 2n, maxPriorityFeePerGas: fees.maxPriorityFeePerGas * 2n,
    paymaster: w.paymaster, paymasterVerificationGasLimit: 100_000n, paymasterPostOpGasLimit: 50_000n, paymasterData: "0x" as Hex };
  const validity = pad("0x", { size: 12 });
  const unsigned = getUserOperationHash({ chainId: w.chainId, entryPointAddress: entryPoint07Address, entryPointVersion: "0.7", userOperation: { ...base, signature: validity } });
  const signature = concat([validity, await privateKeyToAccount(generatePrivateKey()).sign({ hash: unsigned })]);
  const expectedHash = getUserOperationHash({ chainId: w.chainId, entryPointAddress: entryPoint07Address, entryPointVersion: "0.7", userOperation: { ...base, signature } });
  const q = (n: bigint) => toHex(n);
  return { expectedHash, operation: { sender: base.sender, nonce: q(base.nonce), callData: base.callData, signature, callGasLimit: q(base.callGasLimit),
    verificationGasLimit: q(base.verificationGasLimit), preVerificationGas: q(base.preVerificationGas), maxFeePerGas: q(base.maxFeePerGas),
    maxPriorityFeePerGas: q(base.maxPriorityFeePerGas), paymaster: base.paymaster, paymasterVerificationGasLimit: q(base.paymasterVerificationGasLimit),
    paymasterPostOpGasLimit: q(base.paymasterPostOpGasLimit), paymasterData: "0x" } };
}
/** The selected payment's own UserOperation hash, from its mined EntryPoint event. */
async function paymentOperation(w: World): Promise<Hex> {
  const { receipt } = await paymentWindow(w);
  const event = receipt.logs.filter((l) => l.address.toLowerCase() === entryPoint07Address.toLowerCase()).map((l) => {
    try { return decodeEventLog({ abi: [USER_OPERATION], data: l.data, topics: l.topics }); } catch { return null; }
  }).find((e) => e && e.args.sender.toLowerCase() === w.fixture.safe.toLowerCase());
  assert(event, "the selected payment was carried by a UserOperation from the company Safe");
  return event.args.userOpHash;
}
const bundlerUrl = (w: World) => { assert(w.bundler, "the selected world has no supplied bundler"); return w.bundler; };

const checks: Record<string, Check> = {
  "CHAIN.read-contract-unavailable": unavailable("readContract", readDecimals, "eth_call"),
  "CHAIN.read-contract-unusable": async (w, note) => gates([w.rpc], async ([g]) => {
    const rpc = chainRpc({ nodes: [{ url: g!.url }] });
    assert.equal(await readDecimals(rpc, w), 6);
    await refused("PROVIDER_RESPONSE_INVALID", () => rpc.readContract({ address: w.fixture.token as Address, abi: ERC20, functionName: "owner" }));
    await refused("PROVIDER_RESPONSE_INVALID", () => rpc.readContract({ address: privateKeyToAccount(generatePrivateKey()).address, abi: ERC20, functionName: "decimals" }));
    assert.equal(count(g!.forwarded, "eth_call"), 3, "a revert and an empty answer are final verdicts, not retried");
    note("readContract", { control: "token decimals 6", reverted: "token has no owner()", noCode: "fresh address" });
  }),
  "CHAIN.code-unavailable": unavailable("getCode", (rpc, w) => rpc.getCode(w.fixture.safe as Address), "eth_getCode"),
  "CHAIN.code-unusable": unusable("getCode", "eth_getCode", (u) => ({ ...u, result: 42 }), async (rpc, w) => assert.notEqual(await rpc.getCode(w.fixture.safe as Address), "0x")),
  "CHAIN.block-unavailable": unavailable("getBlock", (rpc) => rpc.getBlock(), "eth_getBlockByNumber"),
  "CHAIN.block-unusable": unusable("getBlock", "eth_getBlockByNumber", (u) => ({ ...u, result: { ...u.result, hash: "0x12" } }), async (rpc) => assert((await rpc.getBlock()).number > 0n)),
  "CHAIN.logs-unavailable": unavailable("getLogs", readLogs, "eth_getLogs", true),
  "CHAIN.logs-outside-window": unusable("getLogs", "eth_getLogs", (u) => ({ ...u, result: u.result.map((l: any) => ({ ...l, blockNumber: toHex(BigInt(l.blockNumber) + 1n) })) }), readLogs, true),
  "CHAIN.logs-undecodable": unusable("getLogs", "eth_getLogs", (u) => ({ ...u, result: u.result.map((l: any) => ({ ...l, topics: l.topics.slice(0, 1) })) }), readLogs, true),
  "BUNDLER.lookup-unavailable": async (w, note) => gates([bundlerUrl(w)], async ([g]) => {
    const hash = await paymentOperation(w);
    const found = await bundlerProvider(httpTransport(g!.url)).lookup(hash);
    assert(found.receipt?.success && found.receipt.receipt.transactionHash.toLowerCase() === w.fixture.txHash.toLowerCase(), "the real bundler finds the selected payment");
    for (const mode of OUTAGES) {
      g!.received.length = 0; g!.set({ "*": mode });
      await refused("PROVIDER_ERROR", () => bundlerProvider(httpTransport(g!.url)).lookup(hash));
      assert.deepEqual(["eth_getUserOperationByHash", "eth_getUserOperationReceipt"].map((m) => count(g!.received, m)), [3, 3], `${mode.kind}: three attempts per read`);
    }
    note("lookup", { control: hash, outages: OUTAGES.map((m) => m.kind) });
  }),
  "BUNDLER.lookup-unusable": async (w, note) => gates([bundlerUrl(w)], async ([g]) => {
    const hash = await paymentOperation(w);
    g!.set({ eth_getUserOperationReceipt: { kind: "rewrite", body: (_r, u) => ({ ...u, result: { ...u.result, userOpHash: toHex(1n, { size: 32 }) } }) } });
    await refused("PROVIDER_RESPONSE_INVALID", () => bundlerProvider(httpTransport(g!.url)).lookup(hash));
    g!.set({ eth_getUserOperationByHash: { kind: "rewrite", body: (_r, u) => ({ ...u, result: { ...u.result, userOperation: { sender: 5 } } }) } });
    await refused("PROVIDER_RESPONSE_INVALID", () => bundlerProvider(httpTransport(g!.url)).lookup(hash));
    note("lookup", { rewritten: ["receipt names another operation", "held operation does not decode"] });
  }),
  "BUNDLER.send-rejected": async (w, note) => {
    const provider = bundlerProvider(httpTransport(bundlerUrl(w)));
    const before = await unsignedOperation(w);
    await refused("TRANSACTION_FAILED", () => provider.send({ operation: before.operation, entryPoint: entryPoint07Address, expectedHash: before.expectedHash }));
    const used = await unsignedOperation(w, -1n);
    await refused("TRANSACTION_FAILED", () => provider.send({ operation: used.operation, entryPoint: entryPoint07Address, expectedHash: used.expectedHash }));
    const after = await unsignedOperation(w);
    assert.equal(after.operation.nonce, before.operation.nonce, "nothing reached the chain");
    assert.deepEqual(await provider.lookup(before.expectedHash), { operation: null, receipt: null });
    note("send", { refusedByRealBundler: ["unsigned by any owner", "nonce already used"], nonce: before.operation.nonce });
  },
  "BUNDLER.send-unanswered": async (w, note) => gates([bundlerUrl(w)], async ([g]) => {
    const op = await unsignedOperation(w);
    g!.set({ eth_sendUserOperation: { kind: "timeout" } });
    await refused("PROVIDER_ERROR", () => bundlerProvider(httpTransport(g!.url)).send({ ...op, entryPoint: entryPoint07Address }));
    assert.equal(count(g!.received, "eth_sendUserOperation"), 1, "sent once, never again");
    assert.equal(count(g!.forwarded, "eth_sendUserOperation"), 0);
    assert(count(g!.forwarded, "eth_getUserOperationByHash") >= 1, "the unanswered send was looked up on the real bundler");
    note("send", { sends: 1, lookedUp: true });
  }),
  "BUNDLER.send-wrong-hash": async (w, note) => gates([bundlerUrl(w)], async ([g]) => {
    const op = await unsignedOperation(w);
    g!.set({ eth_sendUserOperation: { kind: "answer", body: (r) => ({ jsonrpc: "2.0", id: r.id, result: toHex(2n, { size: 32 }) }) } });
    await refused("PROVIDER_RESPONSE_INVALID", () => bundlerProvider(httpTransport(g!.url)).send({ ...op, entryPoint: entryPoint07Address }));
    assert.equal(count(g!.received, "eth_sendUserOperation"), 1);
    note("send", { answeredHash: "not the signed operation's" });
  }),
};

if (process.argv.includes("--list")) {
  console.log("SHARED.selected-stack\tguard");
  for (const name of Object.keys(checks)) console.log(`${name}\tcheck`);
} else {
  const onlyIndex = process.argv.indexOf("--only");
  const only = onlyIndex < 0 ? [] : (process.argv[onlyIndex + 1] ?? "").split(",");
  const selected = Object.entries(checks).filter(([name]) => !only.length || only.some((prefix) => name.startsWith(prefix)));
  const emit = (name: string, ok: boolean, ms: number, detail: string) => console.log(`@check\t${name}\t${ok ? "pass" : "fail"}\t${ms}\t${detail.replace(/\s+/g, " ").slice(0, 300)}`);
  let failed = false, world: World | undefined;
  try {
    assert(selected.length, "no shared checks selected");
    const configPath = process.env.CAPXUL_WORLD_CONFIG, run = process.env.CAPXUL_EVAL_RUN_DIR, fixture = process.env.CAPXUL_ACCEPTANCE_FIXTURE;
    assert(configPath && run && fixture && process.argv[2], "selected-world inputs are required");
    assert.equal((await stat(configPath)).mode & 0o077, 0, "world configuration must be private");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const parsed = parseRunReceipt(JSON.parse(await readFile(join(run, "receipt.json"), "utf8")));
    assert(parsed.ok, "invalid running receipt");
    const receipt = parsed.value;
    assert.equal(receipt.state, "running");
    assert.deepEqual([receipt.environment.world, receipt.environment.storage, receipt.environment.indexer, receipt.environment.stack], ["slice-zero", "postgres", "ponder", "postgres-ponder-erpnext-v4"]);
    assert.equal(receipt.commit, config.codeVersion); assert.equal(resolve(config.root), process.cwd());
    const f = fixtureFrom(fixture, process.argv[2]!);
    assert.equal(f.world, "slice-zero");
    assert(config.world.sites.some((site: { name: string; company: string }) => site.name === f.site && site.company === f.slug), "fixture does not belong to this concrete world");
    const { stdout } = await promisify(execFile)(process.execPath, [join(config.root, "packages/cli/src/main.ts"), "world", "inspect", "--config", configPath, "--json"], { timeout: 60000, maxBuffer: 1024 * 1024 });
    const live = JSON.parse(stdout);
    assert.equal(live.world.id, config.world.id); assert.equal(live.world.epoch, config.world.epoch); assert.equal(live.codeVersion, config.codeVersion);
    assert.equal(live.stack, receipt.environment.stack); assert(live.core.ok && !live.core.paused, "Core is not ready");
    assert.equal(live.chain.chainId, config.chainId);
    assert(Math.abs(Date.now() - Date.parse(live.observedAt)) < 15000, "inspection is stale");
    const evidence = resolve(run, "shared", "checks"); await mkdir(evidence, { recursive: true });
    await writeFile(join(evidence, "..", "inspection.json"), JSON.stringify(live, null, 2) + "\n");
    world = { fixture: f, rpc: loopback(config.ports.anvil), bundler: live.bundlerConfigured && config.bundler?.url ? config.bundler.url : null, paymaster: config.bundler?.paymaster ?? null, chainId: config.chainId, evidence };
    emit("SHARED.selected-stack", true, 0, "private fixture, running receipt and live public inspection identify one selected stack");
  } catch {
    failed = true;
    emit("SHARED.selected-stack", false, 0, "selected-world prerequisite refused; no component proof or historical receipt accepted");
    for (const [name] of selected) emit(name, false, 0, "no verified selected-world observation in this run");
  }
  if (world) for (const [name, check] of selected) {
    const start = Date.now(), notes: Record<string, unknown> = {};
    try {
      await check(world, (key, value) => { notes[key] = value; });
      await writeFile(join(world.evidence, `${name}.json`), JSON.stringify({ check: name, ok: true, at: new Date().toISOString(), notes }, null, 2) + "\n");
      emit(name, true, Date.now() - start, `production adapter against the selected world's real process: ${JSON.stringify(notes)}`);
    } catch (error) {
      failed = true;
      const reason = error instanceof Error ? error.message : String(error);
      await writeFile(join(world.evidence, `${name}.json`), JSON.stringify({ check: name, ok: false, at: new Date().toISOString(), reason, notes }, null, 2) + "\n");
      emit(name, false, Date.now() - start, reason);
    }
  }
  process.exitCode = failed ? 1 : 0;
}
