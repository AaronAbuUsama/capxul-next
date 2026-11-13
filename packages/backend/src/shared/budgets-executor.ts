import type pg from "pg";
import {
  TransactionReceiptNotFoundError, createPublicClient, decodeErrorResult, decodeEventLog, encodeFunctionData, http, isAddress,
  keccak256, parseAbi, stringToHex, type Address, type Chain, type Hex, type LocalAccount,
} from "viem";
import { ServiceSignerError, durableSend, saveReceipt, storedSend, type SignerKey } from "./service-signer.ts";

/** Budgets' executor key: it only pays the gas of `Budgets.execute(scheduledId)`, which anyone may call on the day. */
export type BudgetsExecutorConfig = { worker: pg.Pool; rpcUrl: string; chain: Chain; account: LocalAccount; budgets: Address };
export type ExecuteReceipt = {
  hash: Hex; chainId: number; blockNumber: string; blockHash: Hex; status: "success" | "reverted";
  scheduledId: string; paymentId: Hex | null; revert: string | null;
};
export interface BudgetsExecutor {
  send(input: { key: string; scheduledId: bigint }): Promise<{ hash: Hex }>;
  /** One read, no wait: what was recorded for the key and, once mined, its receipt. */
  lookup(input: { key: string }): Promise<{ hash: Hex | null; receipt: ExecuteReceipt | null }>;
  waitForReceipt(input: { key: string; hash: Hex }): Promise<ExecuteReceipt>;
}

const BUDGETS = parseAbi([
  "function execute(uint256 scheduledId) returns (bytes32 paymentId)",
  "event ScheduledPaid(address indexed safe, uint256 indexed budgetId, uint256 indexed scheduledId, bytes32 paymentId)",
  "error UnknownScheduled(uint256 id)", "error NotPending(uint256 id)", "error NotDue(uint256 id, uint64 payAt)",
  "error OverBudget(uint256 id, uint128 left, uint128 requested)", "error BudgetIsClosed(uint256 closedId)",
  "error UnknownBudget(uint256 id)", "error ReentrantCall()",
]);

export function budgetsExecutor(config: BudgetsExecutorConfig): BudgetsExecutor {
  if (!isAddress(config.budgets)) throw new ServiceSignerError("INVALID_INPUT");
  const key: SignerKey = config;
  const decode = async (stored: { hash: Hex; scheduled_id: string | null }, signal?: AbortSignal): Promise<ExecuteReceipt | null> => {
    const client = createPublicClient({ chain: config.chain, transport: http(config.rpcUrl, { retryCount: 0, timeout: 10_000, ...(signal ? { fetchOptions: { signal } } : {}) }) });
    if (await client.getChainId() !== config.chain.id) throw new ServiceSignerError("PROVIDER_ERROR", stored.hash);
    let receipt;
    try { receipt = await client.getTransactionReceipt({ hash: stored.hash }); }
    catch (error) { if (error instanceof TransactionReceiptNotFoundError) return null; throw error; }
    const scheduledId = stored.scheduled_id!;
    let paymentId: Hex | null = null, revert: string | null = null;
    for (const log of receipt.logs.filter((l) => l.address.toLowerCase() === config.budgets.toLowerCase())) {
      try {
        const e = decodeEventLog({ abi: BUDGETS, eventName: "ScheduledPaid", data: log.data, topics: log.topics });
        if (e.args.scheduledId.toString() === scheduledId) paymentId = e.args.paymentId;
      } catch { /* Another Budgets event in the same transaction. */ }
    }
    if (receipt.status === "success" && !paymentId) throw new ServiceSignerError("TRANSACTION_FAILED", stored.hash);
    if (receipt.status === "reverted") {
      // The exact transaction's trace only; never replay eth_call at block end and invent a refusal.
      try {
        const response = await fetch(config.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(5_000),
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "debug_traceTransaction", params: [stored.hash, { disableStorage: true, disableStack: true, enableMemory: false }] }) });
        const raw = ((await response.json()) as { result?: { returnValue?: string } }).result?.returnValue;
        if (raw) revert = decodeErrorResult({ abi: BUDGETS, data: (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex }).errorName;
      } catch { /* Trace unsupported or a revert from another contract: no name. */ }
    }
    return { hash: stored.hash, chainId: config.chain.id, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
      status: receipt.status, scheduledId, paymentId, revert };
  };
  const recorded = async (requestKey: string) => {
    const stored = await storedSend(config.worker, key, requestKey);
    if (stored && stored.scheduled_id === null) throw new ServiceSignerError("INVALID_INPUT");
    return stored;
  };
  return {
    async send({ key: requestKey, scheduledId }) {
      if (!requestKey || requestKey.length > 256 || typeof scheduledId !== "bigint" || scheduledId < 1n) throw new ServiceSignerError("INVALID_INPUT");
      const data = encodeFunctionData({ abi: BUDGETS, functionName: "execute", args: [scheduledId] });
      const digest = keccak256(stringToHex(`${config.budgets.toLowerCase()}:${data}`));
      return durableSend(key, { key: requestKey, digest, to: config.budgets, data, job: "budgets-execute",
        revert: (name) => new ServiceSignerError("TRANSACTION_FAILED", undefined, name || undefined),
        async prepare(client) {
          await client.simulateContract({ account: config.account.address, address: config.budgets, abi: BUDGETS, functionName: "execute", args: [scheduledId] });
          return { scheduledId: scheduledId.toString() };
        } });
    },
    async lookup({ key: requestKey }) {
      try {
        const stored = await recorded(requestKey);
        if (!stored) return { hash: null, receipt: null };
        if (stored.receipt) return { hash: stored.hash, receipt: stored.receipt };
        const receipt = await decode(stored);
        if (receipt) await saveReceipt(key, requestKey, receipt);
        return { hash: stored.hash, receipt };
      } catch (error) {
        if (error instanceof ServiceSignerError) throw error;
        throw new ServiceSignerError("PROVIDER_ERROR");
      }
    },
    async waitForReceipt({ key: requestKey, hash }) {
      const signal = AbortSignal.timeout(60_000), deadline = Date.now() + 60_000;
      const stored = await recorded(requestKey).catch((error) => { throw error instanceof ServiceSignerError ? error : new ServiceSignerError("PROVIDER_ERROR", hash); });
      if (!stored || stored.hash.toLowerCase() !== hash.toLowerCase()) throw new ServiceSignerError("INVALID_INPUT");
      if (stored.receipt) return stored.receipt;
      // Polls once a second; a failed poll does not end the wait (old R7).
      while (Date.now() < deadline) {
        try {
          const receipt = await decode(stored, signal);
          if (receipt) { await saveReceipt(key, requestKey, receipt); return receipt; }
        } catch (error) { if (error instanceof ServiceSignerError && error.code === "TRANSACTION_FAILED") throw error; }
        await new Promise((r) => setTimeout(r, Math.min(1_000, Math.max(0, deadline - Date.now()))));
      }
      throw new ServiceSignerError("PROVIDER_ERROR", stored.hash);
    },
  };
}
