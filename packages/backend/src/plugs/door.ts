import { createHmac } from "node:crypto";
import { Effect, Result } from "effect";
import { record, type Database, type Sql } from "../platform/db.ts";
import { createFrappeSite } from "./site.ts";
import { settleRoleDelivery, type WorldNow } from "./roles.ts";
export { RequestCollector } from "./collector.ts";
export { enqueue } from "./events.ts";
export { FrappeSite, FrappeSiteError, createFrappeSite, frappeSiteLayer } from "./site.ts";
export { consume } from "./follow.ts";
export type { AccountInput, DoorInput, ReportInput, SiteInput } from "./site.ts";
export { migrateRoleProjections, recordRoleGrant, transitionRoleGrant, readRoles } from "./roles.ts";
export type { RoleOccurrence, RoleGrant, GrantInput, GrantChange, WorldNow } from "./roles.ts";

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

export async function retryParked(sql: Sql, org: string, key: string, frappe: string, secret: string, worldNow: WorldNow) {
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [org]);
  const event = (await sql.query("select e.*,o.site from app.site_events e join app.organizations o using (org_id) where e.org_id=$1 and e.event_key=$2 for update of e", [org, key])).rows[0];
  if (!event) throw new Error("NOT_FOUND: unknown parked event");
  if (event.state !== "parked") return status(sql, org);
  const ack = await Effect.runPromise(createFrappeSite({ baseUrl: frappe, secret }).retryParkedEvent({
    orgId: org, site: event.site, traceId: event.trace, event_key: key,
  }));
  if (ack.parked || ack.last_seq < Number(event.seq)) throw new Error("REPAIR_FAILED: site has not applied parked money event");
  await sql.query("update app.site_events set state='applied',last_error=null,applied_at=now(),map_version=$3 where org_id=$1 and event_key=$2", [org, key, ack.map_version ?? null]);
  const at = event.kind === "hat_granted" ? await settleRoleDelivery(sql, org, key, ack, worldNow) : undefined;
  await record(sql, org, "site_event_repaired", event.trace, { event_key: key, seq: event.seq }, at);
  return status(sql, org);
}

/** A delivery refusal names the event it was offering, so its backoff is charged to that event only. */
export class DeliveryRefused extends Error {
  readonly seq: number;
  constructor(seq: number, cause: unknown) { super(String((cause as Error)?.message ?? cause), { cause }); this.seq = seq; }
}

/** After a delivery transaction rolled back on a settlement refusal: back off in a separate transaction so one site cannot spin or block others.
 *  Another Core instance may have delivered that event meanwhile; then nothing is charged, to it or to the next event. */
export async function deferDelivery(db: Database, org: string, error: unknown) {
  const message = String((error as Error)?.message ?? error).slice(0, 400);
  const seq = error instanceof DeliveryRefused ? error.seq : null;
  await db.transaction(org, async (sql) => {
    await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [org]);
    if (seq !== null) {
      const head = (await sql.query("select min(seq)::bigint as seq from app.site_events where org_id=$1 and state='pending'", [org])).rows[0].seq;
      if (head === null || Number(head) !== seq) return;
      await sql.query("update app.site_events set attempts=attempts+1,last_attempt_at=now(),last_error=$3 where org_id=$1 and seq=$2", [org, seq, message]);
    }
    await sql.query("update app.organizations set failures=failures+1,retry_at=now() + least(8, power(2,least(failures,3))) * interval '1 second' where org_id=$1", [org]);
  }, true);
}

export async function deliver(db: Database, org: string, frappe: string, secret: string, worldNow: WorldNow) {
  return db.transaction(org, async (sql) => {
    // One in-flight delivery per company across processes. A crash releases this lock and rolls back the ack.
    await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [org]);
    const company = (await sql.query("select * from app.organizations where org_id=$1 for update", [org])).rows[0]!;
    if (!company.released || company.retry_at && new Date(company.retry_at).getTime() > Date.now()) return;
    const event = (await sql.query("select * from app.site_events where org_id=$1 and state='pending' order by seq limit 1 for update", [org])).rows[0];
    if (!event) return;
    try { await offer(sql, org, company, event, frappe, secret, worldNow); }
    catch (error) { throw new DeliveryRefused(Number(event.seq), error); }
  }, true);
}

async function offer(sql: Sql, org: string, company: any, event: any, frappe: string, secret: string, worldNow: WorldNow) {
  await sql.query("update app.site_events set attempts=attempts+1,last_attempt_at=now() where org_id=$1 and seq=$2", [org, event.seq]);
  const result = await Effect.runPromise(Effect.result(createFrappeSite({ baseUrl: frappe, secret }).applyEvent({
    orgId: org, site: company.site, traceId: event.trace,
    event_key: event.event_key, seq: Number(event.seq), kind: event.kind, data: event.data,
  })));
  if (Result.isFailure(result)) {
    const { expected } = result.failure;
    if (result.failure.code === "WRONG_STATE" && expected !== undefined) {
      if (expected >= Number(event.seq)) throw new Error("invalid site cursor acknowledgement");
      await sql.query("update app.site_events set state=case when seq<$2 then 'applied' else 'pending' end where org_id=$1 and state!='parked'", [org, expected]);
      await sql.query("update app.organizations set last_ack=$2-1,retry_at=null where org_id=$1", [org, expected]);
      return;
    }
    const message = result.failure.message.slice(0, 400);
    await sql.query("update app.site_events set last_error=$3 where org_id=$1 and seq=$2", [org, event.seq, message]);
    await sql.query("update app.organizations set failures=failures+1,retry_at=now() + least(8, power(2,least(failures,3))) * interval '1 second' where org_id=$1", [org]);
    return;
  }
  // Settlement is outside transport retry handling: any clock/transition/emission failure rolls back the ACK.
  const ack = result.success;
  if (ack.last_seq < Number(event.seq) || ack.last_seq >= Number(company.next_seq)) throw new Error(`site did not acknowledge sequence ${event.seq}`);
  const state = ack.parked ? "parked" : "applied";
  await sql.query("update app.site_events set state=$3,applied_at=now(),last_error=$4,map_version=$5 where org_id=$1 and seq=$2", [org, event.seq, state, ack.parked ? ack.error : null, ack.map_version ?? null]);
  await sql.query("update app.organizations set last_ack=$2,retry_at=null,failures=0 where org_id=$1", [org, event.seq]);
  const at = event.kind === "hat_granted" ? await settleRoleDelivery(sql, org, event.event_key, ack, worldNow) : undefined;
  await record(sql, org, "site_event_acknowledged", event.trace, { seq: event.seq, state, duplicate: !ack.applied, map_version: ack.map_version ?? null }, at);
}
