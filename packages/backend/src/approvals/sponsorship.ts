import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, stringToHex, toHex, type Address, type Hex, type PublicClient } from "viem";
import { address, bytes, uint, packCalls, packUserOperation, toRpcUserOperation, safeOpDigest, entryPointHash, entryPointAbi, safeModuleAbi, PACKED_USER_OPERATION, type SafeCall, type SafeUserOperation } from "../../../sdk/src/approvals/safe-op.ts";
import { SponsorError, sponsorRefusal, type SponsorTransport } from "./sponsorship-rpc.ts";
import type { Approval } from "./types.ts";

export { sponsorHttpTransport, SponsorError } from "./sponsorship-rpc.ts";
export type { SponsorTransport } from "./sponsorship-rpc.ts";
export type SponsorshipRequest = {
  chain_id: number; sender: string; calls: SafeCall[]; nonce_key: string; nonce: string | null;
  deadline: Date; send_after: Date | null;
};
export type SponsorRefusal = { code: string; reason: string };
/** Not a refusal: the canonical clock left less than one whole second of window. The carrier lets the approval lapse,
 * whose nonce guard decides how it ends (approvals.verified-sponsorship). */
export type SponsorExpired = { expired: true };
export type VerifiedSponsorship = {
  nonce: string; signer_address: string; user_operation: SafeUserOperation; digest: string; user_op_hash: string;
  valid_after: Date; valid_until: Date;
};
/** Addresses come from this world's trusted deployment, never an approval request. */
export type SponsorConfig = {
  client: PublicClient; gateway: SponsorTransport; entryPoint: Address; module: Address; multiSend: Address;
  paymaster: Address; claimOwner: Address; now: () => Date;
};
const safeAbi = parseAbi(["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)", "function isModuleEnabled(address module) view returns (bool)"]);
const paymasterAbi = parseAbi([`function validatePaymasterUserOp(${PACKED_USER_OPERATION} userOp,bytes32 userOpHash,uint256 maxCost) returns (bytes context,uint256 validationData)`]);
const fallbackSlot = keccak256(stringToHex("fallback_manager.handler.address"));
const dummySignature: Hex = `0x${"01".repeat(64)}1b`;
const invalid = () => new SponsorError("PROVIDER_RESPONSE_INVALID", "Sponsorship authority, data or window is invalid");
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const quantity = (v: unknown, bits = 128): string => {
  if (typeof v !== "string" || !/^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(v)) throw invalid();
  const n = BigInt(v);
  if (n >= 1n << BigInt(bits)) throw invalid();
  return n.toString();
};
function sponsorData(v: unknown, paymaster: Address) {
  try {
    if (!object(v) || typeof v.paymaster !== "string" || address(v.paymaster).toLowerCase() !== paymaster.toLowerCase() || typeof v.paymasterData !== "string") throw invalid();
    return { paymaster: address(paymaster), paymasterData: bytes(v.paymasterData), paymasterVerificationGasLimit: quantity(v.paymasterVerificationGasLimit), paymasterPostOpGasLimit: quantity(v.paymasterPostOpGasLimit) };
  } catch { throw invalid(); }
}

