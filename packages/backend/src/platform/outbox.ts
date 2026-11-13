import { readFileSync } from "node:fs";
import type { Database, Sql } from "./db.ts";

/** Props are the source transition's exact blueprint event, not a notification payload. */
export interface TransitionEvent {
  id: string;
  name: string;
  machine: string;
  entity_id: string;
  owner_kind: "person" | "organization" | null;
  owner_id: string | null;
  actor: string | null;
  trace_id: string;
  at: number;
  props: Record<string, unknown>;
}

type Handler = (sql: Sql, event: TransitionEvent) => Promise<void>;

/** Provisioning only, after Core roles/schema exist; composition owns the migration transaction. */
export async function migrateOutbox(sql: Sql): Promise<void> {
  await sql.query(readFileSync(new URL("./outbox.sql", import.meta.url), "utf8"));
}

/** Must use the source mutation's existing transaction. Never commits or opens a transaction. */
export async function emit(sql: Sql, event: TransitionEvent): Promise<TransitionEvent> {
  if (!event.id || !event.name || !event.machine || !event.entity_id || !Number.isSafeInteger(event.at) ||
      event.at < 0 || (event.owner_kind === null) !== (event.owner_id === null) ||
      !event.props || typeof event.props !== "object" || Array.isArray(event.props)) {
    throw new Error("INVALID_INPUT: invalid transition envelope");
  }
  const value = JSON.stringify(event);
  await sql.query("insert into app.transition_outbox (id,event) values ($1,$2::jsonb) on conflict (id) do nothing", [event.id, value]);
  // A concurrent identical source retry waits on the insert; a changed retry never rewrites history.
  const row = (await sql.query("select event, event=$2::jsonb as identical from app.transition_outbox where id=$1", [event.id, value])).rows[0];
  if (!row?.identical) throw new Error("IDEMPOTENCY_CONFLICT: transition identity already has another envelope");
  return row.event;
}

export async function readEvent(sql: Sql, id: string): Promise<TransitionEvent | null> {
  return (await sql.query("select event from app.transition_outbox where id=$1", [id])).rows[0]?.event ?? null;
}

/** Readiness on the caller's Sql: lock-busy and beyond-batch envelopes still count. */
export async function hasPending(sql: Sql, consumer: string, names: readonly string[]): Promise<boolean> {
  if (!consumer) throw new Error("INVALID_INPUT: consumer identity required");
  return (await sql.query(`select exists(select 1 from app.transition_outbox o
    where event->>'name'=any($2::text[]) and not exists
      (select 1 from app.transition_acks a where a.consumer=$1 and a.event_id=o.id)) as pending`, [consumer,names])).rows[0].pending;
}

const lockKey = (consumer: string, id: string) => JSON.stringify([consumer, id]);

/** SQL effects only: caller transaction must include the handler and its ACK. Network work is scheduled, not sent. */
export async function consume(sql: Sql, consumer: string, eventId: string, effect: Handler): Promise<boolean> {
  if (!consumer) throw new Error("INVALID_INPUT: consumer identity required");
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1, 38119))", [lockKey(consumer, eventId)]);
  if ((await sql.query("select 1 from app.transition_acks where consumer=$1 and event_id=$2", [consumer, eventId])).rowCount) return false;
  const event = await readEvent(sql, eventId);
  if (!event) throw new Error("NOT_FOUND: committed transition required");
  await effect(sql, event);
  await sql.query("insert into app.transition_acks (consumer,event_id) values ($1,$2)", [consumer, eventId]);
  return true;
}

/** Composition calls this for explicit consumers; ACKs, not a cursor, prevent loss of late-committing sources. */
export async function relay(db: Database, consumer: string, names: readonly string[], effect: Handler, limit = 100): Promise<number> {
  if (!consumer || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("INVALID_INPUT: invalid relay batch");
  return db.transaction("", async (sql) => {
    const rows = (await sql.query(`select id from app.transition_outbox o
      where event->>'name'=any($2::text[]) and not exists
        (select 1 from app.transition_acks a where a.consumer=$1 and a.event_id=o.id)
      order by seq limit $3`, [consumer, names, limit])).rows;
    let delivered = 0;
    for (const row of rows) {
      const lock = (await sql.query("select pg_try_advisory_xact_lock(hashtextextended($1, 38119)) as held", [lockKey(consumer, row.id)])).rows[0];
      if (lock?.held && await consume(sql, consumer, row.id, effect)) delivered++;
    }
    return delivered;
  }, true);
}
