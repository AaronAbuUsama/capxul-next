// The one port to a chain: a viem public client, and a wallet per key. A module takes a `Chain`; main.ts makes it.

import type { Account, Chain as ViemChain, Hex, PublicClient, Transport, WalletClient } from "viem";

export interface Chain {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly client: PublicClient;
  /** A wallet that sends from `key`. Public test keys only (see the test-keys module). */
  walletFor(key: Hex): WalletClient<Transport, ViemChain, Account>;
}

/** A transaction the devnet sends: where, what, and which key pays gas. */
export interface Send {
  readonly to: Hex;
  readonly data: Hex;
  readonly value?: bigint;
  readonly from: Hex;
}
