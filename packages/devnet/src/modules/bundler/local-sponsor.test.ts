import assert from "node:assert/strict";
import { test } from "node:test";
import { concat, encodePacked, recoverMessageAddress, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { entryPoint07Address } from "viem/account-abstraction";
import type { Chain } from "../chain/types.ts";
import { httpTransport } from "./provider.ts";
import { localSponsorHandler, SINGLETON_PAYMASTER_07, startLocalSponsor, type LocalSponsorConfig } from "./local-sponsor.ts";

const NOW = 1_800_000_000, AFTER = NOW + 61, UNTIL = NOW + 601;
const sender: Address = `0x${"5a".repeat(20)}`, paymaster: Address = `0x${"9c".repeat(20)}`;
const HASH: Hex = `0x${"7e".repeat(32)}`;
const signerKey = generatePrivateKey(), signer = privateKeyToAccount(signerKey).address;
const ownerWindow = (after: number, until: number): Hex => encodePacked(["uint48", "uint48", "bytes"], [after, until, `0x${"01".repeat(64)}1b`]);
const op = (x: Record<string, unknown> = {}) => ({
  sender, nonce: toHex((517n << 64n) + 3n), callData: "0x1234", signature: ownerWindow(AFTER, UNTIL),
  verificationGasLimit: "0x20000", callGasLimit: "0x30000", preVerificationGas: "0xc350", maxFeePerGas: "0x3b9aca00", maxPriorityFeePerGas: "0x5f5e100",
  paymaster, paymasterVerificationGasLimit: "0x11111", paymasterPostOpGasLimit: "0x2222", paymasterData: "0x", ...x,
});
const context = (after = AFTER, until = UNTIL) => ({ validAfter: toHex(after), validUntil: toHex(until) });

function fixture(over: Partial<LocalSponsorConfig> = {}, listed = true) {
  const reads: { functionName: string; args?: readonly unknown[] }[] = [], forwarded: unknown[][] = [];
  const client = {
    async getChainId() { return 84532; },
    async getCode() { return "0x6080"; },
    async readContract(x: { functionName: string; args?: readonly unknown[] }) {
      reads.push(x);
      return x.functionName === "getHash" ? HASH : x.functionName === "entryPoint" ? entryPoint07Address : listed;
    },
  };
  const chain = { rpcUrl: "http://127.0.0.1:1", chainId: 84532, client, walletFor() { throw new Error("no sends"); } } as unknown as Chain;
  const config: LocalSponsorConfig = {
    admission: "test-only", chain, entryPoint: entryPoint07Address, paymaster, signerKey, senders: [sender], now: () => new Date(NOW * 1000),
    maxWindowSeconds: 900, maxPaymasterGas: 200_000n, maxCostWei: 10n ** 16n,
    bundler: { async request(_method, params) { forwarded.push([...params]); return { callGasLimit: "0x1" }; } }, ...over,
  };
  return { config, reads, forwarded, handle: localSponsorHandler(config) };
}
const refused = (rpcCode: number) => (error: unknown) => { assert.equal((error as { rpcCode: number }).rpcCode, rpcCode); return true; };

test("stub and final data carry the exact requested window, and final data signs the deployed paymaster's hash of the final operation", async () => {
  const { handle, reads } = fixture();
  // Upstream verifying layout: mode byte 1 (verifying, any bundler), validUntil, then validAfter.
  const window = encodePacked(["uint8", "uint48", "uint48"], [1, UNTIL, AFTER]);
  const stub = await handle("pm_getPaymasterStubData", [op(), entryPoint07Address, "0x14a34", context()]) as Record<string, Hex>;
  assert.equal(stub.paymaster, paymaster);
  assert.equal(stub.paymasterData, concat([window, SINGLETON_PAYMASTER_07.dummySignature]));
  assert.equal(reads.length, 0, "stub data is not signed");
  const final = await handle("pm_getPaymasterData", [op(), entryPoint07Address, "0x14a34", context()]) as { paymaster: Hex; paymasterData: Hex };
  assert.equal(final.paymasterData.slice(0, 28), window);
  assert.equal(await recoverMessageAddress({ message: { raw: HASH }, signature: `0x${final.paymasterData.slice(28)}` }), signer);
  const [mode, packed] = reads[0]!.args as [number, Record<string, unknown>];
  assert.equal(reads[0]!.functionName, "getHash");
  assert.equal(mode, 0);
  assert.equal(packed.accountGasLimits, `0x${"20000".padStart(32, "0")}${"30000".padStart(32, "0")}`, "verification gas before call gas");
  assert.equal(packed.paymasterAndData, concat([paymaster, `0x${"11111".padStart(32, "0")}`, `0x${"2222".padStart(32, "0")}`, window]), "the hash binds the final paymaster gas and window");
  assert.equal(packed.nonce, (517n << 64n) + 3n);
});

test("test admission refuses other Safes, chains, entry points, deployments, unbounded or mismatched windows and costly operations", async () => {
  const later = (s: number) => () => new Date(s * 1000);
  const cases: [string, unknown[], Partial<LocalSponsorConfig>?][] = [
    ["sender", [op({ sender: `0x${"11".repeat(20)}` }), entryPoint07Address, "0x14a34", context()]],
    ["entry point", [op(), `0x${"22".repeat(20)}`, "0x14a34", context()]],
    ["account deployment", [op({ factory: `0x${"33".repeat(20)}`, factoryData: "0x" }), entryPoint07Address, "0x14a34", context()]],
    ["chain", [op(), entryPoint07Address, "0x1", context()]],
    ["missing window", [op(), entryPoint07Address, "0x14a34", {}]],
    ["open start", [op({ signature: ownerWindow(0, UNTIL) }), entryPoint07Address, "0x14a34", context(0, UNTIL)]],
    ["empty window", [op({ signature: ownerWindow(UNTIL, UNTIL) }), entryPoint07Address, "0x14a34", context(UNTIL, UNTIL)]],
    ["expired on the canonical clock", [op(), entryPoint07Address, "0x14a34", context()], { now: later(UNTIL) }],
    ["window too long", [op({ signature: ownerWindow(AFTER, AFTER + 901) }), entryPoint07Address, "0x14a34", context(AFTER, AFTER + 901)]],
    ["window too far ahead", [op({ signature: ownerWindow(NOW + 800, NOW + 901) }), entryPoint07Address, "0x14a34", context(NOW + 800, NOW + 901)]],
    ["Safe signature window differs", [op({ signature: ownerWindow(AFTER + 1, UNTIL) }), entryPoint07Address, "0x14a34", context()]],
  ];
  for (const [name, params, over] of cases) {
    for (const method of ["pm_getPaymasterStubData", "pm_getPaymasterData"]) {
      const { handle, reads } = fixture(over);
      await assert.rejects(handle(method, params), refused(-32501), `${name} via ${method}`);
      assert.equal(reads.length, 0, `${name} signs nothing`);
    }
  }
  for (const [name, over] of [["paymaster gas", { paymasterVerificationGasLimit: "0x30d41" }], ["no paymaster gas", { paymasterVerificationGasLimit: "0x0" }], ["cost", { maxFeePerGas: "0x174876e800" }]] as const) {
    const { handle, reads } = fixture();
    await assert.rejects(handle("pm_getPaymasterData", [op(over), entryPoint07Address, "0x14a34", context()]), refused(-32501), name);
    assert.equal(reads.length, 0);
  }
  await assert.rejects(fixture().handle("eth_sendUserOperation", [op(), entryPoint07Address]), refused(-32601), "the sponsor never sends");
});

test("estimation is admitted, then delegated unchanged to the real bundler, whose refusal code survives without its message", async () => {
  const { handle, forwarded } = fixture();
  const params = [op(), entryPoint07Address];
  assert.deepEqual(await handle("eth_estimateUserOperationGas", params), { callGasLimit: "0x1" });
  assert.deepEqual(forwarded, [params]);
  await assert.rejects(handle("eth_estimateUserOperationGas", [op({ sender: `0x${"11".repeat(20)}` }), entryPoint07Address]), refused(-32501));
  assert.equal(forwarded.length, 1, "an unadmitted Safe is not forwarded");
  const rejecting = fixture({ bundler: { async request() { throw Object.assign(new Error("secret simulation"), { rpcCode: -32521 }); } } });
  await assert.rejects(rejecting.handle("eth_estimateUserOperationGas", params), (e: unknown) => refused(-32521)(e) && !(e as Error).message.includes("secret"));
});

test("the HTTP sponsor starts only with explicit test-only admission and a listed signer, serves loopback JSON-RPC and closes", async () => {
  await assert.rejects(startLocalSponsor({ ...fixture().config, admission: "staging" as "test-only" }), /test-only admission/);
  assert.throws(() => localSponsorHandler({ ...fixture().config, admission: "staging" as "test-only" }), /test-only admission/, "the handler itself refuses without admission");
  assert.throws(() => localSponsorHandler({ ...fixture().config, chain: { ...fixture().config.chain, rpcUrl: "https://sepolia.base.org" } }), /loopback/);
  await assert.rejects(startLocalSponsor(fixture({}, false).config), /does not list the disposable signer/);
  await assert.rejects(startLocalSponsor({ ...fixture().config, chain: { ...fixture().config.chain, rpcUrl: "https://sepolia.base.org" } }), /loopback/);
  const sponsor = await startLocalSponsor(fixture().config);
  try {
    assert.match(sponsor.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(sponsor.signer, signer);
    const rpc = httpTransport(sponsor.url);
    const final = await rpc.request("pm_getPaymasterData", [op(), entryPoint07Address, "0x14a34", context()]) as { paymasterData: Hex };
    assert.equal(await recoverMessageAddress({ message: { raw: HASH }, signature: `0x${final.paymasterData.slice(28)}` }), signer);
    await assert.rejects(rpc.request("pm_getPaymasterData", [op({ sender: `0x${"11".repeat(20)}` }), entryPoint07Address, "0x14a34", context()]),
      (e: unknown) => refused(-32501)(e) && !(e as Error).message.includes("1111"));
  } finally { await sponsor.close(); }
  assert.equal(await fetch(sponsor.url, { method: "POST" }).then(() => true, () => false), false, "no listener remains");
});
