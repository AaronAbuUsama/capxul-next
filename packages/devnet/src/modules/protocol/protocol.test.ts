import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { localPrivateKeySigner } from "@capxul/sdk";
import { decodeFunctionData, getContractAddress, keccak256, parseAbi, recoverAddress } from "viem";

import { testKey } from "../test-keys/service.ts";
import { planEntries } from "./internal/manifest.ts";
import { claimRoleKey, houseInitializer, safeProxyAddress } from "./internal/companies-house.ts";
import { multiSendData, sortedSignatures } from "./internal/safe.ts";
import { parseManifest, saltOf } from "./service.ts";

const manifestPath = join(import.meta.dirname, "..", "..", "..", "..", "contracts", "deploy", "manifest.json");
const devnetPath = join(import.meta.dirname, "..", "..", "..", "..", "contracts", "deploy", "devnet.json");

test("the real manifest parses: fifteen contracts, each salted by its name", () => {
  const manifest = parseManifest(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.contracts.length, 15);
  for (const entry of manifest.contracts) assert.equal(entry.salt, saltOf(entry.name));
});

test("a manifest with a wrong salt is refused", () => {
  const text = JSON.stringify({ version: "v4", contracts: [{ name: "A", source: "A.sol", salt: "0x01" }] });
  assert.throws(() => parseManifest(text), /salt/);
});

test("planning puts an entry at CREATE2 from the house over its init code, and resolves $references", () => {
  const house = "0x38d9772b87a52Ed4615E2c804414f0cDD4854F2F";
  const artifact = (abiInputs: unknown[]) => ({
    abi: [{ type: "constructor", inputs: abiInputs }],
    bytecode: { object: "0x6000" },
    deployedBytecode: { object: "0x00", immutableReferences: {} },
  });
  const manifest = parseManifest(
    JSON.stringify({
      version: "v4",
      contracts: [
        { name: "First", source: "x/First.sol" },
        { name: "Second", source: "x/Second.sol", constructorArguments: { first_: "$First", owner_: "$companiesHouse" } },
      ],
    }),
  );
  const planned = planEntries(house, manifest, {
    "First.sol/First": artifact([]),
    "Second.sol/Second": artifact([
      { name: "first_", type: "address" },
      { name: "owner_", type: "address" },
    ]),
  });
  const [first, second] = planned;
  assert.ok(first && second);
  assert.equal(first.address, getContractAddress({ opcode: "CREATE2", from: house, salt: saltOf("First"), bytecode: "0x6000" }));
  assert.equal(second.resolvedArguments.first_, first.address);
  assert.equal(second.resolvedArguments.owner_, house);
});

test("Companies House keeps the address the old tool derived for the devnet Directors", () => {
  // The Safe 1.5.0 proxy creation code is read from the chain in a deployment; here the same code, so the address is checked offline.
  const config = JSON.parse(readFileSync(devnetPath, "utf8"));
  const proxyCreationCode = keccak256("0x") && SAFE_150_PROXY_CREATION_CODE;
  const house = safeProxyAddress(proxyCreationCode, houseInitializer(config), BigInt(keccak256(new TextEncoder().encode("capxul:companies-house:v1") as never)));
  assert.equal(house.toLowerCase(), "0x38d9772b87a52ed4615e2c804414f0cdd4854f2f");
});

test("a role key is the tier's name right-padded to 32 bytes, as Solidity writes bytes32(\"...\")", () => {
  assert.equal(claimRoleKey("devnet"), "0x63617078756c2e636c61696d2e6465766e657400000000000000000000000000");
});

test("a MultiSend batch packs each call and unpacks to the same calls", () => {
  const data = multiSendData([{ to: "0x0000000000000000000000000000000000000001", data: "0xdeadbeef" }]);
  const { args } = decodeFunctionData({ abi: parseAbi(["function multiSend(bytes transactions)"]), data });
  // operation(1) + to(20) + value(32) + length(32) + data(4)
  assert.equal(((args?.[0] as string).length - 2) / 2, 1 + 20 + 32 + 32 + 4);
});

test("signatures go in ascending signer address order, whatever order the signers are given", async () => {
  const hash = keccak256("0x1234");
  const signers = ["directorOne", "deployer", "directorTwo"].map((role) => localPrivateKeySigner({ privateKey: testKey(role as "deployer").key }));
  const joined = await sortedSignatures(hash, signers);
  const recovered: bigint[] = [];
  for (let at = 2; at < joined.length; at += 130) {
    const signature = `0x${joined.slice(at, at + 130)}` as const;
    recovered.push(BigInt(await recoverAddress({ hash, signature })));
  }
  assert.deepEqual([...recovered].sort((a, b) => (a < b ? -1 : 1)), recovered);
  assert.equal(recovered.length, 3);
});

// Safe v1.5.0's SafeProxyFactory.proxyCreationCode(), as the factory holds it (the same constant AgentOwner embeds).
const SAFE_150_PROXY_CREATION_CODE = `0x${readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "contracts", "src", "agents", "AgentOwner.sol"), "utf8").match(/hex"([0-9a-f]+)"/)?.[1] ?? ""}` as const;
