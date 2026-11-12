// An ERC-4337 v0.7 UserOperation from a personal Safe (Safe4337Module 0.3.0 as its module and fallback handler), with a
// paymaster paying the gas. The op is built and signed here; how it reaches the EntryPoint is the caller's: a bundler's
// eth_sendUserOperation, or the EntryPoint's handleOps sent directly (no bundler in the world).

import { concat, encodeFunctionData, pad, parseAbi, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { Chain } from "../../chain/types.ts";

export const ENTRY_POINT_V07: Hex = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

const PACKED = "(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)";
export const ENTRY_POINT = parseAbi([
  "function getNonce(address sender, uint192 key) view returns (uint256)",
  `function handleOps(${PACKED}[] ops, address beneficiary)`,
  "function depositTo(address account) payable",
  "function balanceOf(address account) view returns (uint256)",
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
  "event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)",
]);
const MODULE = parseAbi([
  `function getOperationHash(${PACKED} userOp) view returns (bytes32)`,
  "function executeUserOp(address to, uint256 value, bytes data, uint8 operation)",
]);

/** The gas a payment needs, with room to spare; the paymaster pays, so over-asking costs nothing in a test world. */
const GAS = { verification: 600_000n, call: 1_000_000n, preVerification: 100_000n, pmVerification: 100_000n, pmPostOp: 50_000n };

export interface PackedUserOp {
  sender: Hex; nonce: bigint; initCode: Hex; callData: Hex; accountGasLimits: Hex; preVerificationGas: bigint;
  gasFees: Hex; paymasterAndData: Hex; signature: Hex;
}

/** validAfter 0 and validUntil 0: valid at any time. */
const VALIDITY: Hex = pad("0x", { size: 12 });
const two128 = (hi: bigint, lo: bigint): Hex => concat([pad(toHex(hi), { size: 16 }), pad(toHex(lo), { size: 16 })]);

/**
 * The Safe calls `to` with `data`, as a UserOperation signed by the Safe's one owner. The Safe4337Module's signature is
 * validAfter (6 bytes) and validUntil (6 bytes), both zero for "always", then the Safe owners' signatures over the
 * module's operation hash (a raw ECDSA signature, v 27 or 28, which a Safe checks against the hash itself).
 */
export async function buildUserOp(chain: Chain, x: { safe: Hex; ownerKey: Hex; module: Hex; paymaster: Hex; to: Hex; data: Hex }): Promise<PackedUserOp> {
  const nonce = await chain.client.readContract({ address: ENTRY_POINT_V07, abi: ENTRY_POINT, functionName: "getNonce", args: [x.safe, 0n] });
  const fees = await chain.client.estimateFeesPerGas();
  const op: PackedUserOp = {
    sender: x.safe, nonce, initCode: "0x",
    callData: encodeFunctionData({ abi: MODULE, functionName: "executeUserOp", args: [x.to, 0n, x.data, 0] }),
    accountGasLimits: two128(GAS.verification, GAS.call), preVerificationGas: GAS.preVerification,
    gasFees: two128(fees.maxPriorityFeePerGas, fees.maxFeePerGas),
    paymasterAndData: concat([x.paymaster, pad(toHex(GAS.pmVerification), { size: 16 }), pad(toHex(GAS.pmPostOp), { size: 16 })]),
    signature: VALIDITY, // the module reads the validity window from the signature when it hashes the op
  };
  const hash = await chain.client.readContract({ address: x.module, abi: MODULE, functionName: "getOperationHash", args: [op] });
  const sig = await privateKeyToAccount(x.ownerKey).sign({ hash });
  return { ...op, signature: concat([VALIDITY, sig]) };
}

/** How a signed op reaches the EntryPoint. Returns the hash of the transaction that carried it. */
export type Submit = (op: PackedUserOp) => Promise<Hex>;

/** No bundler: the given key sends the EntryPoint's handleOps itself and is the beneficiary of the refund. */
export const viaEntryPoint = (chain: Chain, key: Hex): Submit => async (op) => {
  const wallet = chain.walletFor(key);
  const hash = await wallet.writeContract({ address: ENTRY_POINT_V07, abi: ENTRY_POINT, functionName: "handleOps", args: [[op], wallet.account.address] });
  const r = await chain.client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`handleOps ${hash} reverted`);
  return hash;
};

/** A bundler (alto) at `url`: eth_sendUserOperation in v0.7's unpacked form, then its receipt. */
export const viaBundler = (url: string): Submit => async (op) => {
  const hi = (b: Hex) => BigInt(`0x${b.slice(2, 34)}`); const lo = (b: Hex) => BigInt(`0x${b.slice(34, 66)}`);
  const pm = op.paymasterAndData;
  const unpacked = {
    sender: op.sender, nonce: toHex(op.nonce), callData: op.callData,
    verificationGasLimit: toHex(hi(op.accountGasLimits)), callGasLimit: toHex(lo(op.accountGasLimits)),
    preVerificationGas: toHex(op.preVerificationGas),
    maxPriorityFeePerGas: toHex(hi(op.gasFees)), maxFeePerGas: toHex(lo(op.gasFees)),
    paymaster: pm.slice(0, 42), paymasterVerificationGasLimit: toHex(BigInt(`0x${pm.slice(42, 74)}`)),
    paymasterPostOpGasLimit: toHex(BigInt(`0x${pm.slice(74, 106)}`)), paymasterData: "0x", signature: op.signature,
  };
  const rpc = async (method: string, params: unknown[]) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const body = (await res.json()) as { result?: any; error?: { message: string } };
    if (body.error) throw new Error(`bundler ${method}: ${body.error.message}`);
    return body.result;
  };
  const opHash = (await rpc("eth_sendUserOperation", [unpacked, ENTRY_POINT_V07])) as Hex;
  for (let i = 0; i < 300; i++) {
    const receipt = await rpc("eth_getUserOperationReceipt", [opHash]);
    if (receipt) return receipt.receipt.transactionHash as Hex;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`bundler never included user operation ${opHash}`);
};
