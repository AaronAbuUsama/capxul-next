import assert from "node:assert/strict";
import { test } from "node:test";

import { genesisOf, unionTouched } from "./service.ts";

const header = { number: 47893251n, timestamp: 0x6ac8f4e6n, gasLimit: 1_200_000_000n, baseFeePerGas: 5_000_000n, mixHash: `0x${"ab".repeat(32)}` as const, miner: "0x4200000000000000000000000000000000000011" as const };

test("the genesis head is the pinned block, on chain 84532, with contracts and funded test accounts", () => {
  const genesis = genesisOf(header, [{ address: "0x00000000000000000000000000000000000000AA", code: "0x6001", balance: 0n, nonce: 1, storage: { "0x01": "0x02" } }], 84532, ["0x00000000000000000000000000000000000000BB"]) as {
    number: string;
    config: { chainId: number };
    alloc: Record<string, { balance: string; code?: string; storage?: Record<string, string> }>;
  };
  assert.equal(BigInt(genesis.number), 47893251n);
  assert.equal(genesis.config.chainId, 84532);
  assert.equal(genesis.alloc["0x00000000000000000000000000000000000000aa"]?.code, "0x6001");
  assert.equal(Object.values(genesis.alloc["0x00000000000000000000000000000000000000aa"]?.storage ?? {})[0], `0x${"2".padStart(64, "0")}`);
  assert.equal(BigInt(genesis.alloc["0x00000000000000000000000000000000000000bb"]?.balance ?? "0x0"), 10_000n * 10n ** 18n);
});

test("touched sets merge by lowercase address and padded slot", () => {
  const merged = unionTouched(
    { addresses: ["0x00000000000000000000000000000000000000AA"], slots: { "0x00000000000000000000000000000000000000aa": ["0x01"] } },
    { addresses: ["0x00000000000000000000000000000000000000aa"], slots: { "0x00000000000000000000000000000000000000aa": [`0x${"1".padStart(64, "0")}`, "0x02"] } },
  );
  assert.equal(merged.addresses.length, 1);
  assert.equal(merged.slots["0x00000000000000000000000000000000000000aa"]?.length, 2);
});
