import { createHmac } from "node:crypto";
import { Effect, Result } from "effect";
import { record, type Database, type Sql } from "../platform/db.ts";
import { createFrappeSite } from "./site.ts";
export { RequestCollector } from "./collector.ts";
export { FrappeSite, FrappeSiteError, createFrappeSite, frappeSiteLayer } from "./site.ts";
export type { AccountInput, DoorInput, ReportInput, SiteInput } from "./site.ts";

export async function enqueue(sql: Sql, org: string, key: string, kind: string, data: unknown, trace: string) {
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [org]);
  const old = await sql.query("select seq from app.site_events where org_id=$1 and event_key=$2", [org, key]);
  if (old.rowCount) return old.rows[0]!.seq;
  const row = (await sql.query("update app.organizations set next_seq=next_seq+1 where org_id=$1 returning next_seq-1 as seq", [org])).rows[0];
  if (!row) throw new Error("NOT_FOUND: cannot enqueue for unknown company");
  await sql.query("insert into app.site_events (org_id,seq,event_key,kind,data,trace) values ($1,$2,$3,$4,$5,$6)", [org, row.seq, key, kind, data, trace]);
  await record(sql, org, "site_event_queued", trace, { seq: row.seq, event_key: key, kind });
  return row.seq;
}
export async function status(sql: Sql, org: string) {
  const row = (await sql.query("select released,next_seq-1 as last_seq,last_ack from app.organizations where org_id=$1", [org])).rows[0];
  if (!row) throw new Error("NOT_FOUND: unknown company");
  const events = (await sql.query("select seq,event_key,kind,state,attempts,last_error,applied_at from app.site_events where org_id=$1 order by seq", [org])).rows;
  return { slug: org, ...row, pending: events.filter((e) => e.state === "pending"), events };
}
export async function resend(sql: Sql, org: string, from: number) {
  const row = (await sql.query("select next_seq from app.organizations where org_id=$1 for update", [org])).rows[0];
  if (!row || !Number.isSafeInteger(from) || from < 1 || from > Number(row.next_seq)) throw new Error("INVALID_INPUT: resend sequence outside company stream");
  await sql.query("update app.site_events set state='pending',applied_at=null where org_id=$1 and seq >= $2 and state != 'parked'", [org, from]);
  await sql.query("update app.organizations set last_ack=$2-1,retry_at=null,failures=0 where org_id=$1", [org, from]);
  return status(sql, org);
}
export function signature(body: string, secret: string) { return createHmac("sha256", secret).update(body).digest("hex"); }

export async function retryParked(sql: Sql, org: string, key: string, frappe: string, secret: string) {
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [org]);
  const event = (await sql.query("select e.*,o.site from app.site_events e join app.organizations o using (org_id) where e.org_id=$1 and e.event_key=$2 for update of e", [org, key])).rows[0];
  if (!event) throw new Error("NOT_FOUND: unknown parked event");
  if (event.state !== "parked") return status(sql, org);
  const ack = await Effect.runPromise(createFrappeSite({ baseUrl: frappe, secret }).retryParkedEvent({
    orgId: org, site: event.site, traceId: event.trace, event_key: key,
  }));
  if (ack.parked || ack.last_seq < Number(event.seq)) throw new Error("REPAIR_FAILED: site has not applied parked money event");
  await sql.query("update app.site_events set state='applied',last_error=null,applied_at=now(),map_version=$3 where org_id=$1 and event_key=$2", [org, key, ack.map_version ?? null]);
  await record(sql, org, "site_event_repaired", event.trace, { event_key: key, seq: event.seq });
  return status(sql, org);
}

export async function deliver(db: Database, org: string, frappe: string, secret: string) {
  return db.transaction(org, async (sql) => {
    // One in-flight delivery per company across processes. A crash releases this lock and rolls back the ack.
    await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [org]);
    const company = (await sql.query("select * from app.organizations where org_id=$1 for update", [org])).rows[0]!;
    if (!company.released || company.retry_at && new Date(company.retry_at).getTime() > Date.now()) return;
    const event = (await sql.query("select * from app.site_events where org_id=$1 and state='pending' order by seq limit 1 for update", [org])).rows[0];
    if (!event) return;
    await sql.query("update app.site_events set attempts=attempts+1,last_attempt_at=now() where org_id=$1 and seq=$2", [org, event.seq]);
    try {
      const result = await Effect.runPromise(Effect.result(createFrappeSite({ baseUrl: frappe, secret }).applyEvent({
        orgId: org, site: company.site, traceId: event.trace,
        event_key: event.event_key, seq: Number(event.seq), kind: event.kind, data: event.data,
      })));
      if (Result.isFailure(result)) {
        const { expected } = result.failure;
        if (result.failure.code !== "WRONG_STATE" || expected === undefined) throw result.failure;
        if (expected >= Number(event.seq)) throw new Error("invalid site cursor acknowledgement");
        await sql.query("update app.site_events set state=case when seq<$2 then 'applied' else 'pending' end where org_id=$1 and state!='parked'", [org, expected]);
        await sql.query("update app.organizations set last_ack=$2-1,retry_at=null where org_id=$1", [org, expected]);
        return;
      }
      const ack = result.success;
      if (ack.last_seq < Number(event.seq) || ack.last_seq >= Number(company.next_seq)) {
        throw new Error(`site did not acknowledge sequence ${event.seq}`);
      }
      const state = ack.parked ? "parked" : "applied";
      await sql.query("update app.site_events set state=$3,applied_at=now(),last_error=$4,map_version=$5 where org_id=$1 and seq=$2", [org, event.seq, state, ack.parked ? String(ack.error ?? "parked by site") : null, ack.map_version ?? null]);
      await sql.query("update app.organizations set last_ack=$2,retry_at=null,failures=0 where org_id=$1", [org, event.seq]);
      await record(sql, org, "site_event_acknowledged", event.trace, { seq: event.seq, state, duplicate: !ack.applied, map_version: ack.map_version ?? null });
    } catch (error) {
      const message = (error as Error).message.slice(0, 400);
      await sql.query("update app.site_events set last_error=$3 where org_id=$1 and seq=$2", [org, event.seq, message]);
      await sql.query("update app.organizations set failures=failures+1,retry_at=now() + least(8, power(2,least(failures,3))) * interval '1 second' where org_id=$1", [org]);
    }
  }, true);
}
