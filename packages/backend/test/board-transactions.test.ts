import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, getAddress, parseAbi, type Address } from "viem";
import { transaction } from "../src/board/transactions.ts";

// DB-free, so CI runs it: the pinned Hats and MultiSendCallOnly addresses, as checksummed as the world pins them.
const hats = getAddress("0x3bc1a0ad72417f2d411118085256fc53cbddd137"), multiSend = getAddress("0x9641d764fc13c8b624c04430c7356c1c7c8102e2");
const call = (to: string, data = "0x1234") => ({ to: to as Address, value: "0", data: data as `0x${string}` });

test("Board transaction accepts checksummed targets and stores them lowercase", () => {
  assert.notEqual(hats, hats.toLowerCase(), "fixture must be mixed case");
  assert.deepEqual(transaction([call(hats, "0xABcd")], multiSend),
    { to: hats.toLowerCase(), value: "0", data: "0xabcd", operation: "call" });
  assert.equal(transaction([call(hats.toLowerCase())], multiSend).to, hats.toLowerCase());
});

test("Board transaction batches through lowercase MultiSendCallOnly with CALL-only inner calls", () => {
  const second = getAddress(`0x${"ab".repeat(20)}`);
  const tx = transaction([call(hats, "0xABcd"), call(second, "0x")], multiSend);
  assert.equal(tx.to, multiSend.toLowerCase()); assert.equal(tx.operation, "delegatecall");
  assert.equal(tx.data, tx.data.toLowerCase(), "batch data must be canonical like the stored calls");
  const [packed] = decodeFunctionData({ abi: parseAbi(["function multiSend(bytes transactions)"]), data: tx.data }).args;
  // operation(1) to(20) value(32) length(32) data: both inner operations are 0 (CALL).
  assert.equal(packed.slice(2, 4), "00"); assert.equal(packed.slice(4, 44), hats.slice(2).toLowerCase());
  assert.equal(packed.slice(2 + (1 + 20 + 32 + 32) * 2, 2 + (1 + 20 + 32 + 32 + 2) * 2), "abcd");
  const next = 2 + (1 + 20 + 32 + 32 + 2) * 2;
  assert.equal(packed.slice(next, next + 2), "00"); assert.equal(packed.slice(next + 2, next + 42), second.slice(2).toLowerCase());
});

test("Board transaction refuses malformed targets and calldata", () => {
  const badChecksum = hats.replace("A", "a").replace("b", "B");
  for (const bad of [[call(badChecksum)], [call(hats.slice(0, -1))], [call(`0xg${"0".repeat(39)}`)],
    [call(hats, "0x123")], [call(hats, "0xzz")], [call(hats, "1234")], []]) {
    assert.throws(() => transaction(bad, multiSend), /INVALID_INPUT/, JSON.stringify(bad));
  }
});
