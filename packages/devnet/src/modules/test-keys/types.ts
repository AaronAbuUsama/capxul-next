import type { Hex } from "viem";

/** One of Anvil's ten published test accounts, by the part it plays here. */
export interface TestKey {
  readonly role: string;
  readonly key: Hex;
  readonly address: Hex;
}

export type Role =
  | "deployer"
  | "directorOne"
  | "directorTwo"
  | "tierService"
  | "founder"
  | "second"
  | "payee"
  | "stranger"
  | "agent";
