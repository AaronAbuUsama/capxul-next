import { readFileSync } from "node:fs";
import { realNowMs } from "@capxul/runtime/time";
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
/** The world's now in epoch ms, read on the relay's own transaction (devnet/door.ts worldNow). */
type WorldNow = (sql: Sql) => Promise<number>;

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
  // The host stamp is envelope only (runtime.outbox-host-stamps): a retry keeps the first one and never compares it.
  await sql.query("insert into app.transition_outbox (id,event,host_enqueued_at) values ($1,$2::jsonb,$3) on conflict (id) do nothing",
    [event.id, value, realNowMs()]);
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

/**
 * SQL effects only: caller transaction must include the handler and its ACK. Network work is scheduled, not sent.
 * `ackedAt` is the world instant of the ACK in epoch ms; the host stamp beside it is RealTime (runtime.outbox-host-stamps).
 */
export async function consume(sql: Sql, consumer: string, eventId: string, effect: Handler, ackedAt: number): Promise<boolean> {
  if (!consumer) throw new Error("INVALID_INPUT: consumer identity required");
  if (!Number.isSafeInteger(ackedAt) || ackedAt < 0) throw new Error("INVALID_INPUT: world ACK instant required");
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1, 38119))", [lockKey(consumer, eventId)]);
  if ((await sql.query("select 1 from app.transition_acks where consumer=$1 and event_id=$2", [consumer, eventId])).rowCount) return false;
  const event = await readEvent(sql, eventId);
  if (!event) throw new Error("NOT_FOUND: committed transition required");
  await effect(sql, event);
  await sql.query("insert into app.transition_acks (consumer,event_id,acked_at,host_acked_at) values ($1,$2,to_timestamp($3::float8/1000),$4)",
    [consumer, eventId, ackedAt, realNowMs()]);
  return true;
}

/** The leading `CODE:` of a failure, else its SQLSTATE, else its class name; never the message, which may carry event data. */
const failureCode = (error: unknown) => {
  if (!(error instanceof Error)) return "Error";
  const sqlState = (error as { code?: unknown }).code;
  return (/^([A-Z][A-Z_]{1,63}):/.exec(error.message)?.[1] ?? (typeof sqlState === "string" && /^[0-9A-Z]{5}$/.test(sqlState) ? sqlState : error.name)).slice(0, 64);
};

/**
 * Composition calls this for explicit consumers; ACKs, not a cursor, prevent loss of late-committing sources. Each
 * event's effect and ACK run in their own savepoint: a failing event rolls back alone, is recorded, and is retried after
 * fresher events and events that failed fewer times, so neither it nor a pile of permanent failures holds back the rest
 * (runtime.outbox-poison-event). The batch's ACKs commit together, so they share one world instant, read first: a clock
 * that cannot be read fails the batch, not the events.
 */
export async function relay(db: Database, consumer: string, names: readonly string[], effect: Handler, now: WorldNow, limit = 100): Promise<number> {
  if (!consumer || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("INVALID_INPUT: invalid relay batch");
  return db.transaction("", async (sql) => {
    const ackedAt = await now(sql);
    const rows = (await sql.query(`select o.id from app.transition_outbox o
      left join app.transition_failures f on f.consumer=$1 and f.event_id=o.id
      where o.event->>'name'=any($2::text[]) and not exists
        (select 1 from app.transition_acks a where a.consumer=$1 and a.event_id=o.id)
      order by coalesce(f.attempts,0), o.seq limit $3`, [consumer, names, limit])).rows;
    let delivered = 0;
    for (const row of rows) {
      const lock = (await sql.query("select pg_try_advisory_xact_lock(hashtextextended($1, 38119)) as held", [lockKey(consumer, row.id)])).rows[0];
      if (!lock?.held) continue;
      await sql.query("savepoint transition_event");
      try {
        if (await consume(sql, consumer, row.id, effect, ackedAt)) delivered++;
        // Also clears a failure another relay recorded for an event this one delivered.
        await sql.query("delete from app.transition_failures where consumer=$1 and event_id=$2", [consumer, row.id]);
        await sql.query("release savepoint transition_event");
      } catch (error) {
        await sql.query("rollback to savepoint transition_event");
        await sql.query(`insert into app.transition_failures (consumer,event_id,attempts,last_error) values ($1,$2,1,$3)
          on conflict (consumer,event_id) do update set attempts=app.transition_failures.attempts+1, last_error=excluded.last_error`, [consumer, row.id, failureCode(error)]);
      }
    }
    return delivered;
  }, true);
}
