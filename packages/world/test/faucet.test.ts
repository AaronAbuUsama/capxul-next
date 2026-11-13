import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as Arr from "effect/Array";
import * as Str from "effect/String";
import { balanceOfCall, constructorArguments, mintCall } from "../src/chain/faucet.ts";

const words = (hex: string): ReadonlyArray<string> =>
  Arr.map(Arr.fromIterable(Str.matchAll(/.{64}/g)(hex)), (found) => found[0]);

describe("the faucet's calldata", () => {
  test("the token's constructor arguments are (string, string, uint8), ABI-encoded", () => {
    assert.deepStrictEqual(words(constructorArguments("World test USD", "USDC", 6)), [
      "0000000000000000000000000000000000000000000000000000000000000060",
      "00000000000000000000000000000000000000000000000000000000000000a0",
      "0000000000000000000000000000000000000000000000000000000000000006",
      "000000000000000000000000000000000000000000000000000000000000000e",
      "576f726c64207465737420555344000000000000000000000000000000000000",
      "0000000000000000000000000000000000000000000000000000000000000004",
      "5553444300000000000000000000000000000000000000000000000000000000",
    ]);
  });
  test("a name longer than one word moves the second string's offset", () => {
    const encoded = words(constructorArguments("A name that is longer than thirty-two bytes", "T", 18));
    assert.strictEqual(encoded[1], "00000000000000000000000000000000000000000000000000000000000000c0");
    assert.strictEqual(encoded.length, 8);
  });
  test("mint(address,uint256) carries the address and the amount", () => {
    assert.strictEqual(
      mintCall({ to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", amount: 250_000_000n }),
      "0x40c10f1900000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8000000000000000000000000000000000000000000000000000000000ee6b280",
    );
  });
  test("balanceOf(address) carries the address", () => {
    assert.strictEqual(
      balanceOfCall("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"),
      "0x70a0823100000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8",
    );
  });
});
