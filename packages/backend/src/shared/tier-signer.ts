import type pg from "pg";
import {
  BaseError, ExecutionRevertedError, RawContractError, createPublicClient, createWalletClient, encodeFunctionData, http, isAddress, keccak256,
  parseAbi, parseTransaction, stringToHex, type Address, type Chain, type Hex, type LocalAccount,
} from "viem";
import type { Sql } from "../platform/db.ts";
import { ServiceSignerError } from "./service-signer.ts";

// Companies House's tier key (integration service-signer): a company Safe mint through the tier's company role, and
// Installer.deployMoney. Each send's signed bytes are recorded before broadcast in app.service_signer_sends, beside the
// claim signer's, under one lock per key, so a lost answer is looked up by hash and never signed twice.
export type Officer = { details: string; maxSupply: number };
export type TierSignerConfig = {
  worker: pg.Pool; rpcUrl: string; chain: Chain; account: LocalAccount;
  companiesHouse: Address; companiesHouseRoles: Address; minter: Address; installer: Address;
  /** The tier's company role key (`capxul.company.<tier>`, right-padded) and company namespace. */
  companyRole: Hex; companyNamespace: string;
  /** MoneyDeploy.officers, in Books, Invoicing, People order (blueprint organizations.setups.set-up). */
  officers: readonly Officer[];
};
export type TierReceipt = "success" | "reverted" | "lost" | null;

const ROLES = parseAbi(["function execTransactionWithRole(address to,uint256 value,bytes data,uint8 operation,bytes32 roleKey,bool shouldRevert) returns (bool success)"]);
const MINTER = parseAbi(["function mint(string namespace,string company,address founderSafe) returns (address safe)"]);
export const INSTALLER = parseAbi([
  "struct ThresholdConfig { uint8 thresholdType; uint120 min; uint120 target; }",
  "struct Officer { string details; uint32 maxSupply; }",
  "struct MoneyDeploy { address safe; address founderSafe; address[] coDirectors; ThresholdConfig threshold; Officer[] officers; bytes32 salt; }",
  "struct MoneyDeployment { uint256 boardTopHat; uint256 shareholdersTopHat; uint256 directorHat; uint256[] officerHats; address roles; address gate; }",
  "struct Token { address token; uint128 ceiling; uint8 budgetPeriod; uint128 topAmount; uint256 topHat; }",
  "struct MoneyInstall { address safe; address founderSafe; address[] coDirectors; MoneyDeployment deployment; Token[] tokens; }",
  "struct Call { address to; uint256 value; bytes data; }",
  "function deployMoney(MoneyDeploy p) returns (MoneyDeployment d)",
  "function buildMoney(MoneyInstall p) view returns (Call[] calls)",
]);
const KEY = /^org-setup:[A-Za-z0-9_-]+:(mint|deploy):[0-9]+$/;
const address = (a: string) => isAddress(a) && !/^0x0{40}$/i.test(a);

