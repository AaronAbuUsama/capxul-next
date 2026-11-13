import { randomUUID } from "node:crypto";
import type { Sql } from "../platform/db.ts";
import { emit } from "../platform/outbox.ts";
import { recordMoneyFact, reverseMoneyFact, type MoneySide } from "../books/door.ts";
import type { Owner } from "./types.ts";

export type MovementSide = "in" | "out";
/** The deployment's admitted token; Ponder indexes only its Transfers. */
export interface MovementToken { address: string; symbol: string; decimals: number }
/** The documents door's store input for a Transfer's Memo (documents.store, basis movement). */
export interface MovementMemo {
  owner_kind: Owner["kind"]; owner_id: string; subject: { kind: "movement"; id: string }; chain_id: number; issued_at: number;
  participants: { party_id: string | null; safe: string; role: "payer" | "payee" }[];
  content: { kind: "memo"; basis: "movement"; reference: string; note: string;
    amount: { token_address: string; decimals: number; amount_raw: string }; source: string; destination: string };
}
export interface MovementContext { at: number; traceId: string; storeMemo: (sql: Sql, memo: MovementMemo) => Promise<unknown> }
export interface TransferWork { log_id: string; block_hash: string }
export interface FollowedTransfer { recorded: number; restored: number; removed: number }
interface Held { side: MovementSide; safe: string; counterparty: string; owner: Owner; party_id: string; counterparty_party: string | null }

async function indexedHead(sql: Sql, chainId: number, finality: number): Promise<bigint> {
  if (!Number.isSafeInteger(chainId) || chainId < 1 || !Number.isSafeInteger(finality) || finality < 0)
    throw new Error("INVALID_INPUT: movement chain and finality");
  const progress = (await sql.query("select indexed_block,ready from app.indexer_progress where chain_id=$1", [chainId])).rows[0];
  if (!progress?.ready) throw new Error("INDEXER_NOT_READY: canonical indexed head required");
  return BigInt(progress.indexed_block);
}

/** Read-only enumeration: new final occurrences touching a Party Safe, and instances whose confirm wait is due. */
export async function listTransferWork(sql: Sql, input: { chainId: number; finality: number; token: string; limit: number }): Promise<TransferWork[]> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000 || !/^0x[0-9a-fA-F]{40}$/.test(input.token))
    throw new Error("INVALID_INPUT: bounded movement work required");
  const head = await indexedHead(sql, input.chainId, input.finality);
  return (await sql.query<TransferWork>(`select log_id,block_hash from (
      select t.log_id,t.block_hash,t.block_number,t.log_index from app.transfers t
        where t.chain_id=$1 and t.token=$2 and t.block_number<=$3
          and exists(select 1 from app.parties d where d.state<>'released' and d.owner_kind is not null
            and d.safe_address in (t.from_address,t.to_address))
          and not exists(select 1 from app.movement_processes p
            where p.chain_id=t.chain_id and p.log_id=t.log_id and p.block_hash=t.block_hash)
      union all
      select log_id,block_hash,block_number,log_index from app.movement_processes where chain_id=$1 and await_block<=$4
    ) w order by block_number,log_index limit $5`,
  [input.chainId, input.token.toLowerCase(), (head - BigInt(input.finality)).toString(), head.toString(), input.limit])).rows;
}

/** K17 and old M1: a side is set aside only by a Payment of that side's own owner beside the Transfer. */
async function heldSides(sql: Sql, t: Record<string, any>): Promise<Held[]> {
  const held: Held[] = [];
  for (const [side, safe, counterparty] of [["out", t.from_address, t.to_address], ["in", t.to_address, t.from_address]] as const) {
    const party = (await sql.query(`select party_id,owner_kind,owner_id from app.parties
      where safe_address=$1 and state<>'released' and owner_kind is not null`, [safe])).rows[0];
    if (!party) continue;
    const explained = (await sql.query(`select 1 from app.chain_payments c join app.payments p
        on p.chain_id=c.chain_id and p.chain_payment_id=c.payment_id
      where c.chain_id=$1 and c.tx_hash=$2 and c.token=$3 and c.amount=$4 and c.sender=$5 and c.recipient=$6
        and (($7::text='out' and p.owner_kind=$8 and p.owner_id=$9) or ($7::text='in' and p.payee_kind=$8 and p.payee_id=$9)) limit 1`,
    [t.chain_id, t.tx_hash, t.token, String(t.amount), t.from_address, t.to_address, side, party.owner_kind, party.owner_id])).rowCount;
    if (explained) continue;
    const other = (await sql.query("select party_id from app.parties where safe_address=$1 and state<>'released'", [counterparty])).rows[0];
    held.push({ side, safe, counterparty, owner: { kind: party.owner_kind, id: party.owner_id }, party_id: party.party_id,
      counterparty_party: other?.party_id ?? null });
  }
  return held;
}

