import { concat, encodeFunctionData, encodePacked, hashTypedData, isAddress, parseAbi, toHex, type Address, type Hex } from "viem";
import { getUserOperationHash } from "viem/account-abstraction";
import { ENTRY_POINT_07_ADDRESS, MULTI_SEND_CALL_ONLY, SAFE_4337_MODULE, SAFE_4337_EXECUTE_USER_OP_ABI, multiSendAbi } from "../shared/protocol/evm/safe-contracts.ts";

export { ENTRY_POINT_07_ADDRESS, MULTI_SEND_CALL_ONLY, SAFE_4337_MODULE };
export type SafeCall = { to: string; value: string; data: string };
/** The deployed-Safe v0.7 wire contract. Numbers are decimal strings, never JS numbers. */
export type SafeUserOperation = {
  sender: string; nonce: string; callData: string; callGasLimit: string; verificationGasLimit: string;
  preVerificationGas: string; maxFeePerGas: string; maxPriorityFeePerGas: string; paymaster: string;
  paymasterVerificationGasLimit: string; paymasterPostOpGasLimit: string; paymasterData: string;
};
export type SafeOpDomain = { chainId: number; module: Address; entryPoint: Address; validAfter: bigint; validUntil: bigint };
export const PACKED_USER_OPERATION = "(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)";
export const safeModuleAbi = parseAbi([
  `function getOperationHash(${PACKED_USER_OPERATION} userOp) view returns (bytes32)`,
  "function SUPPORTED_ENTRYPOINT() view returns (address)",
]);
export const entryPointAbi = parseAbi([
  "function getNonce(address sender,uint192 key) view returns (uint256)",
  `function getUserOpHash(${PACKED_USER_OPERATION} userOp) view returns (bytes32)`,
]);

export function uint(value: string, bits = 256): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("INVALID_INPUT: expected unsigned decimal integer");
  const n = BigInt(value);
  if (n >= 1n << BigInt(bits)) throw new Error("INVALID_INPUT: unsigned integer overflow");
  return n;
}
export function bytes(value: string): Hex {
  if (!/^0x(?:[a-fA-F0-9]{2})*$/.test(value)) throw new Error("INVALID_INPUT: expected bytes");
  return value.toLowerCase() as Hex;
}
export function address(value: string): Address {
  if (!isAddress(value, { strict: false })) throw new Error("INVALID_INPUT: expected address");
  return value.toLowerCase() as Address;
}
export function validitySignature(validAfter: bigint, validUntil: bigint, signature: Hex = "0x"): Hex {
  if (validAfter <= 0n || validUntil <= validAfter || validUntil >= 1n << 48n) throw new Error("INVALID_INPUT: bounded validity required");
  bytes(signature);
  if (signature !== "0x" && signature.length !== 132) throw new Error("INVALID_INPUT: raw 65-byte owner signature required");
  return encodePacked(["uint48", "uint48", "bytes"], [Number(validAfter), Number(validUntil), signature]);
}

/** Only CALLs inside MultiSendCallOnly. The outer delegatecall executes its code in the Safe. */
export function packCalls(calls: readonly SafeCall[], multiSend: Address = MULTI_SEND_CALL_ONLY): Hex {
  if (!calls.length) throw new Error("INVALID_INPUT: at least one call required");
  const normalized = calls.map(c => ({ to: address(c.to), value: uint(c.value), data: bytes(c.data) }));
  const single = normalized[0]!;
  const batch = concat(normalized.map(c => encodePacked(
    ["uint8", "address", "uint256", "uint256", "bytes"], [0, c.to, c.value, BigInt((c.data.length - 2) / 2), c.data],
  )));
  return encodeFunctionData({ abi: SAFE_4337_EXECUTE_USER_OP_ABI, functionName: "executeUserOpWithErrorString",
    args: normalized.length === 1 ? [single.to, single.value, single.data, 0] : [address(multiSend), 0n, encodeFunctionData({ abi: multiSendAbi, functionName: "multiSend", args: [batch] }), 1] });
}

export function packUserOperation(op: SafeUserOperation, validAfter: bigint, validUntil: bigint, signature: Hex = "0x") {
  const verification = uint(op.verificationGasLimit, 128), call = uint(op.callGasLimit, 128);
  const priority = uint(op.maxPriorityFeePerGas, 128), fee = uint(op.maxFeePerGas, 128);
  if (priority > fee) throw new Error("INVALID_INPUT: priority fee exceeds fee cap");
  return {
    sender: address(op.sender), nonce: uint(op.nonce), initCode: "0x" as Hex, callData: bytes(op.callData),
    accountGasLimits: encodePacked(["uint128", "uint128"], [verification, call]), preVerificationGas: uint(op.preVerificationGas),
    gasFees: encodePacked(["uint128", "uint128"], [priority, fee]),
    paymasterAndData: encodePacked(["address", "uint128", "uint128", "bytes"], [address(op.paymaster), uint(op.paymasterVerificationGasLimit, 128), uint(op.paymasterPostOpGasLimit, 128), bytes(op.paymasterData)]),
    signature: validitySignature(validAfter, validUntil, signature),
  };
}

