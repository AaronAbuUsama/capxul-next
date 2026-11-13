import type { Sql } from "../platform/db.ts";
import { address, atOrCutoff, companyScope, hatKey, indexedCutoff } from "./head.ts";

export interface HatFact {
  hat_id: string; company_safe: string; tree: string; admin_hat_id: string | null; level: number; details: string;
  max_supply: string; supply: string; eligibility: string; toggle: string; active: boolean; mutable: boolean; updated_block: string;
}
export interface HatWearerFact { wearer: string; holds: boolean; standing: boolean; wearing: boolean; since_block: string; updated_block: string }
/** `wearing` is null (unknown) for a hat ruled by a module: read `isWearerOfHat` live for it. */
export interface WearerHatFact { hat_id: string; details: string; wearing: boolean | null; updated_block: string }
export interface HatTransferInTx { log_id: string; log_index: number; tx_log_ordinal: number; operator: string; from: string; to: string; value: string }

const decimal = (key: string | null) => key === null ? null : BigInt(key).toString();
const unchanged = (table: string, updated: unknown, at: bigint) => {
  if (BigInt(String(updated)) > at) throw new Error(`HISTORICAL_UNAVAILABLE: ${table} changed after block ${at}`);
};
/** A module eligibility or toggle (an Elections clone) moves wearers and status with no Hats event: read isWearerOfHat live. */
const evented = (hatId: string, live: boolean) => {
  if (live) throw new Error(`HISTORICAL_UNAVAILABLE: hat ${BigInt(hatId)} is ruled by a module; read Hats live`);
};

/** The current hat row only if it has not changed after atBlock (default: the finalized cutoff). */
export async function readHatAt(sql: Sql, input: { chainId: number; hatId: string; atBlock?: string; finality: number }): Promise<HatFact | null> {
  const key = hatKey(input.hatId);
  await companyScope(sql);
  const at = atOrCutoff(await indexedCutoff(sql, input.chainId, input.finality), input.atBlock);
  const row = (await sql.query("select * from app.chain_hats where chain_id=$1 and hat_id=$2", [input.chainId, key])).rows[0];
  if (!row) return null;
  unchanged("chain-hats", row.updated_block, at);
  evented(row.hat_id, row.live);
  return { hat_id: decimal(row.hat_id)!, company_safe: row.company_safe, tree: row.tree, admin_hat_id: decimal(row.admin_hat_id),
    level: row.level, details: row.details, max_supply: String(row.max_supply), supply: String(row.supply), eligibility: row.eligibility,
    toggle: row.toggle, active: row.active, mutable: row.mutable, updated_block: String(row.updated_block) };
}

/** Every wearer row of the hat, only if none changed after atBlock: a later change could hide an earlier wearer. */
export async function readHatWearersAt(sql: Sql, input: { chainId: number; hatId: string; atBlock?: string; finality: number }): Promise<HatWearerFact[]> {
  const key = hatKey(input.hatId);
  await companyScope(sql);
  const at = atOrCutoff(await indexedCutoff(sql, input.chainId, input.finality), input.atBlock);
  const hat = (await sql.query("select live from app.chain_hats where chain_id=$1 and hat_id=$2", [input.chainId, key])).rows[0];
  if (hat) evented(key, hat.live);
  const rows = (await sql.query("select * from app.hat_wearers where chain_id=$1 and hat_id=$2 order by wearer", [input.chainId, key])).rows;
  for (const row of rows) unchanged("hat-wearers", row.updated_block, at);
  return rows.map((r) => ({ wearer: r.wearer, holds: r.holds, standing: r.standing, wearing: r.wearing,
    since_block: String(r.since_block), updated_block: String(r.updated_block) }));
}

/**
 * One wearer's hats in one company with their details, only if neither the wearer row nor its hat changed after atBlock.
 * A module-ruled hat stays in the list with `wearing: null`, so the caller reads only that hat live.
 */
export async function readWearerHatsAt(sql: Sql, input: { chainId: number; wearer: string; companySafe: string; atBlock?: string; finality: number }): Promise<WearerHatFact[]> {
  const wearer = address(input.wearer, "wearer"), company = address(input.companySafe, "company Safe");
  await companyScope(sql);
  const at = atOrCutoff(await indexedCutoff(sql, input.chainId, input.finality), input.atBlock);
  const rows = (await sql.query(`select w.hat_id,h.details,w.wearing,w.updated_block,h.updated_block as hat_block,h.live
    from app.hat_wearers w join app.chain_hats h on h.chain_id=w.chain_id and h.hat_id=w.hat_id
    where w.chain_id=$1 and w.wearer=$2 and w.company_safe=$3 order by w.hat_id`, [input.chainId, wearer, company])).rows;
  for (const row of rows) { unchanged("hat-wearers", row.updated_block, at); unchanged("chain-hats", row.hat_block, at); }
  return rows.map((r) => ({ hat_id: decimal(r.hat_id)!, details: r.details, wearing: r.live ? null : r.wearing, updated_block: String(r.updated_block) }));
}

/** Every finalized Hats TransferSingle of that hat in one transaction, in log order. */
export async function readHatTransfersInTx(sql: Sql, input: { chainId: number; txHash: string; hatId: string; finality: number }): Promise<HatTransferInTx[]> {
  if (typeof input.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input.txHash)) throw new Error("INVALID_INPUT: transaction hash");
  const hatId = BigInt(hatKey(input.hatId)).toString();
  const cutoff = await indexedCutoff(sql, input.chainId, input.finality);
  return (await sql.query(`select log_id,log_index,tx_log_ordinal,args from app.chain_logs where chain_id=$1 and tx_hash=$2
    and contract='hats' and event='TransferSingle' and block_number<=$3 order by log_index`,
  [input.chainId, input.txHash.toLowerCase(), cutoff.toString()])).rows
    .filter((r) => BigInt(r.args.id).toString() === hatId)
    .map((r) => ({ log_id: r.log_id, log_index: r.log_index, tx_log_ordinal: r.tx_log_ordinal, operator: r.args.operator,
      from: r.args.from, to: r.args.to, value: String(r.args.value) }));
}
