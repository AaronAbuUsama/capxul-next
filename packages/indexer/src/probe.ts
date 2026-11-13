import { AbiDecodingDataSizeTooSmallError, AbiDecodingZeroDataError, BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError } from "viem";

/** True when a call failed because the target does not implement it: it reverted, returned no data, or returned data that
 *  does not decode. Anything else (a transport error, a timeout, a lagging node, a provider error) is not an answer. */
export function notImplemented(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  return !!error.walk((e) => e instanceof ContractFunctionRevertedError || e instanceof ContractFunctionZeroDataError ||
    e instanceof AbiDecodingZeroDataError || e instanceof AbiDecodingDataSizeTooSmallError);
}

/** Whether `call` answers. A failure that is not `notImplemented` rethrows, so Ponder retries the event instead of storing
 *  a hat as human-ruled because its RPC failed. */
export async function answers(call: () => Promise<unknown>): Promise<boolean> {
  try { await call(); return true; } catch (error) {
    if (notImplemented(error)) return false;
    throw error;
  }
}
