import pg from "pg";
import { fileURLToPath } from "node:url";
import { required } from "./platform/config.ts";
import type { Sql } from "./platform/db.ts";

/** Explicit migration after Ponder creates its tables; never on service resume. */
export async function bindIndexer(sql: Sql) {
  const safe = (column: string) => `exists (select 1 from app.parties d
    where d.owner_kind=current_setting('app.owner_kind',true) and d.owner_id=current_setting('app.owner_id',true)
    and d.state<>'released' and d.safe_address=${column})`;
  const anySafe = (column: string) => `exists (select 1 from app.parties d
    where d.owner_kind=current_setting('app.owner_kind',true) and d.owner_id=current_setting('app.owner_id',true)
    and d.state<>'released' and d.safe_address=any(${column}))`;
  const views = {
    chain_payments: `(${safe("p.sender")} or ${safe("p.recipient")})`,
    transfers: `(${safe("p.from_address")} or ${safe("p.to_address")})`,
    chain_logs: anySafe("p.safes"),
    user_operations: safe("p.sender"),
    safe_owners: `(${safe("p.safe_address")} or ${anySafe("p.owners")} or ${safe("p.agent_owner")})`,
    safe_approvals: `(${safe("p.safe_address")} or ${safe("p.owner")})`,
    safe_executions: safe("p.safe_address"),
    chain_hats: safe("p.company_safe"),
    hat_wearers: `(${safe("p.company_safe")} or ${safe("p.wearer")})`,
    chain_budgets: safe("p.company_safe"),
  };
  for (const [table, scope] of Object.entries(views)) {
    // The security barrier and explicit session scope remain effective even though the view owner reads raw facts.
    await sql.query(`create or replace view app.${table} with (security_barrier=true) as select p.* from ponder.${table} p
      where current_user='capxul_worker' or ${scope}`);
    await sql.query(`revoke all on app.${table} from public,capxul_core,capxul_worker`);
    await sql.query(`grant select on app.${table} to capxul_core,capxul_worker`);
  }
  // Ponder owns these status rows; do not manufacture readiness in a historical block handler.
  await sql.query(`create or replace view app.indexer_progress with (security_barrier=true) as
    select p.chain_id,p.indexed_block,p.indexed_block_hash,p.indexed_block_time,
      substring(c.latest_checkpoint,27,16)::numeric as head_block,
      (m.value->>'heartbeat_at')::double precision as head_seen_at,
      (m.value->>'is_ready')::integer=1 and (m.value->>'is_locked')::integer=1
        and (m.value->>'heartbeat_at')::double precision > extract(epoch from clock_timestamp())*1000-60000 as ready,
      m.value->>'build_id' as build_id,(m.value->>'heartbeat_at')::double precision as updated_at
    from ponder.indexer_progress p join ponder._ponder_checkpoint c on c.chain_id=p.chain_id
    cross join ponder._ponder_meta m where m.key='app'`);
  await sql.query("revoke all on app.indexer_progress from public,capxul_core,capxul_worker");
  await sql.query("grant select on app.indexer_progress to capxul_core,capxul_worker");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const admin = new URL(required("PG_ADMIN_URL"));
  admin.pathname = new URL(required("DATABASE_URL")).pathname;
  const db = new pg.Client({ connectionString: admin.href });
  await db.connect();
  try {
    await db.query("begin");
    await bindIndexer(db);
    await db.query("commit");
    console.log("Ponder facts bound through Party-owner scoped read-only views");
  } catch (error) { await db.query("rollback"); throw error; }
  finally { await db.end(); }
}
