import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import * as Str from "effect/String";
import { concat, getContractAddress, isHex, pad } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import {
  BUNDLER_ACCOUNTS,
  BUNDLER_KEYS,
  CREATE2_DEPLOYER,
  ENTRY_POINT,
  TEST_PAYMASTER,
} from "../src/parts/bundler/Keys.ts";
import { TEST_USDC } from "../src/parts/chain/faucet.ts";

const creationCode = `0x${Str.trim(readFileSync(`${import.meta.dirname}/../src/parts/bundler/test-paymaster.hex`, "utf8"))}`;

describe("the bundler's addresses", () => {
  test("the test paymaster's address is where CREATE2 puts test-paymaster.hex with the EntryPoint", () => {
    const address = getContractAddress({
      opcode: "CREATE2",
      from: CREATE2_DEPLOYER,
      salt: pad("0x00"),
      bytecode: concat([isHex(creationCode) ? creationCode : "0x", pad(ENTRY_POINT)]),
    });
    assert.strictEqual(address, TEST_PAYMASTER);
  });
  test("the paymaster is not where the faucet puts the test USDC", () => {
    assert.notStrictEqual(Str.toLowerCase(TEST_PAYMASTER), Str.toLowerCase(TEST_USDC));
  });
  test("each bundler account is the address of its key", () => {
    assert.strictEqual(privateKeyToAddress(BUNDLER_KEYS.executor), BUNDLER_ACCOUNTS.executor);
    assert.strictEqual(privateKeyToAddress(BUNDLER_KEYS.utility), BUNDLER_ACCOUNTS.utility);
  });
  test("the bundler's keys are Anvil's public test accounts 9 and 10", () => {
    assert.strictEqual(BUNDLER_ACCOUNTS.executor, "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720");
    assert.strictEqual(BUNDLER_ACCOUNTS.utility, "0xBcd4042DE499D14e55001CcbB24a551F3b954096");
  });
});
