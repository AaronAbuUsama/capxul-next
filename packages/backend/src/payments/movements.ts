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

interface Side { side: MovementSide; safe: string; counterparty: string; owner: Owner; party_id: string; counterparty_party: string | null }

/**
 * The PaymentSent that carries this Transfer, if any: in the transaction's receipt order, each PaymentSent takes the
 * latest earlier untaken Transfer with its sender, recipient, token and amount (Payments pulls from its caller straight
 * to the recipient, then emits). One PaymentSent explains at most one Transfer, so a plain transfer beside it stays outside.
 */
async function carriedBy(sql: Sql, t: Record<string, any>): Promise<string | null> {
  const terms = [t.chain_id, t.tx_hash, t.token, String(t.amount), t.from_address, t.to_address];
  const sent = (await sql.query(`select payment_id,tx_log_ordinal from app.chain_payments where chain_id=$1 and tx_hash=$2
    and token=$3 and amount=$4 and sender=$5 and recipient=$6`, terms)).rows;
  if (!sent.length) return null;
  const moved = (await sql.query(`select log_id,tx_log_ordinal from app.transfers where chain_id=$1 and tx_hash=$2
    and token=$3 and amount=$4 and from_address=$5 and to_address=$6`, terms)).rows;
  const logs = [...moved.map((r) => ({ at: r.tx_log_ordinal, transfer: r.log_id as string })),
    ...sent.map((r) => ({ at: r.tx_log_ordinal, payment: r.payment_id as string }))].sort((a, b) => a.at - b.at);
  const open: string[] = [];
  for (const log of logs) {
    if ("transfer" in log) open.push(log.transfer!);
    else { const taken = open.pop(); if (taken === t.log_id) return log.payment!; }
  }
  return null;
}

/**
 * Both Capxul sides of the Transfer, and which of them are held: K17 and old M1, a side is set aside only by the Payment
 * that carries this Transfer when it is that side's owner's (as payer for `out`; as payee for `in`, which holds because
 * prepare fixes every Payment's executor to its payer Safe, so its PaymentSent's sender is that Safe).
 */
async function sidesOf(sql: Sql, t: Record<string, any>): Promise<{ all: Side[]; held: Side[] }> {
  const all: Side[] = [], held: Side[] = [];
  const payment = await carriedBy(sql, t);
  for (const [side, safe, counterparty] of [["out", t.from_address, t.to_address], ["in", t.to_address, t.from_address]] as const) {
    const party = (await sql.query(`select party_id,owner_kind,owner_id from app.parties
      where safe_address=$1 and state<>'released' and owner_kind is not null`, [safe])).rows[0];
    if (!party) continue;
    const other = (await sql.query("select party_id from app.parties where safe_address=$1 and state<>'released'", [counterparty])).rows[0];
    const s: Side = { side, safe, counterparty, owner: { kind: party.owner_kind, id: party.owner_id }, party_id: party.party_id,
      counterparty_party: other?.party_id ?? null };
    all.push(s);
    const explained = payment !== null && (await sql.query(`select 1 from app.payments where chain_id=$1 and chain_payment_id=$2
      and (($3::text='out' and owner_kind=$4 and owner_id=$5) or ($3::text='in' and payee_kind=$4 and payee_id=$5))`,
    [t.chain_id, payment, side, party.owner_kind, party.owner_id])).rowCount;
    if (!explained) held.push(s);
  }
  return { all, held };
}

