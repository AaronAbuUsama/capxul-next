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

export type { Bundler, Lookup, ProviderCode, RpcTransport, RpcUserOperation, UserOpReceipt } from "../../../../backend/src/shared/bundler.ts";
