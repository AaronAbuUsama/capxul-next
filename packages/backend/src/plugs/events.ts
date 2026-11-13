import { record, type Sql } from "../platform/db.ts";

/** Internal to plugs: the door and the role projections both enqueue here, so neither imports the other's module. */
export async function enqueue(sql: Sql, org: string, key: string, kind: string, data: unknown, trace: string, at: number) {
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [org]);
  const old = await sql.query("select seq from app.site_events where org_id=$1 and event_key=$2", [org, key]);
  if (old.rowCount) return old.rows[0]!.seq;
  const row = (await sql.query("update app.organizations set next_seq=next_seq+1 where org_id=$1 returning next_seq-1 as seq", [org])).rows[0];
  if (!row) throw new Error("NOT_FOUND: cannot enqueue for unknown company");
  await sql.query("insert into app.site_events (org_id,seq,event_key,kind,data,trace) values ($1,$2,$3,$4,$5,$6)", [org, row.seq, key, kind, data, trace]);
  await record(sql, org, "site_event_queued", trace, { seq: row.seq, event_key: key, kind }, at);
  return row.seq;
}
