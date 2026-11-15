// The platform's facts about every world's chain and the calls it sends there. The addresses and the seed's last
// block are checked against packages/contracts' own records; each call's data against what Foundry's `cast
// calldata` gives for the same call (the expected hex below was made with it, cast 1.9.0).
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import * as Arr from "effect/Array";
import * as Str from "effect/String";
import { callData } from "../src/parts/chain/abi.ts";
import { CLAIMS, CONTRACTS, SEED_HEAD, SETUP_ROOM_SECONDS } from "../src/parts/chain/contracts.ts";
import { CAST, emailOf } from "../src/things/world/cast.ts";

const contracts = `${import.meta.dirname}/../../contracts/`;
const read = (path: string) => JSON.parse(readFileSync(`${contracts}${path}`, "utf8"));

describe("every world's chain", () => {
  test("the addresses are packages/contracts' deployment record's", () => {
    const record = read("deployments/devnet.json");
    assert.equal(CONTRACTS.payments, record.contracts.Payments.address);
    assert.equal(CONTRACTS.budgets, record.contracts.Budgets.address);
    assert.equal(CONTRACTS.companySafeMinter, record.contracts.CompanySafeMinter.address);
    assert.equal(CONTRACTS.companiesHouse, record.companiesHouse);
    assert.equal(CONTRACTS.hats, record.contracts.Budgets.constructorArguments["hats_"]);
    assert.equal(CLAIMS.claimer, record.contracts.CompaniesHouseClaimer.address);
    assert.equal(CLAIMS.roles, record.companiesHouseRoles);
    assert.equal(CONTRACTS.companyNamespace, record.tiers[0].companyNamespace);
    assert.equal(CLAIMS.namespace, record.tiers[0].namespace);
    assert.equal(CLAIMS.service, read("deploy/devnet.json").tiers[0].member);
  });
  test("the seed's last block is the seed's own", () => {
    const seed = read("state/core.json");
    assert.equal(SEED_HEAD.number, Number(seed.block.number));
    assert.equal(SEED_HEAD.timestamp, Number(seed.block.timestamp));
    assert.ok(SETUP_ROOM_SECONDS > 0);
  });
  test("the cast's signers are distinct and clear of the service and the faucet's operator", () => {
    const signers = Arr.map(CAST, (person) => Str.toLowerCase(person.signer));
    assert.equal(new Set(signers).size, 5);
    assert.ok(!Arr.contains(signers, Str.toLowerCase(CLAIMS.service)));
    assert.deepEqual(
      Arr.map(
        Arr.filter(CAST, (person) => !person.claimed),
        (person) => person.person,
      ),
      ["pat"],
    );
  });
});

describe("the calls the platform sends", () => {
  const inner = callData("0x5cc2f461", [
    { string: CLAIMS.namespace },
    { string: emailOf("dana") },
    { address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" },
  ]);
  test("claim(string,string,address)", () => {
    assert.equal(
      inner,
      "0x5cc2f461000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000015d34aaf54267db7d7c367839aaf71a00a2c6a65000000000000000000000000000000000000000000000000000000000000001663617078756c3a6465766e65743a656d61696c3a763100000000000000000000000000000000000000000000000000000000000000000000000000000000000e64616e6140636173742e74657374000000000000000000000000000000000000",
    );
  });
  test("execTransactionWithRole(address,uint256,bytes,uint8,bytes32,bool), with the claim inside", () => {
    const outer = callData("0xc6fe8747", [
      { address: CLAIMS.claimer },
      { uint: 0n },
      { bytes: inner },
      { uint: 1n },
      { bytes32: CLAIMS.role },
      { bool: true },
    ]);
    assert.equal(
      outer,
      "0xc6fe87470000000000000000000000004244eff941473b8f839a0f23ad1eba650b37426e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000000163617078756c2e636c61696d2e6465766e657400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000e45cc2f461000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000015d34aaf54267db7d7c367839aaf71a00a2c6a65000000000000000000000000000000000000000000000000000000000000001663617078756c3a6465766e65743a656d61696c3a763100000000000000000000000000000000000000000000000000000000000000000000000000000000000e64616e6140636173742e7465737400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    );
  });
  test("safeAddressFor(address,string,string)", () => {
    const data = callData("0xcd9ad772", [
      { address: CONTRACTS.companiesHouse },
      { string: CLAIMS.namespace },
      { string: emailOf("dana") },
    ]);
    assert.equal(
      data,
      "0xcd9ad77200000000000000000000000038d9772b87a52ed4615e2c804414f0cdd4854f2f000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000001663617078756c3a6465766e65743a656d61696c3a763100000000000000000000000000000000000000000000000000000000000000000000000000000000000e64616e6140636173742e74657374000000000000000000000000000000000000",
    );
  });
});
