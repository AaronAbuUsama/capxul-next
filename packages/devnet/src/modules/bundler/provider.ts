import type { Hex } from "viem";
import type { Bundler, Lookup, ProviderCode, RpcTransport, RpcUserOperation } from "./types.ts";

export class ProviderError extends Error {
  readonly code: ProviderCode;
  constructor(code: ProviderCode, message: string) { super(message); this.code = code; }
}
class RpcRejection extends Error {
  readonly rpcCode: number;
  constructor(rpcCode: number) { super("bundler rejected RPC request"); this.rpcCode = rpcCode; }
}
const invalid = () => new ProviderError("PROVIDER_RESPONSE_INVALID", "bundler returned an invalid response");
const unavailable = () => new ProviderError("PROVIDER_ERROR", "bundler did not answer; use the operation hash for recovery");
const object = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const hash = (x: unknown): x is Hex => typeof x === "string" && /^0x[0-9a-fA-F]{64}$/.test(x);
const hex = (x: unknown): x is Hex => typeof x === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(x);
const quantity = (x: unknown) => typeof x === "string" && /^0x[0-9a-fA-F]+$/.test(x);
const address = (x: unknown) => typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x);
const operation = (x: unknown): x is RpcUserOperation => object(x) && address(x.sender) && hex(x.callData) && hex(x.signature) &&
  ["nonce", "callGasLimit", "verificationGasLimit", "preVerificationGas", "maxFeePerGas", "maxPriorityFeePerGas"].every(k => quantity(x[k])) &&
  (x.factory === undefined || (address(x.factory) && (x.factoryData === undefined || hex(x.factoryData)))) &&
  (x.paymaster === undefined || (address(x.paymaster) && quantity(x.paymasterVerificationGasLimit) && quantity(x.paymasterPostOpGasLimit) && (x.paymasterData === undefined || hex(x.paymasterData))));

/** Provider payloads/URLs are never included in errors: they can contain tokens and signed operations. */
export function httpTransport(url: string): RpcTransport {
  return { async request(method, params) {
    let response: Response;
    try {
      response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(method === "eth_sendUserOperation" ? 5_000 : 2_000), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    } catch { throw unavailable(); }
    if (!response.ok) throw unavailable();
    let body: unknown;
    try { body = await response.json(); } catch { throw invalid(); }
    if (!object(body) || body.jsonrpc !== "2.0" || body.id !== 1) throw invalid();
    if (body.error !== undefined) {
      if (!object(body.error) || !Number.isInteger(body.error.code)) throw invalid();
      throw new RpcRejection(body.error.code as number);
    }
    if (!("result" in body)) throw invalid();
    return body.result;
  } };
}

/** One broadcast only. Uncertain delivery is looked up, never resubmitted. */
export function bundlerProvider(transport: RpcTransport): Bundler {
  const lookup = async (expected: Hex): Promise<Lookup> => {
    if (!hash(expected)) throw invalid();
    const read = async (method: string): Promise<unknown> => {
      for (let attempt = 0; ; attempt++) {
        try { return await transport.request(method, [expected]); }
        catch (error) {
          if (error instanceof ProviderError && error.code === "PROVIDER_RESPONSE_INVALID") throw error;
          if (attempt === 2) throw unavailable();
          await new Promise(r => setTimeout(r, 100 * 2 ** attempt));
        }
      }
    };
    const [heldResult, receiptResult] = await Promise.allSettled([read("eth_getUserOperationByHash"), read("eth_getUserOperationReceipt")]);
    // Both bounded reads finish before the caller resumes; no orphan retry continues after a failure.
    if (heldResult.status === "rejected") throw heldResult.reason;
    if (receiptResult.status === "rejected") throw receiptResult.reason;
    const held = heldResult.value, receipt = receiptResult.value;
    let op: RpcUserOperation | null = null;
    if (held !== null) {
      if (!object(held) || !operation(held.userOperation)) throw invalid();
      op = held.userOperation;
    }
    if (receipt === null) return { operation: op, receipt: null };
    if (!object(receipt) || !hash(receipt.userOpHash) || receipt.userOpHash.toLowerCase() !== expected.toLowerCase() || typeof receipt.success !== "boolean" || !object(receipt.receipt) || !hash(receipt.receipt.transactionHash)) throw invalid();
    return { operation: op, receipt: { userOpHash: receipt.userOpHash, success: receipt.success, receipt: { transactionHash: receipt.receipt.transactionHash } } };
  };
  return {
    lookup,
    async send({ operation: op, entryPoint, expectedHash }) {
      if (!operation(op) || !address(entryPoint) || !hash(expectedHash)) throw invalid();
      let answer: unknown;
      try { answer = await transport.request("eth_sendUserOperation", [op, entryPoint]); }
      catch (error) {
        if ((error instanceof RpcRejection && error.rpcCode <= -32500 && error.rpcCode >= -32599) || (object(error) && typeof error.code === "number" && error.code <= -32500 && error.code >= -32599)) throw new ProviderError("TRANSACTION_FAILED", "bundler rejected operation validation");
        if (error instanceof ProviderError && error.code === "PROVIDER_RESPONSE_INVALID") throw error;
        const found = await lookup(expectedHash);
        if (found.operation || found.receipt) return expectedHash;
        throw unavailable();
      }
      if (!hash(answer) || answer.toLowerCase() !== expectedHash.toLowerCase()) throw invalid();
      return expectedHash;
    },
  };
}
