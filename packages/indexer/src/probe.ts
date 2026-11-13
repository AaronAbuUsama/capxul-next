import { AbiDecodingDataSizeTooSmallError, AbiDecodingZeroDataError, BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError,
  InternalRpcError, InvalidInputRpcError } from "viem";

const reverted = (text: unknown) => typeof text === "string" && /execution reverted|revert/i.test(text);

/** True when a call failed because the target does not implement it: it reverted, returned no data, or returned data that
 *  does not decode. Anything else (a transport error, a timeout, a lagging node, a provider error) is not an answer. */
export function notImplemented(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  if (error.walk((e) => e instanceof ContractFunctionZeroDataError || e instanceof AbiDecodingZeroDataError ||
    e instanceof AbiDecodingDataSizeTooSmallError)) return true;
  const revert = error.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
  if (revert) {
    // viem reads any JSON-RPC -32603 as a revert; a node's internal error with no revert data and no revert message is not one.
    const internal = revert.walk((e) => e instanceof InternalRpcError) as InternalRpcError | null;
    return !internal || revert.raw !== undefined || reverted(internal.details) || reverted(internal.shortMessage);
  }
  // geth-family nodes answer a data-less revert as -32000 "execution reverted", which viem leaves unconverted.
  const input = error.walk((e) => e instanceof InvalidInputRpcError) as InvalidInputRpcError | null;
  return !!input && reverted(input.details);
}

/** Whether `call` answers. A failure that is not `notImplemented` rethrows, so Ponder retries the event instead of storing
 *  a hat as human-ruled because its RPC failed. */
export async function answers(call: () => Promise<unknown>): Promise<boolean> {
  try { await call(); return true; } catch (error) {
    if (notImplemented(error)) return false;
    throw error;
  }
}
