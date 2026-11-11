// The seeded chain state. The fork tests and the deployment need a few dozen third-party contracts (Safe, Hats, Roles,
// ...) as they were at one block of Base Sepolia. Run once with the network, a recording says which accounts and slots
// were touched; this module reads exactly those at the pinned block and writes an Anvil genesis whose head is that block,
// so a node started from it answers the fork tests' `createSelectFork(url, block)` with no network at all.

import { toHex, type Hex } from "viem";

import type { Chain } from "../chain/types.ts";
import type { PinnedAccount, PinnedBlock, Touched } from "./types.ts";

export type * from "./types.ts";

/** Read each touched contract (an account with code at the block) and its touched non-zero slots, at `block`. */
export async function readPinned(chain: Chain, block: bigint, touched: Touched): Promise<{ header: PinnedBlock; accounts: PinnedAccount[] }> {
  const raw = await chain.client.getBlock({ blockNumber: block });
  const header: PinnedBlock = {
    number: raw.number,
    timestamp: raw.timestamp,
    gasLimit: raw.gasLimit,
    baseFeePerGas: raw.baseFeePerGas ?? 0n,
    mixHash: raw.mixHash,
    miner: raw.miner,
  };
  const accounts: PinnedAccount[] = [];
  for (const address of touched.addresses) {
    const code = await chain.client.getCode({ address, blockNumber: block });
    // An EIP-7702 delegation (0xef0100...) is an EOA that someone pointed at code on the live chain: Anvil's public test keys are
    // delegated there. They are not contracts the tests use, and a local test account must be a plain EOA, so they are skipped.
    if (code === undefined || code === "0x" || code.startsWith("0xef01")) continue;
    const [balance, nonce] = await Promise.all([
      chain.client.getBalance({ address, blockNumber: block }),
      chain.client.getTransactionCount({ address, blockNumber: block }),
    ]);
    const storage: Record<Hex, Hex> = {};
    for (const slot of touched.slots[address.toLowerCase()] ?? []) {
      const value = await chain.client.getStorageAt({ address, slot, blockNumber: block });
      if (value !== undefined && BigInt(value) !== 0n) storage[slot] = value;
    }
    accounts.push({ address, code, balance, nonce, storage });
  }
  return { header, accounts };
}

const word = (hex: Hex): Hex => `0x${hex.slice(2).padStart(64, "0")}`;

/** An Anvil `--init` genesis whose head is the pinned block, holding the accounts. Chain id 84532. */
export function genesisOf(header: PinnedBlock, accounts: readonly PinnedAccount[], chainId: number, funded: readonly Hex[] = []): unknown {
  return {
    config: {
      chainId,
      homesteadBlock: 0, eip150Block: 0, eip155Block: 0, eip158Block: 0, byzantiumBlock: 0, constantinopleBlock: 0,
      petersburgBlock: 0, istanbulBlock: 0, berlinBlock: 0, londonBlock: 0, shanghaiTime: 0, cancunTime: 0,
    },
    nonce: "0x0",
    timestamp: toHex(header.timestamp),
    extraData: "0x",
    gasLimit: toHex(header.gasLimit),
    difficulty: "0x0",
    mixHash: header.mixHash,
    coinbase: header.miner,
    number: toHex(header.number),
    baseFeePerGas: toHex(header.baseFeePerGas),
    alloc: Object.fromEntries([
      // `--init` does not fund Anvil's dev accounts as a plain start does, so the test accounts are funded here: 10,000 ETH each.
      ...funded.map((address) => [address.toLowerCase(), { balance: toHex(10_000n * 10n ** 18n) }] as const),
      ...[...accounts]
        .sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1))
        .map((account) => [
          account.address.toLowerCase(),
          {
            balance: toHex(account.balance),
            nonce: toHex(account.nonce),
            code: account.code,
            storage: Object.fromEntries(Object.entries(account.storage).sort().map(([slot, value]) => [word(slot as Hex), word(value)])),
          },
        ]),
    ]),
  };
}

/** Merge touched sets from several recordings (the forge fork cache, an Anvil fork's state dump). */
export function unionTouched(...sets: readonly Touched[]): Touched {
  const addresses = new Map<string, Hex>();
  const slots = new Map<string, Set<Hex>>();
  for (const set of sets) {
    for (const address of set.addresses) addresses.set(address.toLowerCase(), address);
    for (const [address, list] of Object.entries(set.slots)) {
      const bucket = slots.get(address.toLowerCase()) ?? new Set<Hex>();
      for (const slot of list) bucket.add(word(slot));
      slots.set(address.toLowerCase(), bucket);
    }
  }
  return { addresses: [...addresses.values()], slots: Object.fromEntries([...slots].map(([address, set]) => [address, [...set]])) };
}

/** The touched set in a forge RPC cache (`~/.foundry/cache/rpc/<chain>/<block>`, zstd-decompressed JSON). */
export function touchedFromForgeCache(cache: unknown): Touched {
  const data = cache as { accounts?: Record<string, unknown>; storage?: Record<string, Record<string, unknown>> };
  return {
    addresses: Object.keys(data.accounts ?? {}) as Hex[],
    slots: Object.fromEntries(Object.entries(data.storage ?? {}).map(([address, slotMap]) => [address.toLowerCase(), Object.keys(slotMap) as Hex[]])),
  };
}

/** The touched set in an Anvil state dump (`anvil_dumpState`, decoded): every account it holds and every slot of each. */
export function touchedFromAnvilDump(dump: unknown): Touched {
  const accounts = (dump as { accounts?: Record<string, { storage?: Record<string, unknown> }> }).accounts ?? {};
  return {
    addresses: Object.keys(accounts) as Hex[],
    slots: Object.fromEntries(Object.entries(accounts).map(([address, account]) => [address.toLowerCase(), Object.keys(account.storage ?? {}) as Hex[]])),
  };
}
