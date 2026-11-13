import { concat, encodeFunctionData, encodePacked, hashTypedData, isAddress, isHex, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import type { Call, Proposal } from "./types.ts";

const multiSend = parseAbi(["function multiSend(bytes transactions)"]);
const safe = parseAbi([
  "function approveHash(bytes32 hashToApprove)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
]);
const gate = parseAbi(["function removeSigner(address signer)"]);
const types = { SafeTx: [
  { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" },
  { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" },
  { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" },
  { name: "nonce", type: "uint256" },
] } as const;

/** InstallerMoney._required, evaluated losslessly for the owners left after removeSigner. */
export function cleanupThreshold(config: { thresholdType: number; min: bigint; target: bigint }, owners: number): number {
  const { thresholdType: kind, min, target } = config;
  if (![0, 1].includes(kind) || typeof min !== "bigint" || typeof target !== "bigint" ||
      min < 1n || min >= 1n << 120n || target < 1n || target >= 1n << 120n ||
      (kind === 0 ? target < min : target > 10_000n) || !Number.isSafeInteger(owners) || owners < 0) {
    throw new Error("PROVIDER_RESPONSE_INVALID: invalid Gate threshold configuration");
  }
  const count = BigInt(owners);
  let required = kind === 0 ? count < min ? min : count > target ? target : count : (count * target + 9999n) / 10_000n;
  if (required < min) required = min;
  return Number(required > count ? count : required);
}

/** Call-only packing: an opener can never smuggle a delegatecall into the batch. */
export function transaction(calls: Call[], multiSendAddress: Address) {
  if (!Array.isArray(calls) || !calls.length || calls.some((c) => !c ||
    typeof c.to !== "string" || !isAddress(c.to) ||
    typeof c.data !== "string" || !isHex(c.data, { strict: true }) || c.data.length % 2 !== 0 ||
    typeof c.value !== "string" || !/^\d+$/.test(c.value) || BigInt(c.value) >= 1n << 256n)) {
    throw new Error("INVALID_INPUT: at least one valid call is required");
  }
  // Do not copy an opener's operation (or any other undeclared field) into immutable terms.
  if (calls.length === 1) return { to: calls[0]!.to.toLowerCase() as Address, value: calls[0]!.value, data: calls[0]!.data.toLowerCase() as Hex, operation: "call" as const };
  return { to: multiSendAddress.toLowerCase() as Address, value: "0", operation: "delegatecall" as const,
    data: encodeFunctionData({ abi: multiSend, functionName: "multiSend", args: [concat(calls.map((c) => encodePacked(
      ["uint8", "address", "uint256", "uint256", "bytes"], [0, c.to, BigInt(c.value), BigInt((c.data.length - 2) / 2), c.data.toLowerCase() as Hex],
    )))] }) };
}

export function transactionHash(chainId: number, safeAddress: Address, nonce: number, tx: ReturnType<typeof transaction>) {
  return hashTypedData({ domain: { chainId, verifyingContract: safeAddress }, types, primaryType: "SafeTx", message: {
    to: tx.to, value: BigInt(tx.value), data: tx.data, operation: tx.operation === "call" ? 0 : 1,
    safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: zeroAddress, refundReceiver: zeroAddress, nonce: BigInt(nonce),
  } });
}

export function approvalCalls(p: Proposal, signer: Address, approvals: Address[], lapsed: Address[], gateAddress: Address, execute: boolean): Call[] {
  if (!execute) return [{ to: p.safe_address, value: "0", data: encodeFunctionData({ abi: safe, functionName: "approveHash", args: [p.safe_tx_hash] }) }];
  const signatures: Hex = concat([...new Set([...approvals, signer])].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1)
    .map((owner) => encodePacked(["uint256", "uint256", "uint8"], [BigInt(owner), 0n, 1])));
  return [
    ...lapsed.map((owner) => ({ to: gateAddress, value: "0", data: encodeFunctionData({ abi: gate, functionName: "removeSigner", args: [owner] }) })),
    { to: p.safe_address, value: "0", data: encodeFunctionData({ abi: safe, functionName: "execTransaction", args: [
      p.to, BigInt(p.value), p.data, p.operation === "call" ? 0 : 1, 0n, 0n, 0n, zeroAddress, zeroAddress, signatures,
    ] }) },
  ];
}
