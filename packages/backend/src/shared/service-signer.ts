import { readFileSync } from "node:fs";
import type pg from "pg";
import {
  BaseError, ContractFunctionRevertedError, TransactionNotFoundError, TransactionReceiptNotFoundError, parseTransaction,
  createPublicClient, createWalletClient, decodeErrorResult, decodeEventLog, encodeFunctionData,
  http, isAddress, keccak256, parseAbi, stringToHex, type Address, type Chain, type Hex, type LocalAccount, type PublicClient,
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
  /** The decoded contract error when a simulation reverted, such as Budgets' "NotDue". */
  readonly revert?: string | undefined;
  constructor(code: ServiceSignerError["code"], hash?: Hex, revert?: string) {
    super(`Service signer refused: ${code}`); this.name = "ServiceSignerError"; this.code = code; this.hash = hash; this.revert = revert;
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
export type Stored = { hash: Hex; raw_transaction: Hex; request_digest: Hex; job: string; safe: Address | null; signer: Address | null; scheduled_id: string | null; attempted: boolean; receipt: any };
export type SignerKey = { worker: pg.Pool; rpcUrl: string; chain: Chain; account: LocalAccount };
/** One job's transaction: `prepare` simulates it and names what the row keeps; a revert maps through `revert`. */
export type SignerJob = { key: string; digest: Hex; to: Address; data: Hex; job: string;
  prepare(client: PublicClient): Promise<{ safe?: Address; signer?: Address; scheduledId?: string }>;
  revert(name: string): ServiceSignerError };

export function storedSend(sql: Sql, key: SignerKey, requestKey: string): Promise<Stored | undefined> {
  return sql.query("select * from app.service_signer_sends where account=$1 and chain_id=$2 and request_key=$3",
    [key.account.address.toLowerCase(), key.chain.id, requestKey]).then((r) => r.rows[0]);
}
export async function saveReceipt(key: SignerKey, requestKey: string, receipt: unknown): Promise<void> {
  await key.worker.query("update app.service_signer_sends set receipt=$4 where account=$1 and chain_id=$2 and request_key=$3",
    [key.account.address.toLowerCase(), key.chain.id, requestKey, receipt]);
}

/**
 * The identical signed bytes again, only when no node knows the transaction and its nonce is still open
 * (integrations.signer-rebroadcast): the same hash can be mined at most once, so this never sends a second transaction.
 */
export async function rebroadcastIfDropped(client: PublicClient, stored: Pick<Stored, "hash" | "raw_transaction" | "attempted">, account: Address): Promise<void> {
  if (!stored.attempted) return;
  try { await client.getTransaction({ hash: stored.hash }); return; }
  catch (error) { if (!(error instanceof TransactionNotFoundError)) return; }
  const nonce = parseTransaction(stored.raw_transaction).nonce;
  if (nonce === undefined || await client.getTransactionCount({ address: account, blockTag: "pending" }) > nonce) return;
  try { await client.sendRawTransaction({ serializedTransaction: stored.raw_transaction }); } catch { /* Looked up again on the next poll. */ }
}

/**
 * One send in flight per key; the signed bytes and hash are durable before any broadcast, a lost answer is looked up by
 * hash and never sent twice (CAP-1097). A simulation revert or an outage before signing records nothing.
 */
export async function durableSend(key: SignerKey, job: SignerJob): Promise<{ hash: Hex }> {
  const { worker, chain, account } = key;
  const accountId = account.address.toLowerCase();
  const params = [accountId, chain.id, job.key];
  // One deadline across preparation and broadcast RPCs; no transport retry, including eth_sendRawTransaction.
  const signal = AbortSignal.timeout(10_000);
  const transport = http(key.rpcUrl, { retryCount: 0, timeout: 10_000, fetchOptions: { signal } });
  const publicClient = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ chain, account, transport });
  let client: pg.PoolClient | undefined, locked = false;
  try {
    client = await worker.connect();
    locked = (await client.query("select pg_try_advisory_lock(hashtextextended($1,7143)) as locked", [accountId])).rows[0].locked;
    if (!locked) throw new ServiceSignerError("WRONG_STATE");
    // Each key does one job: a key configured for two jobs would share one lane and misread the other's rows.
    if ((await client.query("select 1 from app.service_signer_sends where account=$1 and job<>$2 limit 1", [accountId, job.job])).rowCount) throw new ServiceSignerError("INVALID_INPUT");
    let stored = await storedSend(client, key, job.key);
    if (stored && stored.request_digest !== job.digest) throw new ServiceSignerError("INVALID_INPUT");
    if (!stored) {
      const busy = await client.query("select 1 from app.service_signer_sends where account=$1 and receipt is null limit 1", [accountId]);
      if (busy.rowCount) throw new ServiceSignerError("WRONG_STATE");
      if (await publicClient.getChainId() !== chain.id) throw new ServiceSignerError("PROVIDER_ERROR");
      const kept = await job.prepare(publicClient as PublicClient);
      const prepared = await wallet.prepareTransactionRequest({ to: job.to, data: job.data, value: 0n });
      const raw = await wallet.signTransaction(prepared);
      const hash = keccak256(raw);
      // Autocommit: signed bytes and hash are durable BEFORE any broadcast admission.
      await client.query(`insert into app.service_signer_sends
        (account,chain_id,request_key,request_digest,raw_transaction,hash,safe,signer,job,scheduled_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [...params, job.digest, raw, hash, kept.safe ?? null, kept.signer ?? null, job.job, kept.scheduledId ?? null]);
      stored = (await storedSend(client, key, job.key))!;
    }
    if (!stored.attempted) {
      if (await publicClient.getChainId() !== chain.id) throw new ServiceSignerError("PROVIDER_ERROR");
      // A crash from this commit onward has an unknown send outcome. Never broadcast it again.
      await client.query("update app.service_signer_sends set attempted=true where account=$1 and chain_id=$2 and request_key=$3", params);
      try {
        const answer = await publicClient.sendRawTransaction({ serializedTransaction: stored.raw_transaction });
        if (answer.toLowerCase() !== stored.hash.toLowerCase()) throw new Error("hash mismatch");
      } catch { throw new ServiceSignerError("PROVIDER_ERROR", stored.hash); }
    }
    return { hash: stored.hash };
  } catch (error) {
    if (error instanceof ServiceSignerError) throw error;
    const reverted = error instanceof BaseError ? error.walk((e) => e instanceof ContractFunctionRevertedError) : undefined;
    if (reverted instanceof ContractFunctionRevertedError) throw job.revert(reverted.data?.errorName ?? "");
    throw new ServiceSignerError("PROVIDER_ERROR");
  } finally {
    if (client) {
      try { if (locked) await client.query("select pg_advisory_unlock(hashtextextended($1,7143))", [accountId]); }
      catch { client.release(true); client = undefined; }
      client?.release();
    }
  }
}

export async function migrateServiceSigner(sql: Sql): Promise<void> {
  await sql.query(readFileSync(new URL("./service-signer.sql", import.meta.url), "utf8"));
}

/** Only the configured Companies House claim role; not an actor wallet or arbitrary-transaction port. */
export function claimServiceSigner(config: ClaimSignerConfig): ServiceSigner {
  const { worker, chain, account } = config;
  if (!config.namespace || !/^0x[0-9a-fA-F]{64}$/.test(config.role) ||
      ![config.companiesHouse, config.roles, config.claimer].every((a) => isAddress(a))) throw new ServiceSignerError("INVALID_INPUT");
  const row = (sql: Sql, key: string) => storedSend(sql, config, key);
  return {
    async send(input) {
      if (!/^setup:[a-zA-Z0-9_-]+:[1-9][0-9]*$/.test(input.key) || input.key.length > 256 ||
          !input.email || input.email !== input.email.trim().toLowerCase() || /[^\x00-\x7f]/.test(input.email) ||
          !isAddress(input.signer) || ["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000001", config.companiesHouse.toLowerCase()].includes(input.signer.toLowerCase())) {
        throw new ServiceSignerError("INVALID_INPUT");
      }
      const claim = encodeFunctionData({ abi: CLAIMER, functionName: "claim", args: [config.namespace, input.email, input.signer] });
      const data = encodeFunctionData({ abi: ROLES, functionName: "execTransactionWithRole", args: [config.claimer, 0n, claim, 1, config.role, true] });
      const digest = keccak256(stringToHex(`${config.roles.toLowerCase()}:${config.companiesHouse.toLowerCase()}:${data.toLowerCase()}`));
      return durableSend(config, { key: input.key, digest, to: config.roles, data, job: "companies-house-claim",
        revert: (name) => new ServiceSignerError(revertCode(name), undefined, name),
        async prepare(publicClient) {
          await publicClient.simulateContract({ account: account.address, address: config.roles, abi: [...ROLES, ...CLAIMER],
            functionName: "execTransactionWithRole", args: [config.claimer, 0n, claim, 1, config.role, true] });
          const safe = await publicClient.readContract({ address: config.claimer, abi: CLAIMER,
            functionName: "safeAddressFor", args: [config.companiesHouse, config.namespace, input.email] });
          return { safe, signer: input.signer };
        } });
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
          if (!receipt) await rebroadcastIfDropped(publicClient as PublicClient, stored, account.address).catch(() => {});
          if (receipt) {
            let safe: Address | null = null;
            if (receipt.status === "success") {
              for (const log of receipt.logs.filter((l) => l.address.toLowerCase() === config.companiesHouse.toLowerCase())) {
                try {
                  const decoded = decodeEventLog({ abi: CLAIMER, eventName: "CapxulSafeClaimed", data: log.data, topics: log.topics });
                  if (decoded.args.safe.toLowerCase() === stored.safe?.toLowerCase() && decoded.args.signer.toLowerCase() === stored.signer?.toLowerCase()) safe = decoded.args.safe;
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
            await saveReceipt(config, input.key, result);
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
