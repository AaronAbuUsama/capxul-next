// The calls of a change to a company's Board (src/board/calls.ts), decoded as the contracts would read them: a seat
// takes one more seat only when every seat is worn, before the mint, and the Gate's claim comes last; a threshold is
// the Gate's config, `ABSOLUTE` with `min = target`.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import { decodeFunctionData } from "viem";
import { seatCalls, thresholdCall } from "../src/board/calls.ts";
import { GATE, HATS } from "../src/chain/abi.ts";

const HATS_AT = "0x3bc1A0Ad72417f2d411118085256fC53CBdDd137";
const GATE_AT = "0x00000000000000000000000000000000000000a1";
const WEARER = "0x0000000000000000000000000000000000000051";
const HAT = 26959946667150639794667015087019630673637144422540572481103610249216n;

const named = (call: { readonly to: string; readonly data: `0x${string}` }) =>
  call.to === GATE_AT
    ? decodeFunctionData({ abi: GATE, data: call.data })
    : decodeFunctionData({ abi: HATS, data: call.data });

test("a seat free: the Director hat is minted to the wearer's Safe, then the Gate claims it as a signer", () => {
  const calls = seatCalls({ hats: HATS_AT, gate: GATE_AT, hat: HAT, supply: 2, maxSupply: 3, wearer: WEARER });
  assert.deepEqual(
    Arr.map(calls, (call) => [call.to, named(call).functionName, named(call).args]),
    [
      [HATS_AT, "mintHat", [HAT, WEARER]],
      [GATE_AT, "claimSignerFor", [HAT, WEARER]],
    ],
  );
});

test("every seat worn: one more seat first, then the mint and the claim", () => {
  const calls = seatCalls({ hats: HATS_AT, gate: GATE_AT, hat: HAT, supply: 2, maxSupply: 2, wearer: WEARER });
  assert.deepEqual(
    Arr.map(calls, (call) => [named(call).functionName, named(call).args]),
    [
      ["changeHatMaxSupply", [HAT, 3]],
      ["mintHat", [HAT, WEARER]],
      ["claimSignerFor", [HAT, WEARER]],
    ],
  );
});

test("a threshold is the Gate's config: ABSOLUTE, its min and target both the threshold", () => {
  const call = thresholdCall(GATE_AT, 3);
  assert.equal(call.to, GATE_AT);
  const decoded = decodeFunctionData({ abi: GATE, data: call.data });
  assert.deepEqual(
    [decoded.functionName, decoded.args],
    ["setThresholdConfig", [{ thresholdType: 0, min: 3n, target: 3n }]],
  );
});
