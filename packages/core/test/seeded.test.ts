// The seed's addresses Core's chain operations use (src/chain/seeded.ts) are the contracts' own deployment record's
// (packages/contracts/deployments/devnet.json). The world's own (the EntryPoint, the test paymaster, the test USDC)
// are copied from packages/world, which Core cannot import: the world imports Core.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SEEDED, TIER } from "../src/chain/seeded.ts";
import { sameAddress } from "../src/chain/hex.ts";
import { RELAYER } from "../src/chain/safe.ts";

const record = JSON.parse(readFileSync(`${import.meta.dirname}/../../contracts/deployments/devnet.json`, "utf8"));
const same = (a: string, b: string) => assert.ok(sameAddress(a, b), `${a} is not ${b}`);

test("the v4 contracts and Companies House are where the deployment record puts them", () => {
  same(SEEDED.companiesHouse, record.companiesHouse);
  same(SEEDED.companiesHouseRoles, record.companiesHouseRoles);
  for (const [name, key] of [
    ["CompaniesHouseClaimer", "claimer"],
    ["CompanySafeMinter", "companySafeMinter"],
    ["Installer", "installer"],
    ["Payments", "payments"],
    ["Budgets", "budgets"],
  ] as const)
    same(SEEDED[key], record.contracts[name].address);
  same(SEEDED.hats, record.contracts.Budgets.constructorArguments["hats_"]);
  assert.equal(TIER.personalNamespace, record.tiers[0].namespace);
  assert.equal(TIER.companyNamespace, record.tiers[0].companyNamespace);
});

test("the relayer is one fixed address in every world", () => {
  assert.match(RELAYER, /^0x[0-9a-fA-F]{40}$/);
});
