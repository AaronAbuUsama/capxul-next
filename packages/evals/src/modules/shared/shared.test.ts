import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { parseAbi } from "viem";
import { chainRpc } from "../../../../backend/src/shared/door.ts";
import { httpGate } from "./fault-gate.ts";

// A JSON-RPC node that answers a fixed block and refuses eth_call as a revert, so the policy is checked without a chain.
async function node() {
  const server = createServer((req, res) => {
    let body = ""; req.on("data", (c) => { body += c; }); req.on("end", () => {
      const { id, method } = JSON.parse(body);
      const reply = method === "eth_call" ? { jsonrpc: "2.0", id, error: { code: 3, message: "execution reverted" } }
        : { jsonrpc: "2.0", id, result: { number: "0x2a", hash: `0x${"ab".repeat(32)}`, timestamp: "0x10", baseFeePerGas: "0x1" } };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((done) => server.close(done)) };
}
const code = async (p: Promise<unknown>) => { try { await p; return "answered"; } catch (e) { return (e as { code?: string }).code; } };

test("chain-rpc tries each node once, three in all, and falls through to a live node", async () => {
  const real = await node();
  const gates = await Promise.all([httpGate(real.url), httpGate(real.url), httpGate(real.url), httpGate(real.url)]);
  try {
    const [down, hung, throttled, fourth] = gates;
    down!.set({ "*": { kind: "down" } }); hung!.set({ "*": { kind: "timeout" } }); throttled!.set({ "*": { kind: "throttle" } });
    assert.equal(await code(chainRpc({ nodes: [down!, hung!, throttled!, fourth!].map((g) => ({ url: g.url })) }).getBlock()), "PROVIDER_ERROR");
    assert.deepEqual(gates.map((g) => g.received.length), [1, 1, 1, 0], "a fourth node is never tried");
    assert.equal((await chainRpc({ nodes: [{ url: down!.url }, { url: fourth!.url }] }).getBlock()).number, 42n);
  } finally { await Promise.all(gates.map((g) => g.close())); await real.close(); }
});

test("a revert or an undecodable answer is final: no second node is asked", async () => {
  const real = await node();
  const [first, second] = await Promise.all([httpGate(real.url), httpGate(real.url)]);
  try {
    const rpc = chainRpc({ nodes: [{ url: first!.url }, { url: second!.url }] });
    const abi = parseAbi(["function decimals() view returns (uint8)"]);
    assert.equal(await code(rpc.readContract({ address: `0x${"11".repeat(20)}`, abi, functionName: "decimals" })), "PROVIDER_RESPONSE_INVALID");
    first!.set({ "*": { kind: "rewrite", body: (_r, u) => ({ ...u, result: { ...u.result, hash: "0x12" } }) } });
    assert.equal(await code(rpc.getBlock()), "PROVIDER_RESPONSE_INVALID");
    assert.equal(second!.received.length, 0);
  } finally { await Promise.all([first!.close(), second!.close()]); await real.close(); }
});
