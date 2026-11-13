import assert from "node:assert/strict";
import { createServer } from "node:http";
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
  for (const rpc of [-32500, -32501, -32502, -32503, -32506, -32507, -32508, -32599, -32602]) {
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
  // A lost answer, or a refusal, for an operation the bundler does hold is the signed hash: Alto answers -32602
  // "Already known" when the identical operation is already in its mempool.
  for (const rpc of [-32504, -32602, -32500]) {
    const sends = { n: 0 };
    assert.deepEqual(await bundler({ gatewayUrl: "x", entryPoint }, gateway(rpc, { userOperation: op }, sends)).send(op, { expectedHash: signed }), { hash: signed.toLowerCase() }, `rpc ${rpc}`);
    assert.equal(sends.n, 1);
  }
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

test("send over HTTP: Alto's exact -32602 'Already known' is the signed hash although no lookup can see it; any other -32602 is refused", async () => {
  // Real Alto 0.0.21 before bundling: the duplicate is in its mempool, and both reads search only on-chain logs.
  let sends = 0, reads = 0, message = "";
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const { method } = JSON.parse(raw);
    res.writeHead(200, { "content-type": "application/json" });
    if (method === "eth_sendUserOperation") { sends++; res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message } })); }
    else { reads++; res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: null })); }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const door = bundler({ gatewayUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, entryPoint });
  try {
    message = "Already known";
    assert.deepEqual(await door.send(op, { expectedHash: signed }), { hash: signed.toLowerCase() });
    assert.deepEqual([sends, reads], [1, 0], "sent once; nothing to look up");
    for (const other of ["already known", "Already known.", "AA25 invalid account nonce", "secret Already known"]) {
      message = other; sends = reads = 0;
      assert.deepEqual(await door.send(op, { expectedHash: signed }), { refused: { code: "TRANSACTION_FAILED", reason: "the bundler refused the operation in validation" } }, other);
      assert.deepEqual([sends, reads], [1, 2], "refused only after a lookup finds it not held");
    }
  } finally { server.close(); }
});