async function transition(sql: Sql, row: { owner_kind: Owner["kind"]; owner_id: string; chain_id: number; tx_hash: string; log_index: number; side: MovementSide },
  name: "record" | "remove" | "restore", from: "recorded" | "removed" | null, to: "recorded" | "removed", context: MovementContext) {
  await emit(sql, { id: randomUUID(), name: "movement_transitioned", machine: "movement",
    entity_id: `${row.chain_id}:${row.tx_hash}:${row.log_index}:${row.side}`, owner_kind: row.owner_kind, owner_id: row.owner_id,
    actor: null, trace_id: context.traceId, at: context.at,
    props: { from, to, transition: name, owner_kind: row.owner_kind, owner_id: row.owner_id, chain_id: row.chain_id,
      tx_hash: row.tx_hash, log_index: row.log_index, side: row.side } });
}

/** One occurrence, one caller worker transaction: instance, then Movements, events and Memo; Books feed locks last. */
export async function followTransfer(sql: Sql, input: { chainId: number; finality: number; token: MovementToken; logId: string; blockHash: string },
  context: MovementContext): Promise<FollowedTransfer> {
  if (!Number.isSafeInteger(context.at) || context.at < 0 || !context.traceId) throw new Error("INVALID_INPUT: movement context");
  const head = await indexedHead(sql, input.chainId, input.finality), depth = BigInt(input.finality), cutoff = head - depth;
  const done: FollowedTransfer = { recorded: 0, restored: 0, removed: 0 };
  const key = [input.chainId, input.logId, input.blockHash.toLowerCase()];
  const fact = (await sql.query("select * from app.transfers where chain_id=$1 and log_id=$2", [input.chainId, input.logId])).rows[0];
  const here = fact && fact.block_hash === key[2] ? fact : null;
  let instance = (await sql.query("select * from app.movement_processes where chain_id=$1 and log_id=$2 and block_hash=$3 for update", key)).rows[0];
  if (!instance) {
    if (!here || BigInt(here.block_number) > cutoff) return done;
    instance = (await sql.query(`insert into app.movement_processes(chain_id,log_id,block_hash,block_number,tx_hash,log_index,trace_id)
      values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing returning *`,
    [...key, String(here.block_number), here.tx_hash, here.log_index, context.traceId])).rows[0];
    if (!instance) return done; // A concurrent instance committed it first.
  }
  const block = BigInt(instance.block_number), ref = `${input.chainId}:${instance.tx_hash}:${instance.log_index}`;
  let wait: bigint | null = null;
  if (block > cutoff) wait = block + depth; // A lagging head never judges an occurrence present or gone.
  else if (here) {
    const sides = here.token === input.token.address.toLowerCase() ? await heldSides(sql, here) : [];
    const books: MoneySide[] = [];
    for (const s of sides) {
      const row = { owner_kind: s.owner.kind, owner_id: s.owner.id, chain_id: input.chainId, tx_hash: here.tx_hash, log_index: here.log_index, side: s.side };
      const old = (await sql.query(`select status from app.movements where owner_id=$1 and owner_kind=$2 and chain_id=$3
        and tx_hash=$4 and log_index=$5 and side=$6 for update`, [s.owner.id, s.owner.kind, input.chainId, here.tx_hash, here.log_index, s.side])).rows[0];
      const fields = [String(here.block_number), here.block_hash, Number(here.block_time), context.at];
      if (!old) {
        await sql.query(`insert into app.movements(owner_id,owner_kind,chain_id,tx_hash,log_index,side,safe,counterparty,token_address,
          amount_raw,block_number,block_hash,block_time,status,created_at,updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'recorded',$14,$14)`,
        [s.owner.id, s.owner.kind, input.chainId, here.tx_hash, here.log_index, s.side, s.safe, s.counterparty, here.token, String(here.amount), ...fields]);
        await transition(sql, row, "record", null, "recorded", context); done.recorded++;
      } else {
        await sql.query(`update app.movements set status='recorded',block_number=$7,block_hash=$8,block_time=$9,updated_at=$10
          where owner_id=$1 and owner_kind=$2 and chain_id=$3 and tx_hash=$4 and log_index=$5 and side=$6`,
        [s.owner.id, s.owner.kind, input.chainId, here.tx_hash, here.log_index, s.side, ...fields]);
        if (old.status === "recorded") continue; // The same Transfer re-included before its old occurrence was judged.
        await transition(sql, row, "restore", "removed", "recorded", context); done.restored++;
      }
      if (s.owner.kind === "organization") books.push({ org_id: s.owner.id, kind: s.side === "in" ? "deposit_received" : "payment_sent_outside",
        direction: s.side, money_key: `transfer:${ref}`, reference: { kind: "movement", id: ref }, source: { kind: "movement", id: ref },
        asset_id: `${input.chainId}:${here.token}`, symbol: input.token.symbol, decimals: input.token.decimals, amount_raw: String(here.amount),
        priced: false, counterparty: s.counterparty, party_id: s.counterparty_party, chain_id: input.chainId,
        block_number: Number(here.block_number), block_time: Number(here.block_time), tx_hash: here.tx_hash, log_index: here.log_index,
        safe_address: s.safe, actor: { kind: "system", id: null } });
    }
    // The Memo is immutable: stored at the first record, replayed by documents' own identity otherwise.
    if (done.recorded) await context.storeMemo(sql, { owner_kind: sides[0]!.owner.kind, owner_id: sides[0]!.owner.id,
      subject: { kind: "movement", id: ref }, chain_id: input.chainId, issued_at: Number(here.block_time),
      participants: sides.map((s) => ({ party_id: s.party_id, safe: s.safe, role: s.side === "out" ? "payer" : "payee" })),
      content: { kind: "memo", basis: "movement", reference: `transfer:${ref}`, note: "",
        amount: { token_address: here.token, decimals: input.token.decimals, amount_raw: String(here.amount) },
        source: here.from_address, destination: here.to_address } });
    if (books.length) await recordMoneyFact(sql, { sides: books }, context);
    const confirmed = block + 2n * depth;
    wait = confirmed > head ? confirmed : null;
  } else {
    // Gone at this block hash: remove only this occurrence's live rows, reverse their book facts, keep the Memo.
    const rows = (await sql.query(`select * from app.movements where chain_id=$1 and tx_hash=$2 and log_index=$3 and block_hash=$4
      and status='recorded' order by owner_kind,owner_id,side for update`, [input.chainId, instance.tx_hash, instance.log_index, key[2]])).rows;
    for (const r of rows) {
      await sql.query(`update app.movements set status='removed',updated_at=$7 where owner_id=$1 and owner_kind=$2 and chain_id=$3
        and tx_hash=$4 and log_index=$5 and side=$6`, [r.owner_id, r.owner_kind, r.chain_id, r.tx_hash, r.log_index, r.side, context.at]);
      await transition(sql, r, "remove", "recorded", "removed", context); done.removed++;
    }
    const orgs = [...new Set(rows.filter((r) => r.owner_kind === "organization").map((r) => r.owner_id as string))];
    if (orgs.length) await reverseMoneyFact(sql, { money_key: `transfer:${ref}`, org_ids: orgs, seen_at: context.at, reason: "reorganized" }, context);
  }
  await sql.query("update app.movement_processes set await_block=$4 where chain_id=$1 and log_id=$2 and block_hash=$3", [...key, wait?.toString() ?? null]);
  return done;
}