async function transition(sql: Sql, row: { owner_kind: Owner["kind"]; owner_id: string; chain_id: number; log_id: string; tx_hash: string; log_index: number; side: MovementSide },
  name: "record" | "remove" | "restore", from: "recorded" | "removed" | null, to: "recorded" | "removed", context: MovementContext) {
  // The receipt-ordinal log id survives re-inclusion at another position; the block-global log index does not.
  await emit(sql, { id: randomUUID(), name: "movement_transitioned", machine: "movement",
    entity_id: `${row.log_id}:${row.side}`, owner_kind: row.owner_kind, owner_id: row.owner_id,
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
  const block = BigInt(instance.block_number), ref = input.logId;
  let wait: bigint | null = null;
  if (block > cutoff) wait = block + depth; // A lagging head never judges an occurrence present or gone.
  else if (here) {
    const { all, held } = here.token === input.token.address.toLowerCase() ? await sidesOf(sql, here) : { all: [], held: [] };
    // Money between two Safes of one owner neither arrives nor leaves: Movements for Activity, no book fact.
    const internal = all.length === 2 && all[0]!.owner.kind === all[1]!.owner.kind && all[0]!.owner.id === all[1]!.owner.id;
    const books: MoneySide[] = [];
    let waiting = false;
    for (const s of held) {
      const row = { owner_kind: s.owner.kind, owner_id: s.owner.id, chain_id: input.chainId, log_id: ref, tx_hash: here.tx_hash, log_index: here.log_index, side: s.side };
      const old = (await sql.query(`select * from app.movements where owner_id=$1 and owner_kind=$2 and log_id=$3 and side=$4 for update`,
        [s.owner.id, s.owner.kind, ref, s.side])).rows[0];
      const terms = [s.safe, s.counterparty, String(here.amount), here.log_index, String(here.block_number), here.block_hash, Number(here.block_time), context.at];
      if (!old) {
        await sql.query(`insert into app.movements(owner_id,owner_kind,chain_id,log_id,tx_hash,side,token_address,
          safe,counterparty,amount_raw,log_index,block_number,block_hash,block_time,status,created_at,updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'recorded',$15,$15)`,
        [s.owner.id, s.owner.kind, input.chainId, ref, here.tx_hash, s.side, here.token, ...terms]);
        await transition(sql, row, "record", null, "recorded", context); done.recorded++;
      } else if (old.status === "recorded") {
        // The same occurrence re-included before its old block was judged: it moves along only with the same terms;
        // otherwise it waits for the old occurrence's removal, so its book fact is reversed before the new one is written.
        if (old.safe !== s.safe || old.counterparty !== s.counterparty || old.amount_raw !== String(here.amount)) { waiting = true; continue; }
        await sql.query(`update app.movements set log_index=$5,block_number=$6,block_hash=$7,block_time=$8,updated_at=$9
          where owner_id=$1 and owner_kind=$2 and log_id=$3 and side=$4`, [s.owner.id, s.owner.kind, ref, s.side, ...terms.slice(3)]);
        continue;
      } else {
        await sql.query(`update app.movements set status='recorded',safe=$5,counterparty=$6,amount_raw=$7,log_index=$8,block_number=$9,
          block_hash=$10,block_time=$11,updated_at=$12 where owner_id=$1 and owner_kind=$2 and log_id=$3 and side=$4`,
        [s.owner.id, s.owner.kind, ref, s.side, ...terms]);
        await transition(sql, row, "restore", "removed", "recorded", context); done.restored++;
      }
      if (s.owner.kind === "organization" && !internal) books.push({ org_id: s.owner.id, kind: s.side === "in" ? "deposit_received" : "payment_sent_outside",
        direction: s.side, money_key: `transfer:${ref}`, reference: { kind: "movement", id: ref }, source: { kind: "movement", id: ref },
        asset_id: `${input.chainId}:${here.token}`, symbol: input.token.symbol, decimals: input.token.decimals, amount_raw: String(here.amount),
        priced: false, counterparty: s.counterparty, party_id: s.counterparty_party, chain_id: input.chainId,
        block_number: Number(here.block_number), block_time: Number(here.block_time), tx_hash: here.tx_hash, log_index: here.log_index,
        safe_address: s.safe, actor: { kind: "system", id: null } });
    }
    // The Memo is immutable: stored at the first record, with every Capxul side of the Transfer as a participant.
    if (done.recorded) await context.storeMemo(sql, { owner_kind: held[0]!.owner.kind, owner_id: held[0]!.owner.id,
      subject: { kind: "movement", id: ref }, chain_id: input.chainId, issued_at: Number(here.block_time),
      participants: all.map((s) => ({ party_id: s.party_id, safe: s.safe, role: s.side === "out" ? "payer" : "payee" })),
      content: { kind: "memo", basis: "movement", reference: `transfer:${ref}`, note: "",
        amount: { token_address: here.token, decimals: input.token.decimals, amount_raw: String(here.amount) },
        source: here.from_address, destination: here.to_address } });
    if (books.length) await recordMoneyFact(sql, { sides: books }, context);
    const confirmed = block + 2n * depth;
    wait = waiting ? head + 1n : confirmed > head ? confirmed : null;
  } else {
    // Gone at this block hash: remove only this occurrence's live rows, reverse their book facts, keep the Memo.
    const rows = (await sql.query(`select * from app.movements where log_id=$1 and block_hash=$2
      and status='recorded' order by owner_kind,owner_id,side for update`, [ref, key[2]])).rows;
    for (const r of rows) {
      await sql.query(`update app.movements set status='removed',updated_at=$5 where owner_id=$1 and owner_kind=$2 and log_id=$3 and side=$4`,
        [r.owner_id, r.owner_kind, ref, r.side, context.at]);
      await transition(sql, r, "remove", "recorded", "removed", context); done.removed++;
    }
    const orgs = [...new Set(rows.filter((r) => r.owner_kind === "organization").map((r) => r.owner_id as string))];
    if (orgs.length) await reverseMoneyFact(sql, { money_key: `transfer:${ref}`, org_ids: orgs, seen_at: context.at, reason: "reorganized" }, context);
  }
  await sql.query("update app.movement_processes set await_block=$4 where chain_id=$1 and log_id=$2 and block_hash=$3", [...key, wait?.toString() ?? null]);
  return done;
}
