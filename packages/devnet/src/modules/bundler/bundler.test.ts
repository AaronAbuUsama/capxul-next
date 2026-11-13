import assert from "node:assert/strict";
import { test } from "node:test";
import { bundlerProvider, canaryBundlerKeys, suppliedAlto, type RpcUserOperation } from "./service.ts";

const expected = `0x${"ab".repeat(32)}` as const;
const other = `0x${"cd".repeat(32)}` as const;
const entryPoint = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const operation: RpcUserOperation = {
  sender: `0x${"12".repeat(20)}`, nonce: "0x3", callData: "0x1234", signature: "0x1122",
  callGasLimit: "0x100", verificationGasLimit: "0x200", preVerificationGas: "0x300", maxFeePerGas: "0x5", maxPriorityFeePerGas: "0x2",
};
const input = { operation, entryPoint, expectedHash: expected } as const;
const code = (value: string) => (error: unknown) => {
  assert.ok(error instanceof Error && "code" in error && error.code === value);
  assert.ok(!error.message.includes("secret"), "raw provider messages must not leak");
  return true;
};

test("send accepts only its independently expected hash and maps validation failures without retry", async () => {
  for (const answer of [other, null, { hash: expected }]) {
    let calls = 0;
    const provider = bundlerProvider({ async request() { calls++; return answer; } });
    await assert.rejects(provider.send(input), code("PROVIDER_RESPONSE_INVALID"));
    assert.equal(calls, 1);
  }
  // A refusal is believed once a lookup finds the operation not held.
  const provider = bundlerProvider({ async request(method) {
    if (method === "eth_sendUserOperation") throw { code: -32507, message: "secret validation details" };
    return null;
  } });
  await assert.rejects(provider.send(input), code("TRANSACTION_FAILED"));
  assert.equal(await bundlerProvider({ async request() { return expected; } }).send(input), expected);
});

test("an uncertain send recovers by lookup of the expected hash and never broadcasts again", async () => {
  let sends = 0;
  const provider = bundlerProvider({ async request(method, params) {
    if (method === "eth_sendUserOperation") { sends++; throw new Error("secret lost response"); }
    assert.deepEqual(params, [expected]);
    return method === "eth_getUserOperationByHash" ? { userOperation: operation } : null;
  } });
  assert.equal(await provider.send(input), expected);
  assert.equal(sends, 1);
  const absent = bundlerProvider({ async request(method) {
    if (method === "eth_sendUserOperation") throw new Error("secret lost response");
    return null;
  } });
  await assert.rejects(absent.send(input), code("PROVIDER_ERROR"));
});

test("lookup distinguishes absent, held and mined operations, rejects wrong hashes/shapes and bounds outages", async () => {
  assert.deepEqual(await bundlerProvider({ async request() { return null; } }).lookup(expected), { operation: null, receipt: null });
  const receipt = { userOpHash: expected, success: true, receipt: { transactionHash: other } };
  assert.deepEqual(await bundlerProvider({ async request(method) { return method === "eth_getUserOperationByHash" ? { userOperation: operation } : receipt; } }).lookup(expected), { operation, receipt });
  for (const bad of [{ ...receipt, userOpHash: other }, { ...receipt, success: "true" }, { ...receipt, receipt: {} }, {}]) {
    await assert.rejects(bundlerProvider({ async request(method) { return method === "eth_getUserOperationByHash" ? null : bad; } }).lookup(expected), code("PROVIDER_RESPONSE_INVALID"));
  }
  await assert.rejects(bundlerProvider({ async request(method) { return method === "eth_getUserOperationByHash" ? { userOperation: { sender: operation.sender } } : null; } }).lookup(expected), code("PROVIDER_RESPONSE_INVALID"));
  let reads = 0;
  await assert.rejects(bundlerProvider({ async request() { reads++; throw new Error("secret outage"); } }).lookup(expected), code("PROVIDER_ERROR"));
  assert.equal(reads, 6, "each of the two lookup methods has an initial call and at most two retries");
});

test("supplied foreground Alto isolates .env and credentials and rejects public-chain URLs", () => {
  const keys = canaryBundlerKeys();
  const options = { ...keys, rpcUrl: "http://127.0.0.1:18545", port: 4337, paymaster: operation.sender, executable: "/devnet/node_modules/.bin/alto" };
  const config = suppliedAlto(options);
  assert.deepEqual(config.argv, [options.executable]);
  assert.equal(config.url, "http://127.0.0.1:4337");
  assert.equal(config.env.ALTO_HOST, "127.0.0.1");
  assert.equal(config.env.DOTENV_CONFIG_PATH, "/dev/null");
  assert.equal(config.env.ALTO_ENTRYPOINTS, entryPoint);
  assert.deepEqual(Object.keys(config.env).filter(k => /PRIVATE_KEY/.test(k)).sort(), ["ALTO_EXECUTOR_PRIVATE_KEYS", "ALTO_UTILITY_PRIVATE_KEY"]);
  assert.throws(() => suppliedAlto({ ...options, rpcUrl: "https://mainnet.example" }), /loopback/);
});
