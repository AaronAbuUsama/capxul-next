import { readFileSync } from "node:fs";
import type pg from "pg";
import {
  BaseError, ContractFunctionRevertedError, TransactionReceiptNotFoundError,
  createPublicClient, createWalletClient, decodeErrorResult, decodeEventLog, encodeFunctionData,
  http, isAddress, keccak256, parseAbi, stringToHex, type Address, type Chain, type Hex, type LocalAccount,
} from "viem";
import type { Sql } from "../platform/db.ts";

export type ClaimSend = { key: string; email: string; signer: Address };
export type ClaimReceipt = {
  hash: Hex; chainId: number; blockNumber: string; blockHash: Hex;
  status: "success" | "reverted"; safe: Address | null;
  errorCode: "WRONG_STATE" | "INVALID_INPUT" | "TRANSACTION_FAILED" | null;
};
export interface ServiceSigner {
  send(input: ClaimSend): Promise<{ hash: Hex }>;
  waitForReceipt(input: { key: string; hash: Hex }): Promise<ClaimReceipt>;
}
export class ServiceSignerError extends Error {
  readonly code: "PROVIDER_ERROR" | "TRANSACTION_FAILED" | "INVALID_INPUT" | "WRONG_STATE";
  readonly hash?: Hex | undefined;
  constructor(code: ServiceSignerError["code"], hash?: Hex) {
    super(`Service signer refused: ${code}`); this.name = "ServiceSignerError"; this.code = code; this.hash = hash;
  }
}
export type ClaimSignerConfig = {
  worker: pg.Pool; rpcUrl: string; chain: Chain; account: LocalAccount;
  companiesHouse: Address; roles: Address; claimer: Address; role: Hex; namespace: string;
};
const CLAIMER = parseAbi([
  "function claim(string namespace, string email, address signer) returns (address safe)",
  "function safeAddressFor(address owner, string namespace, string email) pure returns (address)",
  "event CapxulSafeClaimed(address indexed safe, address indexed signer, bool deployed)",
  "error SwapRefused()", "error EmailNotNormalized()", "error InvalidSigner()",
]);
const ROLES = parseAbi(["function execTransactionWithRole(address to,uint256 value,bytes data,uint8 operation,bytes32 roleKey,bool shouldRevert) returns (bool success)"]);
const revertCode = (name: string): NonNullable<ClaimReceipt["errorCode"]> => name === "SwapRefused" ? "WRONG_STATE" :
  ["EmailNotNormalized", "InvalidSigner"].includes(name) ? "INVALID_INPUT" : "TRANSACTION_FAILED";
type Stored = { hash: Hex; raw_transaction: Hex; request_digest: Hex; safe: Address; signer: Address; attempted: boolean; receipt: ClaimReceipt | null };

export async function migrateServiceSigner(sql: Sql): Promise<void> {
  await sql.query(readFileSync(new URL("./service-signer.sql", import.meta.url), "utf8"));
}