/** ERC-7677 sponsorship only: never signs an owner operation or sends one. */
export function approvalSponsor(config: SponsorConfig): (a: SponsorshipRequest) => Promise<VerifiedSponsorship | SponsorRefusal | SponsorExpired> {
  const { client, gateway, module, entryPoint, multiSend, paymaster, claimOwner } = config;
  return async a => {
    try {
      const now = config.now().getTime();
      if (![now, a.deadline.getTime(), a.send_after?.getTime() ?? now].every(Number.isFinite)) throw new SponsorError("INVALID_INPUT", "Approval dates are invalid");
      const after = BigInt(Math.ceil(Math.max(now, a.send_after?.getTime() ?? now) / 1000));
      const until = BigInt(Math.floor(a.deadline.getTime() / 1000));
      // Dates that cannot form a window are input. Less than one whole second of window left on the canonical clock,
      // before or during sponsorship, is expiry: never a refusal, and nothing is sponsored.
      const start = a.send_after === null ? 1n : BigInt(Math.ceil(a.send_after.getTime() / 1000));
      if (after <= 0n || start <= 0n || until <= start || until >= 1n << 48n) throw new SponsorError("INVALID_INPUT", "Approval window is empty");
      const lapsed = (ms: number) => until <= BigInt(Math.ceil(ms / 1000));
      if (lapsed(now)) return { expired: true };
      const sender = address(a.sender), key = uint(a.nonce_key, 192);
      if (key === 0n) throw new SponsorError("INVALID_INPUT", "Approval nonce key must be nonzero");
      if (await client.getChainId() !== a.chain_id) throw invalid();
      const blockNumber = await client.getBlockNumber();
      const chainRead = { blockNumber };
      for (const target of [sender, module, entryPoint, paymaster, ...(a.calls.length > 1 ? [multiSend] : [])]) {
        const code = await client.getCode({ address: target, ...chainRead });
        if (!code || code === "0x") {
          if (target === sender) throw new SponsorError("SMART_ACCOUNT_MISSING", "The signer's Safe is not deployed");
          throw invalid();
        }
      }
      const [owners, threshold, enabled, supported, fallback, nextNonce] = await Promise.all([
        client.readContract({ address: sender, abi: safeAbi, functionName: "getOwners", ...chainRead }),
        client.readContract({ address: sender, abi: safeAbi, functionName: "getThreshold", ...chainRead }),
        client.readContract({ address: sender, abi: safeAbi, functionName: "isModuleEnabled", args: [module], ...chainRead }),
        client.readContract({ address: module, abi: safeModuleAbi, functionName: "SUPPORTED_ENTRYPOINT", ...chainRead }),
        client.getStorageAt({ address: sender, slot: fallbackSlot, ...chainRead }),
        client.readContract({ address: entryPoint, abi: entryPointAbi, functionName: "getNonce", args: [sender, key], ...chainRead }),
      ]);
      if (owners.length !== 1 || threshold !== 1n || owners[0]!.toLowerCase() === claimOwner.toLowerCase()) throw new SponsorError("SMART_ACCOUNT_MISSING", "A claimed single-owner Safe is required");
      if (!enabled || supported.toLowerCase() !== entryPoint.toLowerCase() || fallback?.slice(-40).toLowerCase() !== module.slice(2).toLowerCase()) throw invalid();
      const nonce = a.nonce === null ? nextNonce : uint(a.nonce);
      if (nonce >> 64n !== key || nonce !== nextNonce) throw new SponsorError("WRONG_STATE", "Approval nonce is no longer available");
      const fees = await client.estimateFeesPerGas();
      let op: SafeUserOperation = { sender, nonce: nonce.toString(), callData: packCalls(a.calls, multiSend), callGasLimit: "0", verificationGasLimit: "0", preVerificationGas: "0",
        maxFeePerGas: fees.maxFeePerGas.toString(), maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
        paymaster, paymasterData: "0x", paymasterVerificationGasLimit: "0", paymasterPostOpGasLimit: "0" };
      const context = { validAfter: toHex(after), validUntil: toHex(until) };
      const params = () => [toRpcUserOperation(op, after, until, dummySignature), entryPoint, toHex(a.chain_id), context];
      op = { ...op, ...sponsorData(await gateway.request("pm_getPaymasterStubData", params()), paymaster) };
      const estimate = await gateway.request("eth_estimateUserOperationGas", params().slice(0, 2));
      if (!object(estimate)) throw invalid();
      op = { ...op, callGasLimit: quantity(estimate.callGasLimit), verificationGasLimit: quantity(estimate.verificationGasLimit), preVerificationGas: quantity(estimate.preVerificationGas, 256),
        ...(estimate.paymasterVerificationGasLimit === undefined ? {} : { paymasterVerificationGasLimit: quantity(estimate.paymasterVerificationGasLimit) }),
        ...(estimate.paymasterPostOpGasLimit === undefined ? {} : { paymasterPostOpGasLimit: quantity(estimate.paymasterPostOpGasLimit) }) };
      // Final data may omit gas fields (ERC-7677): the stub/estimated limits remain authoritative.
      const final = await gateway.request("pm_getPaymasterData", params());
      if (!object(final)) throw invalid();
      op = { ...op, ...sponsorData({ paymasterVerificationGasLimit: toHex(uint(op.paymasterVerificationGasLimit)), paymasterPostOpGasLimit: toHex(uint(op.paymasterPostOpGasLimit)), ...final }, paymaster) };
      if (op.paymasterData === "0x") throw invalid();
      const packed = packUserOperation(op, after, until), domain = { chainId: a.chain_id, module, entryPoint, validAfter: after, validUntil: until };
      const digest = safeOpDigest(op, domain), userOpHash = entryPointHash(op, a.chain_id, entryPoint);
      const [chainDigest, chainHash] = await Promise.all([
        client.readContract({ address: module, abi: safeModuleAbi, functionName: "getOperationHash", args: [packed], ...chainRead }),
        client.readContract({ address: entryPoint, abi: entryPointAbi, functionName: "getUserOpHash", args: [packed], ...chainRead }),
      ]);
      if (digest.toLowerCase() !== chainDigest.toLowerCase() || userOpHash.toLowerCase() !== chainHash.toLowerCase()) throw invalid();
      const maxCost = (uint(op.verificationGasLimit) + uint(op.callGasLimit) + uint(op.preVerificationGas) + uint(op.paymasterVerificationGasLimit) + uint(op.paymasterPostOpGasLimit)) * uint(op.maxFeePerGas);
      const result = await client.call({ account: entryPoint, to: paymaster, data: encodeFunctionData({ abi: paymasterAbi, functionName: "validatePaymasterUserOp", args: [packed, userOpHash, maxCost] }), ...chainRead });
      if (!result.data) throw invalid();
      let validation: bigint;
      try { [, validation] = decodeFunctionResult({ abi: paymasterAbi, functionName: "validatePaymasterUserOp", data: result.data }); }
      catch { throw invalid(); }
      const mask = (1n << 48n) - 1n;
      if ((validation & ((1n << 160n) - 1n)) !== 0n || ((validation >> 160n) & mask) !== until || ((validation >> 208n) & mask) !== after) throw invalid();
      const completedAt = config.now().getTime();
      if (!Number.isFinite(completedAt)) throw invalid();
      if (lapsed(completedAt)) return { expired: true };
      return { nonce: op.nonce, signer_address: address(owners[0]!), user_operation: op, digest, user_op_hash: userOpHash,
        valid_after: new Date(Number(after) * 1000), valid_until: new Date(Number(until) * 1000) };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("INVALID_INPUT:")) return { code: "INVALID_INPUT", reason: error.message };
      if (error instanceof SponsorError) {
        if (error.code === "PROVIDER_ERROR") throw error; // An outage is retried by the durable carrier, never persisted as refusal.
        return { code: error.code, reason: error.message };
      }
      const refusal = sponsorRefusal(error);
      if (refusal) return refusal;
      throw new SponsorError("PROVIDER_ERROR", "Sponsorship chain or gateway did not answer");
    }
  };
}

/**
 * The carrier's sponsor, on the world's authority clock: `now` is awaited once per call and that one reading is the
 * synchronous SponsorConfig.now for the window and its completion check, never host time.
 */
export function carrierSponsor(config: Omit<SponsorConfig, "now">, now: () => Promise<Date>) {
  return async (a: Approval): Promise<VerifiedSponsorship | SponsorRefusal | { expired: true }> => {
    const at = await now();
    return approvalSponsor({ ...config, now: () => at })({ chain_id: a.chain_id, sender: a.sender, calls: a.calls,
      nonce_key: a.nonce_key, nonce: a.nonce, deadline: a.deadline, send_after: a.send_after });
  };
}
