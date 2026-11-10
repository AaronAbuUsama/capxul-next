// Anvil's ten published test keys (the mnemonic "test test ... junk"). Public test material: they hold no value on any
// real chain and anyone can sign with them. Never use one outside a local devnet.

import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

import type { Role, TestKey } from "./types.ts";

const KEYS: readonly [Role, Hex][] = [
  ["deployer", "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"],
  ["directorOne", "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"],
  ["directorTwo", "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"],
  ["tierService", "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"],
  ["founder", "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"],
  ["second", "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"],
  ["payee", "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e"],
  ["stranger", "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356"],
  ["agent", "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97"],
];

/** The key an account plays: Anvil's accounts 0 to 8 in order (the old config's Directors are accounts 0 to 2). */
export function testKey(role: Role): TestKey {
  const entry = KEYS.find(([name]) => name === role);
  if (entry === undefined) throw new Error(`no test key for ${role}`);
  return { role, key: entry[1], address: privateKeyToAccount(entry[1]).address };
}
