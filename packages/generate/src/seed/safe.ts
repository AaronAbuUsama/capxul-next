// Safe transactions as the seed sends them: the EIP-712 hash each owner signs (computed here, not read from the Safe),
// the signatures in ascending owner order, `execTransaction`'s calldata, and MultiSend's packing. Pure.
import * as Arr from "effect/Array";
import { concat, encodeFunctionData, encodePacked, hashTypedData, parseAbi, size, type Hex } from "viem";

export const CALL = 0;
export const DELEGATECALL = 1;

/** One call a Safe makes. */
export interface SafeCall {
  readonly to: Hex;
  readonly data: Hex;
  readonly operation?: typeof CALL | typeof DELEGATECALL;
}

const SAFE_ABI = parseAbi([
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
]);
const MULTI_SEND_ABI = parseAbi(["function multiSend(bytes transactions)"]);
const ZERO: Hex = "0x0000000000000000000000000000000000000000";

/** One MultiSend entry, packed as the MultiSend contracts read it. */
export const packCall = (call: SafeCall): Hex =>
  encodePacked(
    ["uint8", "address", "uint256", "uint256", "bytes"],
    [call.operation ?? CALL, call.to, 0n, BigInt(size(call.data)), call.data],
  );

/** The calldata that makes a Safe run `calls` in order, through MultiSend (which the Safe delegatecalls). */
export const multiSendData = (calls: ReadonlyArray<SafeCall>): Hex =>
  encodeFunctionData({ abi: MULTI_SEND_ABI, functionName: "multiSend", args: [concat(Arr.map(calls, packCall))] });

/** The hash a Safe's owners sign for `call` at `nonce`: Safe's EIP-712 `SafeTx`, with no refund and no gas price. */
export const safeTxHash = (chainId: number, safe: Hex, call: SafeCall, nonce: bigint): Hex =>
  hashTypedData({
    domain: { chainId, verifyingContract: safe },
    types: {
      SafeTx: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "operation", type: "uint8" },
        { name: "safeTxGas", type: "uint256" },
        { name: "baseGas", type: "uint256" },
        { name: "gasPrice", type: "uint256" },
        { name: "gasToken", type: "address" },
        { name: "refundReceiver", type: "address" },
        { name: "nonce", type: "uint256" },
      ],
    },
    primaryType: "SafeTx",
    message: {
      to: call.to,
      value: 0n,
      data: call.data,
      operation: call.operation ?? CALL,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: ZERO,
      refundReceiver: ZERO,
      nonce,
    },
  });

/** Each owner's signature over the hash, joined in ascending owner address order, as Safe requires. */
export const joinSignatures = (signed: ReadonlyArray<{ readonly owner: Hex; readonly signature: Hex }>): Hex =>
  concat(
    Arr.map(
      Arr.sort(signed, (a: { readonly owner: Hex }, b: { readonly owner: Hex }) =>
        BigInt(a.owner) < BigInt(b.owner) ? -1 : BigInt(a.owner) > BigInt(b.owner) ? 1 : 0,
      ),
      (entry) => entry.signature,
    ),
  );

/** `execTransaction`'s calldata for `call` under `signatures`. */
export const execData = (call: SafeCall, signatures: Hex): Hex =>
  encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "execTransaction",
    args: [call.to, 0n, call.data, call.operation ?? CALL, 0n, 0n, 0n, ZERO, ZERO, signatures],
  });
