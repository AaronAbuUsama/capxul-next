// bun test src
import { describe, expect, test } from "bun:test";
import { balanceOfCall, constructorArguments, mintCall } from "./faucet.ts";

const words = (hex: string) => hex.match(/.{64}/g) ?? [];

describe("the faucet's calldata", () => {
  test("the token's constructor arguments are (string, string, uint8), ABI-encoded", () => {
    expect(words(constructorArguments("World test USD", "USDC", 6))).toEqual([
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
    expect(encoded[1]).toBe("00000000000000000000000000000000000000000000000000000000000000c0");
    expect(encoded.length).toBe(8);
  });
  test("mint(address,uint256) carries the address and the amount", () => {
    expect(mintCall({ to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", amount: 250_000_000n })).toBe(
      "0x40c10f1900000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8000000000000000000000000000000000000000000000000000000000ee6b280",
    );
  });
  test("balanceOf(address) carries the address", () => {
    expect(balanceOfCall("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")).toBe(
      "0x70a0823100000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8",
    );
  });
});
