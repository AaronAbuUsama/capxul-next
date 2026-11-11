import type { Hex } from "viem";

/** Contract state at the pinned block: code, balance, nonce and the storage slots that were touched. */
export interface PinnedAccount {
  readonly address: Hex;
  readonly code: Hex;
  readonly balance: bigint;
  readonly nonce: number;
  readonly storage: Readonly<Record<Hex, Hex>>;
}

/** The pinned block's header fields a genesis must repeat, so the fork tests see the same block. */
export interface PinnedBlock {
  readonly number: bigint;
  readonly timestamp: bigint;
  readonly gasLimit: bigint;
  readonly baseFeePerGas: bigint;
  readonly mixHash: Hex;
  readonly miner: Hex;
}

/** Which accounts and slots to read: the places the tests and the deployment were seen touching. */
export interface Touched {
  readonly addresses: readonly Hex[];
  readonly slots: Readonly<Record<string, readonly Hex[]>>;
}