const safeOpTypes = { SafeOp: [
  { name: "safe", type: "address" }, { name: "nonce", type: "uint256" }, { name: "initCode", type: "bytes" },
  { name: "callData", type: "bytes" }, { name: "verificationGasLimit", type: "uint128" }, { name: "callGasLimit", type: "uint128" },
  { name: "preVerificationGas", type: "uint256" }, { name: "maxPriorityFeePerGas", type: "uint128" }, { name: "maxFeePerGas", type: "uint128" },
  { name: "paymasterAndData", type: "bytes" }, { name: "validAfter", type: "uint48" }, { name: "validUntil", type: "uint48" }, { name: "entryPoint", type: "address" },
] } as const;

/** Safe4337Module 0.3.0's EIP-712 SafeOp, not EntryPoint's UserOperation hash. */
export function safeOpDigest(op: SafeUserOperation, domain: SafeOpDomain): Hex {
  const packed = packUserOperation(op, domain.validAfter, domain.validUntil);
  if (!Number.isSafeInteger(domain.chainId) || domain.chainId <= 0) throw new Error("INVALID_INPUT: chain id required");
  return hashTypedData({ domain: { chainId: domain.chainId, verifyingContract: address(domain.module) }, types: safeOpTypes, primaryType: "SafeOp",
    message: { safe: packed.sender, nonce: packed.nonce, initCode: packed.initCode, callData: packed.callData,
      verificationGasLimit: uint(op.verificationGasLimit, 128), callGasLimit: uint(op.callGasLimit, 128), preVerificationGas: packed.preVerificationGas,
      maxPriorityFeePerGas: uint(op.maxPriorityFeePerGas, 128), maxFeePerGas: uint(op.maxFeePerGas, 128), paymasterAndData: packed.paymasterAndData,
      validAfter: Number(domain.validAfter), validUntil: Number(domain.validUntil), entryPoint: address(domain.entryPoint) } });
}

export function entryPointHash(op: SafeUserOperation, chainId: number, entryPoint: Address = ENTRY_POINT_07_ADDRESS): Hex {
  // Validate every field through the same canonical codec; validity is not part of the EntryPoint hash.
  packUserOperation(op, 1n, 2n);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("INVALID_INPUT: chain id required");
  return getUserOperationHash({ chainId, entryPointAddress: address(entryPoint), entryPointVersion: "0.7", userOperation: {
    sender: address(op.sender), nonce: uint(op.nonce), callData: bytes(op.callData), signature: "0x",
    callGasLimit: uint(op.callGasLimit, 128), verificationGasLimit: uint(op.verificationGasLimit, 128), preVerificationGas: uint(op.preVerificationGas),
    maxFeePerGas: uint(op.maxFeePerGas, 128), maxPriorityFeePerGas: uint(op.maxPriorityFeePerGas, 128), paymaster: address(op.paymaster),
    paymasterVerificationGasLimit: uint(op.paymasterVerificationGasLimit, 128), paymasterPostOpGasLimit: uint(op.paymasterPostOpGasLimit, 128), paymasterData: bytes(op.paymasterData),
  } });
}

export function toRpcUserOperation(op: SafeUserOperation, validAfter: bigint, validUntil: bigint, signature: Hex = "0x") {
  packUserOperation(op, validAfter, validUntil, signature);
  return { sender: address(op.sender), nonce: toHex(uint(op.nonce)), callData: bytes(op.callData), signature: validitySignature(validAfter, validUntil, signature),
    callGasLimit: toHex(uint(op.callGasLimit, 128)), verificationGasLimit: toHex(uint(op.verificationGasLimit, 128)), preVerificationGas: toHex(uint(op.preVerificationGas)),
    maxFeePerGas: toHex(uint(op.maxFeePerGas, 128)), maxPriorityFeePerGas: toHex(uint(op.maxPriorityFeePerGas, 128)), paymaster: address(op.paymaster),
    paymasterVerificationGasLimit: toHex(uint(op.paymasterVerificationGasLimit, 128)), paymasterPostOpGasLimit: toHex(uint(op.paymasterPostOpGasLimit, 128)), paymasterData: bytes(op.paymasterData) };
}

/** Browser-side independent check before giving an operation to a raw-digest signer. */
export function verifySafeOp(input: {
  op: SafeUserOperation; calls: readonly SafeCall[]; sender: string; nonceKey: string; nonce?: string | null;
  deadline: Date; sendAfter: Date | null;
  digest: string; userOpHash: string; domain: SafeOpDomain; multiSend?: Address;
}): boolean {
  try {
    const nonce = uint(input.op.nonce), key = uint(input.nonceKey, 192);
    const earliest = input.sendAfter === null ? 1n : BigInt(Math.ceil(input.sendAfter.getTime() / 1000));
    const latest = BigInt(Math.floor(input.deadline.getTime() / 1000));
    return input.domain.validAfter >= earliest && input.domain.validUntil <= latest &&
      key !== 0n && nonce >> 64n === key && (input.nonce == null || nonce === uint(input.nonce)) &&
      address(input.sender).toLowerCase() === address(input.op.sender).toLowerCase() &&
      packCalls(input.calls, input.multiSend).toLowerCase() === bytes(input.op.callData).toLowerCase() &&
      safeOpDigest(input.op, input.domain).toLowerCase() === input.digest.toLowerCase() &&
      entryPointHash(input.op, input.domain.chainId, input.domain.entryPoint).toLowerCase() === input.userOpHash.toLowerCase();
  } catch { return false; }
}
