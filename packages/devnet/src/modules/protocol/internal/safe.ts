// Safe transactions signed by keys: the hash is read from the Safe, each owner's signer signs it raw, the signatures go
// in ascending owner order, and anyone sends it. Plus MultiSend packing.

import type { CapxulSigner } from "@capxul/sdk";
import { concat, encodeFunctionData, encodePacked, parseAbi, type Hex } from "viem";

import { send } from "../../chain/service.ts";
import type { Chain } from "../../chain/types.ts";

export const SAFE_ABI = parseAbi([
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
  "function nonce() view returns (uint256)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function isModuleEnabled(address module) view returns (bool)",
  "function enableModule(address module)",
  "function approveHash(bytes32 hashToApprove)",
]);

const MULTI_SEND_ABI = parseAbi(["function multiSend(bytes transactions)"]);

export const CALL = 0;
export const DELEGATECALL = 1;

export interface SafeCall {
  readonly to: Hex;
  readonly data: Hex;
  readonly value?: bigint;
  readonly operation?: 0 | 1;
}

/** One MultiSend entry, packed as the MultiSend contracts read it. */
export function packCall(call: SafeCall): Hex {
  return encodePacked(
    ["uint8", "address", "uint256", "uint256", "bytes"],
    [call.operation ?? CALL, call.to, call.value ?? 0n, BigInt((call.data.length - 2) / 2), call.data],
  );
}

/** The calldata that makes a Safe run `calls` in order through a MultiSend contract (delegatecalled by the Safe). */
export function multiSendData(calls: readonly SafeCall[]): Hex {
  return encodeFunctionData({ abi: MULTI_SEND_ABI, functionName: "multiSend", args: [concat(calls.map(packCall))] });
}

/** The hash `signer`s must sign for `call` at the Safe's current nonce. */
export async function safeTxHash(chain: Chain, safe: Hex, call: SafeCall): Promise<Hex> {
  const nonce = await chain.client.readContract({ address: safe, abi: SAFE_ABI, functionName: "nonce" });
  return chain.client.readContract({
    address: safe,
    abi: SAFE_ABI,
    functionName: "getTransactionHash",
    args: [call.to, call.value ?? 0n, call.data, call.operation ?? CALL, 0n, 0n, 0n, ZERO, ZERO, nonce],
  });
}

const ZERO: Hex = "0x0000000000000000000000000000000000000000";

/** Signatures over `hash`, one per signer, in ascending address order as Safe requires. */
export async function sortedSignatures(hash: Hex, signers: readonly CapxulSigner[]): Promise<Hex> {
  const signed = await Promise.all(
    signers.map(async (signer) => ({ address: BigInt(await signer.getAddress()), signature: await signer.signUserOpHash(hash) })),
  );
  return concat(signed.sort((a, b) => (a.address < b.address ? -1 : 1)).map((entry) => entry.signature));
}

/** The calldata of `execTransaction` for `call` under `signatures`. */
export function execData(call: SafeCall, signatures: Hex): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "execTransaction",
    args: [call.to, call.value ?? 0n, call.data, call.operation ?? CALL, 0n, 0n, 0n, ZERO, ZERO, signatures],
  });
}

/** The `execTransaction` calldata for `call` signed by `signers`, not sent: to send it, or to ask a node what it would do. */
export async function signedExecData(chain: Chain, safe: Hex, call: SafeCall, signers: readonly CapxulSigner[]): Promise<Hex> {
  return execData(call, await sortedSignatures(await safeTxHash(chain, safe, call), signers));
}

/** The Safe runs `call` under `signatures` (ECDSA, or v = 1 approved-hash entries), sent by `sender`. */
export async function execWithSignatures(chain: Chain, safe: Hex, call: SafeCall, signatures: Hex, sender: Hex): Promise<Hex> {
  return send(chain, { from: sender, to: safe, data: execData(call, signatures) });
}

/** The Safe runs `call`, signed by `signers`, sent by `sender`. Throws when the Safe refuses or the call fails. */
export async function execSafe(chain: Chain, safe: Hex, call: SafeCall, signers: readonly CapxulSigner[], sender: Hex): Promise<Hex> {
  return send(chain, { from: sender, to: safe, data: await signedExecData(chain, safe, call, signers) });
}
