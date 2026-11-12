import { formatUnits } from "viem";
import { readFileSync } from "node:fs";
import { record, type Sql } from "../platform/db.ts";
import { enqueue } from "../plugs/door.ts";
import { settleSitePayment } from "../approvals/door.ts";
import type { Owner, Payment } from "./types.ts";
export type { Owner, Payment, PaymentTransitionProps } from "./types.ts";
export { followPayment, approvalTerminal, type PaymentContext, type PaymentFact } from "./lifecycle.ts";
export { prepareCommand, type PrepareCommand, type PrepareContext, type PreparedCommand, type PreparedItem } from "./prepare.ts";

/** Called by the admin migrator inside its existing transaction, never during resume. */
export async function migratePayments(sql: Sql) {
  await sql.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
}

/** An owner-qualified identity is required even for a worker following an outbox event. */
export async function readPayment(sql: Sql, owner: Owner, paymentId: string): Promise<Payment | null> {
  return (await sql.query<Payment>("select * from app.payments where owner_kind=$1 and owner_id=$2 and id=$3", [owner.kind, owner.id, paymentId])).rows[0] ?? null;
}

export async function readCommandPayments(sql: Sql, owner: Owner, commandId: string): Promise<Payment[]> {
  return (await sql.query<Payment>("select * from app.payments where owner_kind=$1 and owner_id=$2 and command_id=$3 order by created_at,id", [owner.kind, owner.id, commandId])).rows;
}

const amount = (v: string) => formatUnits(BigInt(v), 6);
export async function consume(sql: Sql, org: string, chain: number, finality: number) {
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [org]);
  const company = (await sql.query("select * from app.organizations where org_id=$1", [org])).rows[0]!;
  const progress = (await sql.query("select indexed_block from ponder.indexer_progress where chain_id=$1", [chain])).rows[0];
  if (!progress) throw new Error("INDEXER_NOT_READY: no indexed head");
  const cutoff = BigInt(progress.indexed_block) - BigInt(finality);
  const born = await sql.query("select 1 from app.chain_logs where chain_id=$1 and event='CompanySafeMinted' and args->>'safe'=$2 and block_number <= $3", [chain, company.safe, cutoff.toString()]);
  if (!born.rowCount) return; // No operator metadata can manufacture an indexed company birth.
  // A transaction commits its consumed identity, approval settlement, record and delivery sequence together.
  const facts = (await sql.query(`
    select p.log_id,p.block_number,p.log_index,p.tx_hash,p.block_time,'payment_sent' as kind,to_jsonb(p) || jsonb_build_object('amount',p.amount::text) as fact
      from app.chain_payments p where p.chain_id=$2 and p.sender=$3 and p.token=$4 and p.block_number<=$5
    union all
    select t.log_id,t.block_number,t.log_index,t.tx_hash,t.block_time,'transfer_in',to_jsonb(t) || jsonb_build_object('amount',t.amount::text)
      from app.transfers t where t.chain_id=$2 and t.to_address=$3 and t.token=$4 and t.block_number<=$5
    union all
    select l.log_id,l.block_number,l.log_index,l.tx_hash,l.block_time,'hat',to_jsonb(l)
      from app.chain_logs l join app.hats h on h.org_id=$1 and h.hat_id=l.args->>'id'
      where l.chain_id=$2 and l.event='TransferSingle' and l.block_number<=$5
    order by block_number,log_index`, [org, chain, company.safe, company.token, cutoff.toString()])).rows;
  for (const row of facts) {
    const inserted = await sql.query("insert into app.consumed_facts (org_id,log_id) values ($1,$2) on conflict do nothing returning log_id", [org, row.log_id]);
    if (!inserted.rowCount) continue;
    const f = row.fact;
    const traceRow = (await sql.query("select trace from app.transaction_traces where org_id=$1 and tx_hash=$2", [org, row.tx_hash])).rows[0];
    let trace = traceRow?.trace ?? "";
    const time = new Date(Number(row.block_time)).toISOString();
    if (row.kind === "payment_sent") {
      const approval = await settleSitePayment(sql, { org, document_hash: f.document_hash, recipient: f.recipient,
        amount_raw: f.amount, tx_hash: f.tx_hash, trace });
      // A kill before external submission is reported must not lose the originating command's trace.
      if (approval.matched) trace = approval.trace;
      await enqueue(sql, org, row.log_id, "payment_sent", {
        payment_id: f.payment_id, document_hash: f.document_hash, from_safe: f.sender, to: f.recipient,
        amount: amount(f.amount), asset: "USDC", tx_hash: f.tx_hash, block_time: time,
      }, trace);
    } else if (row.kind === "transfer_in") {
      const first = !(await sql.query("select 1 from app.site_events where org_id=$1 and kind in ('founder_capital','deposit_received')", [org])).rowCount;
      const founder = (await sql.query("select * from app.people where org_id=$1 and email=$2", [org, company.admin_email])).rows[0];
      const capital = first && founder;
      await enqueue(sql, org, row.log_id, capital ? "founder_capital" : "deposit_received", {
        to: f.to_address, from: f.from_address, amount: amount(f.amount), asset: "USDC", tx_hash: f.tx_hash, block_time: time,
        ...(capital ? { founder_email: founder.email, founder_name: founder.name } : {}),
      }, trace);
    } else {
      const a = f.args;
      const hat = (await sql.query("select * from app.hats where org_id=$1 and hat_id=$2", [org, a.id])).rows[0]!;
      for (const [kind, wearer] of [["hat_revoked", a.from], ["hat_granted", a.to]]) {
        if (/^0x0{40}$/.test(wearer) || BigInt(a.value) === 0n) continue;
        const person = (await sql.query("select * from app.people where org_id=$1 and coalesce(personal_safe,address)=$2", [org, wearer])).rows[0];
        await enqueue(sql, org, `${row.log_id}:${kind}`, kind, {
          hat: hat.name, person_email: person?.email ?? null, person_name: person?.name ?? null,
          address: wearer, department: hat.department, tx_hash: f.tx_hash,
        }, trace);
      }
    }
    await record(sql, org, "indexed_fact_consumed", trace, { log_id: row.log_id, kind: row.kind, cutoff: cutoff.toString() });
  }
}
