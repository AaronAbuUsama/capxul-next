import type { Abi, Hex } from "viem";
import type { Chain } from "../chain/types.ts";

export type SuppliedBundler = { argv: string[]; url: string; env: Record<string, string>; paymaster: string };
export type BundlerKeys = { executorKey: Hex; utilityKey: Hex };
export type PrepareBundler = {
  chain: Chain;
  fundingKey: Hex;
  paymasterArtifact: { abi: Abi; bytecode: { object: Hex } };
  /** Saved in the world's deployment record and verified against its EntryPoint before reuse. */
  paymaster?: Hex;
};

/** ERC-4337 v0.7 JSON-RPC representation, not viem's bigint representation. */
export type RpcUserOperation = {
  sender: Hex; nonce: Hex; callData: Hex; signature: Hex;
  callGasLimit: Hex; verificationGasLimit: Hex; preVerificationGas: Hex;
  maxFeePerGas: Hex; maxPriorityFeePerGas: Hex;
  factory?: Hex; factoryData?: Hex;
  paymaster?: Hex; paymasterVerificationGasLimit?: Hex; paymasterPostOpGasLimit?: Hex; paymasterData?: Hex;
};
export type RpcTransport = { request(method: string, params: readonly unknown[]): Promise<unknown> };
export type UserOpReceipt = { userOpHash: Hex; success: boolean; receipt: { transactionHash: Hex } };
export type Lookup = { operation: RpcUserOperation | null; receipt: UserOpReceipt | null };
export type Bundler = {
  send(input: { operation: RpcUserOperation; entryPoint: Hex; expectedHash: Hex }): Promise<Hex>;
  lookup(hash: Hex): Promise<Lookup>;
};
export type ProviderCode = "PROVIDER_ERROR" | "PROVIDER_RESPONSE_INVALID" | "TRANSACTION_FAILED";
