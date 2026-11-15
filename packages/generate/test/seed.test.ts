// The seed's pure parts: planning, the Safe transactions, the fixed fees and times, the record and the checksums. The
// committed seed (`state/core.json`, `deployments/devnet.json`) is the reference wherever a fact can be checked
// against it without a chain.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Result from "effect/Result";
import * as Str from "effect/String";
import { concat, getContractAddress, recoverAddress, size, slice, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import {
  createHouseData,
  houseInitializer,
  houseRoles,
  planEntries,
  saltOf,
  type Compiled,
  type Entry,
  type HouseConfig,
  type Planned,
} from "../src/seed/plan.ts";
import { checksums, deploymentRecord } from "../src/seed/record.ts";
import { execData, joinSignatures, multiSendData, packCall, safeTxHash } from "../src/seed/safe.ts";
import { BATCH, BLOCK_TIMES, deploySteps, maxFeePerGas, type Step } from "../src/seed/steps.ts";
import { CHAIN_ID, RECORD, SEED, SEED_INPUTS, TEST_MNEMONIC } from "../src/sources.ts";

const root = `${import.meta.dirname}/../../..`;
const json = (path: string) => JSON.parse(readFileSync(`${root}/${path}`, "utf8"));
const config: HouseConfig = json(SEED_INPUTS.house);
const record: {
  companiesHouse: Hex;
  companiesHouseRoles: Hex;
  createCall: Hex;
  contracts: Record<string, { address: Hex; salt: Hex }>;
} = json(RECORD);
const manifest: { contracts: Array<Entry> } = json(SEED_INPUTS.manifest);
const seed: {
  blocks: Array<{
    header: { timestamp: Hex; baseFeePerGas: Hex };
    transactions: Array<{ transaction: { to: Hex; input: Hex; maxFeePerGas: Hex } }>;
  }>;
} = json(SEED);
const sent = Arr.flatMap(seed.blocks, (block) => Arr.map(block.transactions, (entry) => entry.transaction));

/** The committed record's contracts as planned entries (their init code is not needed for the steps after creation). */
const committed: ReadonlyArray<Planned> = Arr.map(Rec.toEntries(record.contracts), ([name, contract]) => ({
  name,
  salt: contract.salt,
  address: contract.address,
  initCode: "0x",
  arguments: {},
}));
const steps = (): ReadonlyArray<Step> =>
  Result.getOrThrow(deploySteps(config, houseInitializer(config), record.companiesHouse, committed));

test("each manifest salt is keccak256 of capxul:v4:<Name>", () => {
  for (const entry of manifest.contracts) assert.equal(entry.salt, saltOf(entry.name), entry.name);
});

test("Companies House's Directors are set up in address order, however they are listed", () => {
  assert.equal(houseInitializer(config), houseInitializer({ ...config, owners: Arr.reverse(config.owners) }));
});

test("the Roles module lands where the committed record says", () => {
  assert.equal(houseRoles(record.companiesHouse).address, record.companiesHouseRoles);
});

/** "A" takes nothing; "B" takes a tuple holding an address and a number, and an address. */
const compiledAB = (entry: Entry): Option.Option<Compiled> =>
  Option.some(
    entry.name === "A"
      ? { creation: "0x60", inputs: [] }
      : {
          creation: "0x61",
          inputs: [
            {
              name: "pair",
              type: "tuple",
              components: [
                { name: "a", type: "address" },
                { name: "n", type: "uint256" },
              ],
            },
            { name: "owner", type: "address" },
          ],
        },
  );

test("an entry lands at CREATE2 from the house over its init code, and later entries name it with $Name", () => {
  const house: Hex = "0x00000000000000000000000000000000000000aa";
  const entries: ReadonlyArray<Entry> = [
    { name: "A", source: "a/A.sol", salt: saltOf("A"), constructorArguments: {} },
    {
      name: "B",
      source: "b/B.sol",
      salt: saltOf("B"),
      constructorArguments: { pair: { a: "$A", n: 7 }, owner: "$companiesHouse" },
    },
  ];
  const [a, b] = Result.getOrThrow(planEntries(house, entries, compiledAB));
  assert.ok(a !== undefined && b !== undefined);
  assert.equal(a.address, getContractAddress({ opcode: "CREATE2", from: house, salt: saltOf("A"), bytecode: "0x60" }));
  assert.deepEqual(b.arguments, { pair: { a: a.address, n: 7n }, owner: house });
  assert.equal(size(b.initCode), 1 + 32 * 3);
});

test("planning fails naming the entry when a salt, an argument or a reference is wrong", () => {
  const house: Hex = "0x00000000000000000000000000000000000000aa";
  const one = (entry: Entry, inputs: Compiled["inputs"]) =>
    Result.getFailure(planEntries(house, [entry], () => Option.some({ creation: "0x60", inputs })));
  const base = { name: "C", source: "C.sol", salt: saltOf("C"), constructorArguments: {} };
  assert.match(Option.getOrThrow(one({ ...base, salt: saltOf("D") }, [])), /C: its salt/);
  assert.match(Option.getOrThrow(one({ ...base, constructorArguments: { x: "1" } }, [])), /C's constructor has no x/);
  assert.match(Option.getOrThrow(one(base, [{ name: "y", type: "address" }])), /C needs constructor argument y/);
  assert.match(
    Option.getOrThrow(one({ ...base, constructorArguments: { y: "$Nope" } }, [{ name: "y", type: "address" }])),
    /\$Nope names neither/,
  );
});

test("the steps are the committed seed's eight transactions, the Safe ones four entries to a batch", () => {
  const all = steps();
  assert.equal(all.length, 2 + Math.ceil(committed.length / BATCH) + 2);
  assert.equal(all.length, sent.length);
  assert.deepEqual(
    Arr.map(all, (step) => Str.toLowerCase(step._tag === "Call" ? step.to : step.safe)),
    Arr.map(sent, (tx) => tx.to),
  );
  const [house, roles] = all;
  assert.ok(house?._tag === "Call" && roles?._tag === "Call");
  assert.equal(house.data, createHouseData(houseInitializer(config)));
  assert.equal(house.data, sent[0]?.input);
  assert.equal(roles.data, sent[1]?.input);
});

test("the wiring and setup Safe transactions, signed by Directors 0 and 1, are the committed ones byte for byte", async () => {
  const signers = Arr.map([0, 1], (index) => mnemonicToAccount(TEST_MNEMONIC, { addressIndex: index }));
  for (const index of [6, 7]) {
    const step = steps()[index];
    assert.ok(step?._tag === "Safe");
    const hash = safeTxHash(CHAIN_ID, step.safe, step.call, step.nonce);
    const signed = await Promise.all(
      Arr.map(signers, async (signer) => ({ owner: signer.address, signature: await signer.sign({ hash }) })),
    );
    const signatures = joinSignatures(signed);
    assert.equal(execData(step.call, signatures), sent[index]?.input);
    assert.equal(
      await recoverAddress({ hash, signature: slice(signatures, 0, 65) }),
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    );
  }
});

test("a MultiSend batch is each call packed, in order", () => {
  const calls = [
    { to: "0x0000000000000000000000000000000000000001", data: "0xaa" },
    { to: "0x0000000000000000000000000000000000000002", data: "0xbbcc", operation: 1 },
  ] as const;
  assert.equal(size(packCall(calls[0])), 1 + 20 + 32 + 32 + 1);
  assert.ok(Str.includes(Str.slice(2)(concat(Arr.map(calls, packCall))))(multiSendData(calls)));
});

test("each block's fee cap and time are the committed ones", () => {
  const [pin, ...blocks] = seed.blocks;
  assert.ok(pin !== undefined);
  assert.equal(blocks.length, BLOCK_TIMES.length);
  for (const [index, block] of blocks.entries()) {
    const tx = block.transactions[0]?.transaction;
    assert.equal(maxFeePerGas(BigInt(block.header.baseFeePerGas)), BigInt(tx?.maxFeePerGas ?? 0), `block ${index}`);
    assert.equal(Number(block.header.timestamp) - Number(pin.header.timestamp), BLOCK_TIMES[index], `block ${index}`);
  }
});

test("the record holds each entry in manifest order with its code hash, and the checksums are shasum's lines", () => {
  const made = deploymentRecord({
    chainId: CHAIN_ID,
    house: record.companiesHouse,
    roles: record.companiesHouseRoles,
    config,
    planned: committed,
    codeHash: (address) => `0x${Str.slice(2, 6)(address)}`,
  });
  assert.deepEqual(Rec.keys(made.contracts), Rec.keys(record.contracts));
  assert.equal(
    made.contracts["Payments"]?.runtimeCodeHash,
    `0x${Str.slice(2, 6)(record.contracts["Payments"]?.address ?? "")}`,
  );
  assert.equal(made.createCall, record.createCall);
  assert.equal(
    checksums([
      { name: "a.json", sha256: "01" },
      { name: "b.json", sha256: "02" },
    ]),
    "01  a.json\n02  b.json\n",
  );
});
