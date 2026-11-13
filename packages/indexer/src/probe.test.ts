import assert from "node:assert/strict";
import test from "node:test";
import { createPublicClient, custom, encodeAbiParameters } from "viem";
import { HATS_MODULE } from "../abis.ts";
import { answers } from "./probe.ts";

// Each probe goes through viem's real readContract, so the errors are the ones Ponder's client raises.
const probe = (reply: () => Promise<unknown>) => answers(() => createPublicClient({ transport: custom({
  request: async ({ method }) => method === "eth_call" ? reply() : Promise.reject(new Error(`unexpected ${method}`)),
}, { retryCount: 0 }) }).readContract({ address: `0x${"11".repeat(20)}`, abi: HATS_MODULE, functionName: "getHatStatus", args: [1n] }));

test("a module answers; a contract or account that does not implement the call is not a module", async () => {
  assert.equal(await probe(async () => encodeAbiParameters([{ type: "bool" }], [false])), true, "an answer of false is still an answer");
  assert.equal(await probe(async () => "0x"), false, "an account or a contract without the function returns no data");
  assert.equal(await probe(async () => "0x01"), false, "data that does not decode");
  assert.equal(await probe(() => Promise.reject(Object.assign(new Error("execution reverted"), { code: 3, data: "0x" }))), false, "a revert");
});

test("a transport or provider failure rethrows instead of reading as not a module", async () => {
  for (const failure of [new Error("socket hang up"), Object.assign(new Error("header not found"), { code: -32000 }),
    Object.assign(new Error("request timed out"), { name: "TimeoutError" })]) {
    await assert.rejects(probe(() => Promise.reject(failure)), Error, failure.message);
  }
});
