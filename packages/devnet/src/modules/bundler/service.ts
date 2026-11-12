// Public door for the canary's supplied foreground process and typed send/lookup provider.
import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { entryPoint07Address as ENTRY_POINT_V07, entryPoint07Abi as ENTRY_POINT } from "viem/account-abstraction";
import { send } from "../chain/service.ts";
import type { BundlerKeys, PrepareBundler, SuppliedBundler } from "./types.ts";
import { httpTransport } from "./provider.ts";

export type * from "./types.ts";
export { bundlerProvider, httpTransport, ProviderError } from "./provider.ts";

/** A successful HTTP listen is not readiness: this process must serve the required EntryPoint. */
export async function probeBundler(url: string): Promise<void> {
  const supported = await httpTransport(url).request("eth_supportedEntryPoints", []);
  if (!Array.isArray(supported) || !supported.some(x => typeof x === "string" && x.toLowerCase() === ENTRY_POINT_V07.toLowerCase())) throw new Error("bundler does not support EntryPoint v0.7");
}

/** Dedicated public Anvil accounts, not company Directors, the relayer or maintenance signers. */
export function canaryBundlerKeys(): BundlerKeys {
  const key = (addressIndex: number): Hex => {
    const bytes = mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex }).getHdKey().privateKey;
    if (!bytes) throw new Error("public Anvil mnemonic has no private key");
    return `0x${Buffer.from(bytes).toString("hex")}`;
  };
  return { executorKey: key(9), utilityKey: key(10) };
}

function localRpc(url: string): void {
  const u = new URL(url);
  if (u.protocol !== "http:" || u.hostname !== "127.0.0.1" || u.username || u.password) throw new Error("canary bundler requires an unauthenticated loopback Anvil RPC");
}

/** Foundational creation only: persist the sponsor and chain state. Do not call during up/restore. */
export async function prepareBundler(x: PrepareBundler): Promise<BundlerKeys & { paymaster: Hex }> {
  localRpc(x.chain.rpcUrl);
  if (x.chain.chainId !== 84532) throw new Error("canary bundler requires seeded devnet chain 84532");
  if (!await x.chain.client.getCode({ address: ENTRY_POINT_V07 })) throw new Error("EntryPoint v0.7 is missing");
  const keys = canaryBundlerKeys();
  for (const key of [keys.executorKey, keys.utilityKey]) {
    const address = x.chain.walletFor(key).account.address;
    const balance = await x.chain.client.getBalance({ address });
    if (balance < 10n ** 19n) await send(x.chain, { from: x.fundingKey, to: address, data: "0x", value: 10n ** 19n - balance });
  }
  let paymaster = x.paymaster;
  if (!paymaster) {
    const hash = await x.chain.walletFor(x.fundingKey).deployContract({ ...x.paymasterArtifact, bytecode: x.paymasterArtifact.bytecode.object, args: [ENTRY_POINT_V07] });
    const receipt = await x.chain.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("mock paymaster deployment failed");
    paymaster = receipt.contractAddress;
  }
  const entryPoint = await x.chain.client.readContract({ address: paymaster, abi: parseAbi(["function entryPoint() view returns (address)"]), functionName: "entryPoint" });
  if (entryPoint.toLowerCase() !== ENTRY_POINT_V07.toLowerCase()) throw new Error("saved mock paymaster uses another EntryPoint");
  const deposit = await x.chain.client.readContract({ address: ENTRY_POINT_V07, abi: ENTRY_POINT, functionName: "balanceOf", args: [paymaster] });
  if (deposit < 10n ** 18n) await send(x.chain, { from: x.fundingKey, to: ENTRY_POINT_V07, value: 10n ** 18n - deposit, data: encodeFunctionData({ abi: ENTRY_POINT, functionName: "depositTo", args: [paymaster] }) });
  return { ...keys, paymaster };
}

/** The host owns lifetime; no daemon, shell, inherited .env, or signing keys in argv. */
export function suppliedAlto(x: BundlerKeys & { rpcUrl: string; port: number; paymaster: Hex; executable: string }): SuppliedBundler {
  localRpc(x.rpcUrl);
  if (!Number.isInteger(x.port) || x.port < 1 || x.port > 65535) throw new Error("invalid Alto port");
  return {
    argv: [x.executable], url: `http://127.0.0.1:${x.port}`, paymaster: x.paymaster,
    env: {
      DOTENV_CONFIG_PATH: "/dev/null", ALTO_HOST: "127.0.0.1", ALTO_PORT: String(x.port),
      ALTO_ENTRYPOINTS: ENTRY_POINT_V07, ALTO_RPC_URL: x.rpcUrl,
      ALTO_EXECUTOR_PRIVATE_KEYS: x.executorKey, ALTO_UTILITY_PRIVATE_KEY: x.utilityKey,
      ALTO_SAFE_MODE: "false", ALTO_ENABLE_DEBUG_ENDPOINTS: "false", ALTO_ENABLE_CORS: "false",
      ALTO_LOG_LEVEL: "info", ALTO_PUBLIC_CLIENT_LOG_LEVEL: "error", ALTO_WALLET_CLIENT_LOG_LEVEL: "error",
    },
  };
}
