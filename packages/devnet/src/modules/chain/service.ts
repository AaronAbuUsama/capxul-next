import { createPublicClient, createWalletClient, defineChain, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { Chain, Send } from "./types.ts";

/** Connect to a node and read its chain id. Throws when nothing answers. */
export async function connect(rpcUrl: string): Promise<Chain> {
  const probe = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await probe.getChainId();
  const chain = defineChain({
    id: chainId,
    name: `devnet-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(rpcUrl), pollingInterval: 100 });
  return {
    rpcUrl,
    chainId,
    client,
    walletFor: (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(rpcUrl) }),
  };
}

/** Send one transaction and wait for it. A reverted transaction throws, naming its hash. */
export async function send(chain: Chain, tx: Send): Promise<Hex> {
  const wallet = chain.walletFor(tx.from);
  const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? 0n });
  const receipt = await chain.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transaction ${hash} to ${tx.to} reverted`);
  return hash;
}

export async function hasCode(chain: Chain, address: Hex): Promise<boolean> {
  const code = await chain.client.getCode({ address });
  return code !== undefined && code !== "0x";
}