export function tierServiceSigner(config: TierSignerConfig) {
  const { worker, chain, account } = config;
  if (!config.companyNamespace || !/^0x[0-9a-fA-F]{64}$/.test(config.companyRole) || config.officers.length !== 3 ||
      config.officers.some((o) => !o.details || !Number.isSafeInteger(o.maxSupply) || o.maxSupply < 1) ||
      ![config.companiesHouse, config.companiesHouseRoles, config.minter, config.installer].every(address)) throw new ServiceSignerError("INVALID_INPUT");
  const accountId = account.address.toLowerCase();
  const clients = (ms: number) => {
    const transport = http(config.rpcUrl, { retryCount: 0, timeout: ms, fetchOptions: { signal: AbortSignal.timeout(ms) } });
    return { publicClient: createPublicClient({ chain, transport }), wallet: createWalletClient({ chain, account, transport }) };
  };
  async function send(key: string, to: Address, data: Hex, target: string, founderSafe: string): Promise<{ hash: Hex }> {
    if (!KEY.test(key) || key.length > 256) throw new ServiceSignerError("INVALID_INPUT");
    const { publicClient, wallet } = clients(10_000);
    const digest = keccak256(stringToHex(`${to.toLowerCase()}:${data.toLowerCase()}`));
    let client: pg.PoolClient | undefined, locked = false;
    try {
      client = await worker.connect();
      locked = (await client.query("select pg_try_advisory_lock(hashtextextended($1,7143)) as locked", [accountId])).rows[0].locked;
      if (!locked) throw new ServiceSignerError("WRONG_STATE");
      const row = async (sql: Sql) => (await sql.query("select * from app.service_signer_sends where account=$1 and chain_id=$2 and request_key=$3",
        [accountId, chain.id, key])).rows[0];
      let stored = await row(client);
      if (stored && stored.request_digest !== digest) throw new ServiceSignerError("INVALID_INPUT");
      if (!stored) {
        // One send in flight per key: the claim signer's sends and this one's share the nonce.
        if ((await client.query("select 1 from app.service_signer_sends where account=$1 and receipt is null limit 1", [accountId])).rowCount)
          throw new ServiceSignerError("WRONG_STATE");
        if (await publicClient.getChainId() !== chain.id) throw new ServiceSignerError("PROVIDER_ERROR");
        try { await publicClient.call({ account: account.address, to, data }); }
        catch (error) {
          const revert = error instanceof BaseError && error.walk((e) => e instanceof ExecutionRevertedError || e instanceof RawContractError);
          throw new ServiceSignerError(revert ? "TRANSACTION_FAILED" : "PROVIDER_ERROR");
        }
        const raw = await wallet.signTransaction(await wallet.prepareTransactionRequest({ to, data, value: 0n }));
        await client.query(`insert into app.service_signer_sends (account,chain_id,request_key,request_digest,raw_transaction,hash,safe,signer)
          values ($1,$2,$3,$4,$5,$6,$7,$8)`, [accountId, chain.id, key, digest, raw, keccak256(raw), target.toLowerCase(), founderSafe.toLowerCase()]);
        stored = await row(client);
      }
      if (!stored.attempted) {
        // From this commit on the outcome is unknown: only the same signed bytes are ever broadcast again.
        await client.query("update app.service_signer_sends set attempted=true where account=$1 and chain_id=$2 and request_key=$3", [accountId, chain.id, key]);
        try { await publicClient.sendRawTransaction({ serializedTransaction: stored.raw_transaction }); }
        catch { throw new ServiceSignerError("PROVIDER_ERROR", stored.hash); }
      }
      return { hash: stored.hash };
    } catch (error) {
      if (error instanceof ServiceSignerError) throw error;
      throw new ServiceSignerError("PROVIDER_ERROR");
    } finally {
      if (client) {
        try { if (locked) await client.query("select pg_advisory_unlock(hashtextextended($1,7143))", [accountId]); }
        catch { client.release(true); client = undefined; }
        client?.release();
      }
    }
  }
  return {
    /** CompanySafeMinter.mint by delegatecall from Companies House, through the tier's company role. */
    mint(input: { key: string; handle: string; founderSafe: string }) {
      if (!address(input.founderSafe) || !input.handle) throw new ServiceSignerError("INVALID_INPUT");
      const mint = encodeFunctionData({ abi: MINTER, functionName: "mint", args: [config.companyNamespace, input.handle, input.founderSafe as Address] });
      const data = encodeFunctionData({ abi: ROLES, functionName: "execTransactionWithRole", args: [config.minter, 0n, mint, 1, config.companyRole, true] });
      return send(input.key, config.companiesHouseRoles, data, config.companiesHouse, input.founderSafe);
    },
    /** Installer.deployMoney: the founder as the one Director (1 of 1), the three officers; the salt is the Safe's. */
    deployMoney(input: { key: string; safe: string; founderSafe: string }) {
      if (!address(input.safe) || !address(input.founderSafe)) throw new ServiceSignerError("INVALID_INPUT");
      const data = encodeFunctionData({ abi: INSTALLER, functionName: "deployMoney", args: [{ safe: input.safe as Address,
        founderSafe: input.founderSafe as Address, coDirectors: [], threshold: { thresholdType: 0, min: 1n, target: 1n },
        officers: [...config.officers], salt: keccak256(stringToHex(`capxul:org-setup:${input.safe.toLowerCase()}`)) }] });
      return send(input.key, config.installer, data, input.safe, input.founderSafe);
    },
    /** The send's status once its block is `finality` deep, else null. A receipt frees the key for its next send. Not
     * mined and unknown to the node: the same signed bytes again while its nonce is free, `lost` once another
     * transaction used it. */
    async receipt(input: { hash: string; finality: number }): Promise<TierReceipt> {
      const { publicClient } = clients(10_000);
      try {
        const stored = (await worker.query("select * from app.service_signer_sends where account=$1 and chain_id=$2 and hash=$3",
          [accountId, chain.id, input.hash.toLowerCase()])).rows[0];
        if (!stored) throw new ServiceSignerError("INVALID_INPUT");
        if (stored.receipt?.status === "lost") return "lost";
        if (await publicClient.getChainId() !== chain.id) throw new ServiceSignerError("PROVIDER_ERROR");
        const mined = await publicClient.getTransactionReceipt({ hash: stored.hash }).catch(() => null);
        const mark = (receipt: unknown) => worker.query("update app.service_signer_sends set receipt=$4 where account=$1 and chain_id=$2 and hash=$3",
          [accountId, chain.id, stored.hash, receipt]);
        if (mined) {
          await mark({ status: mined.status, blockNumber: mined.blockNumber.toString(), blockHash: mined.blockHash });
          const head = await publicClient.getBlockNumber({ cacheTime: 0 });
          return head - mined.blockNumber >= BigInt(input.finality) ? mined.status : null;
        }
        if (await publicClient.getTransaction({ hash: stored.hash }).catch(() => null)) return null;
        const nonce = parseTransaction(stored.raw_transaction as Hex).nonce!;
        if (await publicClient.getTransactionCount({ address: account.address, blockTag: "latest" }) > nonce) {
          await mark({ status: "lost" });
          return "lost";
        }
        await mark(null);
        await publicClient.sendRawTransaction({ serializedTransaction: stored.raw_transaction }).catch(() => undefined);
        return null;
      } catch (error) {
        if (error instanceof ServiceSignerError) throw error;
        throw new ServiceSignerError("PROVIDER_ERROR", input.hash as Hex);
      }
    },
  };
}
