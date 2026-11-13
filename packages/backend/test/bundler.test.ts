import assert from "node:assert/strict";
import { test } from "node:test";
import { bundler, type RpcTransport, type SignedUserOperation } from "../src/shared/door.ts";

const signed = `0x${"AB".repeat(32)}` as const;
const entryPoint = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const op = {
  sender: `0x${"12".repeat(20)}`, nonce: "0x3", callData: "0x1234", signature: "0x1122",
  callGasLimit: "0x100", verificationGasLimit: "0x200", preVerificationGas: "0x300", maxFeePerGas: "0x5", maxPriorityFeePerGas: "0x2",
  paymaster: `0x${"34".repeat(20)}`, paymasterVerificationGasLimit: "0x10", paymasterPostOpGasLimit: "0x20", paymasterData: "0x",
} as SignedUserOperation;
const code = (value: string) => (error: unknown) => {
  assert.ok(error instanceof Error && "code" in error && error.code === value, String(error));
  assert.ok(!error.message.includes("secret"), "provider text never leaks");
  return true;
};
/** A gateway whose send rejects with an RPC code, and whose reads answer `held` (null: nothing held). */
const gateway = (sendCode: number | null, held: unknown = null, sends = { n: 0 }): RpcTransport => ({ async request(method) {
  if (method === "eth_sendUserOperation") { sends.n++; if (sendCode === null) return signed.toLowerCase(); throw { code: sendCode, message: "secret reason" }; }
  return method === "eth_getUserOperationByHash" ? held : null;
} });

test("send: the signed hash, lowercased; validation refusals are answers; throttling and stake are lost answers", async () => {
  assert.deepEqual(await bundler({ gatewayUrl: "http://127.0.0.1:1", entryPoint }, gateway(null)).send(op, { expectedHash: signed }), { hash: signed.toLowerCase() });
  for (const rpc of [-32500, -32501, -32502, -32503, -32506, -32507, -32602]) {
    const sends = { n: 0 };
    const answer = await bundler({ gatewayUrl: "x", entryPoint }, gateway(rpc, null, sends)).send(op, { expectedHash: signed });
    assert.deepEqual(answer, { refused: { code: "TRANSACTION_FAILED", reason: "the bundler refused the operation in validation" } }, `rpc ${rpc}`);
    assert.equal(sends.n, 1, "never sent twice");
  }
  for (const rpc of [-32504, -32505, -32603]) {
    const sends = { n: 0 };
    await assert.rejects(bundler({ gatewayUrl: "x", entryPoint }, gateway(rpc, null, sends)).send(op, { expectedHash: signed }), code("PROVIDER_ERROR"), `rpc ${rpc}`);
    assert.equal(sends.n, 1, "a lost answer is looked up, never sent again");
  }
  // A lost answer for an operation the bundler does hold is the signed hash.
  assert.deepEqual(await bundler({ gatewayUrl: "x", entryPoint }, gateway(-32504, { userOperation: op })).send(op, { expectedHash: signed }), { hash: signed.toLowerCase() });
});

test("send: an answered hash that is not the signed one is PROVIDER_RESPONSE_INVALID, never success", async () => {
  const other: RpcTransport = { async request() { return `0x${"cd".repeat(32)}`; } };
  await assert.rejects(bundler({ gatewayUrl: "x", entryPoint }, other).send(op, { expectedHash: signed }), code("PROVIDER_RESPONSE_INVALID"));
});

test("lookup: held by the operation or its receipt; an outage after the retries is PROVIDER_ERROR", async () => {
  const door = (byHash: unknown, receipt: unknown) => bundler({ gatewayUrl: "x", entryPoint }, { async request(m) { return m === "eth_getUserOperationByHash" ? byHash : receipt; } });
  assert.deepEqual(await door(null, null).lookup(signed), { held: false, receipt: null });
  assert.deepEqual(await door({ userOperation: op }, null).lookup(signed), { held: true, receipt: null });
  const tx = `0x${"EF".repeat(32)}`;
  assert.deepEqual(await door(null, { userOpHash: signed, success: false, receipt: { transactionHash: tx } }).lookup(signed),
    { held: true, receipt: { success: false, transactionHash: tx.toLowerCase() } });
  let reads = 0;
  await assert.rejects(bundler({ gatewayUrl: "x", entryPoint }, { async request() { reads++; throw new Error("secret outage"); } }).lookup(signed), code("PROVIDER_ERROR"));
  assert.equal(reads, 6, "two reads, each tried three times");
  await assert.rejects(door({ userOperation: { sender: "0x1" } }, null).lookup(signed), code("PROVIDER_RESPONSE_INVALID"));
});