/** Only the configured Companies House claim role; not an actor wallet or arbitrary-transaction port. */
export function claimServiceSigner(config: ClaimSignerConfig): ServiceSigner {
  const { worker, chain, account } = config;
  if (!config.namespace || !/^0x[0-9a-fA-F]{64}$/.test(config.role) ||
      ![config.companiesHouse, config.roles, config.claimer].every((a) => isAddress(a))) throw new ServiceSignerError("INVALID_INPUT");
  const accountId = account.address.toLowerCase();
  const params = (key: string) => [accountId, chain.id, key];
  async function row(sql: Sql, key: string): Promise<Stored | undefined> {
    return (await sql.query("select * from app.service_signer_sends where account=$1 and chain_id=$2 and request_key=$3", params(key))).rows[0];
  }
  return {
    async send(input) {
      // One deadline across preparation and broadcast RPCs; no transport retry, including eth_sendRawTransaction.
      const signal = AbortSignal.timeout(10_000);
      const transport = http(config.rpcUrl, { retryCount: 0, timeout: 10_000, fetchOptions: { signal } });
      const publicClient = createPublicClient({ chain, transport });
      const wallet = createWalletClient({ chain, account, transport });
      if (!/^setup:[a-zA-Z0-9_-]+:[1-9][0-9]*$/.test(input.key) || input.key.length > 256 ||
          !input.email || input.email !== input.email.trim().toLowerCase() || /[^\x00-\x7f]/.test(input.email) ||
          !isAddress(input.signer) || ["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000001", config.companiesHouse.toLowerCase()].includes(input.signer.toLowerCase())) {
        throw new ServiceSignerError("INVALID_INPUT");
      }
      const claim = encodeFunctionData({ abi: CLAIMER, functionName: "claim", args: [config.namespace, input.email, input.signer] });
      const data = encodeFunctionData({ abi: ROLES, functionName: "execTransactionWithRole", args: [config.claimer, 0n, claim, 1, config.role, true] });
      const digest = keccak256(stringToHex(`${config.roles.toLowerCase()}:${config.companiesHouse.toLowerCase()}:${data.toLowerCase()}`));
      let client: pg.PoolClient | undefined, locked = false;
      try {
        client = await worker.connect();
        locked = (await client.query("select pg_try_advisory_lock(hashtextextended($1,7143)) as locked", [accountId])).rows[0].locked;
        if (!locked) throw new ServiceSignerError("WRONG_STATE");
        let stored = await row(client, input.key);
        if (stored && stored.request_digest !== digest) throw new ServiceSignerError("INVALID_INPUT");
        if (!stored) {
          const busy = await client.query("select 1 from app.service_signer_sends where account=$1 and receipt is null limit 1", [accountId]);
          if (busy.rowCount) throw new ServiceSignerError("WRONG_STATE");
          if (await publicClient.getChainId() !== chain.id) throw new ServiceSignerError("PROVIDER_ERROR");
          await publicClient.simulateContract({ account: account.address, address: config.roles, abi: [...ROLES, ...CLAIMER],
            functionName: "execTransactionWithRole", args: [config.claimer, 0n, claim, 1, config.role, true] });
          const safe = await publicClient.readContract({ address: config.claimer, abi: CLAIMER,
            functionName: "safeAddressFor", args: [config.companiesHouse, config.namespace, input.email] });
          const prepared = await wallet.prepareTransactionRequest({ to: config.roles, data, value: 0n });
          const raw = await wallet.signTransaction(prepared);
          const hash = keccak256(raw);
          // Autocommit: signed bytes and hash are durable BEFORE any broadcast admission.
          await client.query(`insert into app.service_signer_sends
            (account,chain_id,request_key,request_digest,raw_transaction,hash,safe,signer) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [...params(input.key), digest, raw, hash, safe, input.signer]);
          stored = (await row(client, input.key))!;
        }
        if (!stored.attempted) {
          if (await publicClient.getChainId() !== chain.id) throw new ServiceSignerError("PROVIDER_ERROR");
          // A crash from this commit onward has an unknown send outcome. Never broadcast it again.
          await client.query("update app.service_signer_sends set attempted=true where account=$1 and chain_id=$2 and request_key=$3", params(input.key));
          try {
            const answer = await publicClient.sendRawTransaction({ serializedTransaction: stored.raw_transaction });
            if (answer.toLowerCase() !== stored.hash.toLowerCase()) throw new Error("hash mismatch");
          } catch { throw new ServiceSignerError("PROVIDER_ERROR", stored.hash); }
        }
        return { hash: stored.hash };
      } catch (error) {
        if (error instanceof ServiceSignerError) throw error;
        const reverted = error instanceof BaseError ? error.walk((e) => e instanceof ContractFunctionRevertedError) : undefined;
        if (reverted instanceof ContractFunctionRevertedError) throw new ServiceSignerError(revertCode(reverted.data?.errorName ?? ""));
        throw new ServiceSignerError("PROVIDER_ERROR");
      } finally {
        if (client) {
          try { if (locked) await client.query("select pg_advisory_unlock(hashtextextended($1,7143))", [accountId]); }
          catch { client.release(true); client = undefined; }
          client?.release();
        }
      }
    },
    async waitForReceipt(input) {
      const signal = AbortSignal.timeout(60_000);
      const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl, { retryCount: 0, timeout: 10_000, fetchOptions: { signal } }) });
      try {
        const stored = await row(worker, input.key);
        if (!stored || stored.hash.toLowerCase() !== input.hash.toLowerCase()) throw new ServiceSignerError("INVALID_INPUT");
        if (stored.receipt) return stored.receipt;
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          let receipt;
          try {
            if (await publicClient.getChainId() !== chain.id) throw new ServiceSignerError("PROVIDER_ERROR");
            receipt = await publicClient.getTransactionReceipt({ hash: stored.hash });
          }
          catch (error) {
            if (!(error instanceof TransactionReceiptNotFoundError) && Date.now() >= deadline) throw error;
          }
          if (receipt) {
            let safe: Address | null = null;
            if (receipt.status === "success") {
              for (const log of receipt.logs.filter((l) => l.address.toLowerCase() === config.companiesHouse.toLowerCase())) {
                try {
                  const decoded = decodeEventLog({ abi: CLAIMER, eventName: "CapxulSafeClaimed", data: log.data, topics: log.topics });
                  if (decoded.args.safe.toLowerCase() === stored.safe.toLowerCase() && decoded.args.signer.toLowerCase() === stored.signer.toLowerCase()) safe = decoded.args.safe;
                } catch { /* An unrelated Companies House log is not a claim. */ }
              }
              if (!safe) throw new ServiceSignerError("TRANSACTION_FAILED", stored.hash);
            }
            let errorCode: ClaimReceipt["errorCode"] = receipt.status === "success" ? null : "TRANSACTION_FAILED";
            if (receipt.status === "reverted") {
              // Optional exact-transaction trace only. Never replay eth_call at block-end and invent a refusal.
              try {
                const response = await fetch(config.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
                  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "debug_traceTransaction", params: [stored.hash, { disableStorage: true, disableStack: true, enableMemory: false }] }) });
                const body = await response.json() as { result?: { returnValue?: string } };
                const raw = body.result?.returnValue;
                if (raw) errorCode = revertCode(decodeErrorResult({ abi: CLAIMER, data: (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex }).errorName);
              } catch { /* Trace unsupported or unknown revert: keep TRANSACTION_FAILED. */ }
            }
            const result: ClaimReceipt = { hash: stored.hash, chainId: chain.id, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
              status: receipt.status, safe, errorCode };
            await worker.query("update app.service_signer_sends set receipt=$4 where account=$1 and chain_id=$2 and request_key=$3", [...params(input.key), result]);
            return result;
          }
          await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, Math.max(0, deadline - Date.now()))));
        }
        throw new ServiceSignerError("PROVIDER_ERROR", stored.hash);
      } catch (error) {
        if (error instanceof ServiceSignerError) throw error;
        throw new ServiceSignerError("PROVIDER_ERROR", input.hash);
      }
    },
  };
}
