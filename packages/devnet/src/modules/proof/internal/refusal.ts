// Naming why a call would be refused: simulate it, and read the custom error or revert string it ends in.

import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Abi, type Hex } from "viem";

import type { Chain } from "../../chain/types.ts";

/** The error name (and arguments) a simulated call reverts with, or `undefined` when it would succeed. */
export async function refusalOf(
  chain: Chain,
  call: { readonly from: Hex; readonly to: Hex; readonly data: Hex },
  abi: Abi,
): Promise<string | undefined> {
  try {
    await chain.client.call({ account: call.from, to: call.to, data: call.data });
    return undefined;
  } catch (error) {
    if (!(error instanceof BaseError)) throw error;
    const data = revertData(error);
    if (data !== undefined) {
      try {
        const decoded = decodeErrorResult({ abi, data });
        return `${decoded.errorName}(${(decoded.args ?? []).map(String).join(", ")})`;
      } catch {
        // Not one of ours: a Safe's own "GS0xx" string, or an unknown error; fall through.
      }
    }
    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) return reverted.reason ?? reverted.shortMessage;
    return error.shortMessage;
  }
}

function revertData(error: BaseError): Hex | undefined {
  const found = error.walk((cause) => typeof (cause as { data?: unknown }).data === "string");
  const data = (found as { data?: unknown } | null)?.data;
  return typeof data === "string" && data.startsWith("0x") ? (data as Hex) : undefined;
}
