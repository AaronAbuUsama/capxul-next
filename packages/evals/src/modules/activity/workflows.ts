import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { note, paymentTransitions } from "../../../../backend/src/activity/door.ts";
import type { Database, Sql } from "../../../../backend/src/platform/db.ts";
import type { TransitionEvent } from "../../../../backend/src/platform/outbox.ts";

const CONSUMER = "activity.changes";
const SAMPLE = 20;
export const idempotentChecks = paymentTransitions.map((t) => [t, `ACTIVITY.note-payment-${t.replace(/_/g, "-")}.idempotent`] as const);
export const resumeChecks = paymentTransitions.map((t) => [t, `ACTIVITY.note-payment-${t.replace(/_/g, "-")}.resume`] as const);

const feedKey = (kind: string, id: string) => JSON.stringify([kind, id]);
const feedRows = (sql: Sql, feeds: [string, string][]) => sql.query(`select * from app.activity_changes
  where (owner_kind,owner_id) in (select * from unnest($1::text[],$2::text[])) order by owner_kind,owner_id,seq`,
[feeds.map((f) => f[0]), feeds.map((f) => f[1])]).then((r) => r.rows);

/**
 * Real `transition` events the relay acknowledged during this run (the newest first): each was noted once in each feed
 * holding its Payment, and a second run with the same event id, as if its ACK were lost, changes nothing because of the
 * change log's `by-owner-event` key. Every redelivery rolls back.
 */
export async function idempotent(database: Database, dir: string, transition: string, runStartedAt: string) {
  // Scoped by the database clock's ACK time, not the event's `at`: world time can be stopped or warped, and a restored
  // world's baseline events were acknowledged before this run started.
  await hostAckClock(database.worker);
  const events = (await database.worker.query(`select o.event from app.transition_outbox o
    join app.transition_acks a on a.consumer=$1 and a.event_id=o.id
    where o.event->>'name'='payment_transitioned' and o.event->>'machine'='payment' and o.event->'props'->>'transition'=$2
      and a.acked_at>=$4::timestamptz
    order by o.seq desc limit $3`, [CONSUMER, transition, SAMPLE, runStartedAt])).rows.map((r) => r.event as TransitionEvent);
  assert(events.length > 0, `no ${transition} transition acknowledged in this run`);
  const evidence = [];
  for (const event of events) {
    const client = await database.worker.connect();
    try {
      await client.query("begin"); await client.query("set local lock_timeout='30s'");
      const { feeds, noted } = await checkNoted(client, event, transition);
      const before = await feedRows(client, feeds);
      await note(client, event);
      assert.deepEqual(await feedRows(client, feeds), before);
      evidence.push({ event: event.id, payment: event.entity_id, feeds: noted });
    } finally { await client.query("rollback"); client.release(); }
  }
  writeFileSync(join(dir, `idempotent-${transition}.json`), JSON.stringify(evidence) + "\n");
}

/**
 * ACK times are compared with host times (the run start, the kill). That holds only while `acked_at` is the database
 * host's commit-side clock; if its source changes (to world time, say), fail loudly rather than pass on a warped clock.
 */
async function hostAckClock(sql: Sql) {
  const column = (await sql.query(`select column_default from information_schema.columns
    where table_schema='app' and table_name='transition_acks' and column_name='acked_at'`)).rows[0];
  assert.equal(column?.column_default, "now()", "transition_acks.acked_at is no longer the database host clock; this check must move to the host-stamped ACK column");
  // The default is only the clock while nothing rewrites the column on insert or update.
  const triggers = (await sql.query("select count(*)::int as n from pg_trigger where tgrelid='app.transition_acks'::regclass and not tgisinternal")).rows[0].n;
  assert.equal(triggers, 0, "a trigger may rewrite transition_acks.acked_at");
}

/** In the caller's transaction, holding the feeds' locks: the event was noted exactly once in each feed holding its Payment. */
async function checkNoted(client: Sql, event: TransitionEvent, transition: string) {
  const p = event.props as Record<string, string | null>;
  assert.equal(p.transition, transition);
  const payment = (await client.query("select owner_kind,owner_id,payee_kind,payee_id from app.payments where owner_kind=$1 and owner_id=$2 and id=$3",
    [p.owner_kind, p.owner_id, p.payment_id])).rows[0];
  assert(payment, "acknowledged transition has a Payment");
  const feeds = new Map<string, [string, string]>([[feedKey(payment.owner_kind, payment.owner_id), [payment.owner_kind, payment.owner_id]]]);
  if (payment.payee_kind === "person" || payment.payee_kind === "organization") feeds.set(feedKey(payment.payee_kind, payment.payee_id), [payment.payee_kind, payment.payee_id]);
  // Hold the feeds as the appender does, so the live relay cannot append between the reads.
  for (const key of [...feeds.keys()].sort()) {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [JSON.stringify(["activity", ...JSON.parse(key)])]);
  }
  const noted = (await client.query("select * from app.activity_changes where event_id=$1 order by owner_kind,owner_id", [event.id])).rows;
  assert.deepEqual(noted.map((r) => feedKey(r.owner_kind, r.owner_id)).sort(), [...feeds.keys()].sort());
  for (const row of noted) {
    assert.deepEqual([row.row_kind, row.row_id, row.transition, row.from, row.to, row.changed_at],
      ["payment", p.payment_id, transition, p.from, p.to, event.at]);
    const earlier = (await client.query(`select 1 from app.activity_changes where owner_kind=$1 and owner_id=$2
      and row_kind='payment' and row_id=$3 and seq<$4 limit 1`, [row.owner_kind, row.owner_id, p.payment_id, row.seq])).rowCount;
    assert.equal(row.change, earlier ? "updated" : "new");
  }
  return { feeds: [...feeds.values()], noted: noted.map((r) => ({ owner_kind: r.owner_kind, owner_id: r.owner_id, seq: Number(r.seq), change: r.change })) };
}

/** What `world fixture resume-kill activity.changes` printed: the event whose effect died with Core before its ACK. */
export type ResumeFault = { consumer: string; eventId: string; event: string; transition: string; reachedAt: number;
  killed: { pid: number; signal: string; at: number }; restarted: { pid: number; readyAt: number } };

const world = (config: string, ...args: string[]) => JSON.parse(execFileSync("pnpm", ["--silent", "capxul", "world", "fixture", ...args, "--config", config, "--json"],
  { encoding: "utf8", timeout: 600_000, stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n").at(-1)!);
// Only the world refusing `payment` as a fixture command at all; a refusal for one kind (escrow, say) fails that kind alone.
const missingDriver = /expected fixture load\|seed\|repair/;
let driversMissing = false;

/**
 * Arms Activity's consumer for the next `transition` delivery only, drives one real transition of that kind through the
 * world's public-path payment fixture, and lets the fault mount kill Core between the appender and its ACK, then
 * restart and resume it. `after` is the outbox position before arming, and `driven` is the transition event id the
 * driver printed, so the faulted event must be the one this drive caused. Only when the world has no `payment` fixture
 * at all do the later kinds fail at once; a refusal for one kind fails that kind alone.
 */
export async function driveResume(database: Database, config: string, transition: string): Promise<{ fault: ResumeFault; after: number; driven: string }> {
  if (driversMissing) throw new Error("world fixture payment is not available in this world");
  const after = Number((await database.worker.query("select coalesce(max(seq),0) as seq from app.transition_outbox")).rows[0].seq);
  world(config, "resume-arm", CONSUMER, "--event", "payment_transitioned", "--transition", transition);
  let driven: string;
  try { driven = String(world(config, "payment", transition).eventId ?? ""); }
  catch (error) {
    driversMissing ||= missingDriver.test(String((error as { stderr?: unknown }).stderr ?? ""));
    // Remove the unclaimed arm: disarm where the world has it, else resume-kill, which drops the arm on its timeout.
    try { world(config, "resume-disarm", CONSUMER); }
    catch { try { world(config, "resume-kill", CONSUMER); } catch { /* the arm was removed on timeout */ } }
    throw error;
  }
  return { fault: world(config, "resume-kill", CONSUMER), after, driven };
}

/**
 * The armed `transition` event's appender was killed with its effect uncommitted and unacknowledged; the restarted
 * relay redelivered it, and it finished with the same result an uninterrupted run gives: one ACK, committed after the
 * kill, exactly one change per holding feed with the event's fields, and each feed's `seq` still gapless.
 */
export async function resumed(database: Database, dir: string, transition: string,
  { fault, after, driven }: { fault: ResumeFault; after: number; driven: string }) {
  assert.equal(fault.consumer, CONSUMER);
  // The driver names the transition event it caused; the fault must have held exactly that one.
  assert.equal(fault.eventId, driven, "the faulted event is the transition this drive caused");
  await hostAckClock(database.worker);
  // The restarted relay redelivers on its own schedule; wait for it within the workflow's 30 s timeout.
  for (const deadline = Date.now() + 30_000; ;) {
    if ((await database.worker.query("select 1 from app.transition_acks where consumer=$1 and event_id=$2", [CONSUMER, fault.eventId])).rowCount) break;
    assert(Date.now() < deadline, "the restarted relay did not acknowledge the faulted event within 30 s");
    await new Promise((done) => setTimeout(done, 250));
  }
  const client = await database.worker.connect();
  try {
    await client.query("begin isolation level repeatable read"); await client.query("set local lock_timeout='30s'");
    const row = (await client.query("select seq,event from app.transition_outbox where id=$1", [fault.eventId])).rows[0];
    const event = row?.event as TransitionEvent | undefined;
    assert(event && event.name === "payment_transitioned" && event.machine === "payment", "faulted event is a payment transition");
    assert(Number(row.seq) > after, "the faulted event was emitted after the arm");
    const acks = (await client.query("select (extract(epoch from acked_at)*1000)::float8 as at from app.transition_acks where consumer=$1 and event_id=$2",
      [CONSUMER, fault.eventId])).rows;
    assert.equal(acks.length, 1);
    assert(acks[0].at > fault.killed.at, "the ACK committed after the kill, by the restarted relay");
    const { feeds, noted } = await checkNoted(client, event, transition);
    const gaps = (await client.query(`select owner_kind,owner_id,count(*)::int as n,max(seq)::int as top from app.activity_changes
      where (owner_kind,owner_id) in (select * from unnest($1::text[],$2::text[])) group by 1,2`, [feeds.map((f) => f[0]), feeds.map((f) => f[1])])).rows;
    assert(gaps.length === feeds.length && gaps.every((g) => g.n === g.top), "every holding feed's seq is gapless");
    writeFileSync(join(dir, `resume-${transition}.json`), JSON.stringify({ fault, after, driven, feeds: noted }) + "\n");
  } finally { await client.query("rollback"); client.release(); }
}

/**
 * Real Movement transitions the relay acknowledged during this run. Each `record` was noted exactly once, in its side's
 * feed, as the event's own `entity_id` (the Movement's id, activity.row-ids) with the event's fields. A `remove` or `restore` was acknowledged without an append.
 * A second delivery of any of them changes nothing. Every redelivery rolls back.
 */
export async function movementsNoted(database: Database, dir: string, runStartedAt: string) {
  await hostAckClock(database.worker);
  const events = (await database.worker.query(`select o.event from app.transition_outbox o
    join app.transition_acks a on a.consumer=$1 and a.event_id=o.id
    where o.event->>'name'='movement_transitioned' and o.event->>'machine'='movement' and a.acked_at>=$3::timestamptz
    order by o.seq desc limit $2`, [CONSUMER, SAMPLE, runStartedAt])).rows.map((r) => r.event as TransitionEvent);
  // Asked directly: the newest sample alone could be all removals and restorations.
  const recorded = (await database.worker.query(`select 1 from app.transition_outbox o
    join app.transition_acks a on a.consumer=$1 and a.event_id=o.id
    where o.event->>'name'='movement_transitioned' and o.event->'props'->>'transition'='record' and a.acked_at>=$2::timestamptz limit 1`,
  [CONSUMER, runStartedAt])).rowCount;
  assert(recorded, "no Movement record acknowledged in this run");
  const evidence = [];
  for (const event of events) {
    const p = event.props as Record<string, string | number | null>;
    const client = await database.worker.connect();
    try {
      await client.query("begin"); await client.query("set local lock_timeout='30s'");
      assert.deepEqual([p.owner_kind, p.owner_id], [event.owner_kind, event.owner_id]);
      const feed: [string, string] = [String(p.owner_kind), String(p.owner_id)];
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [JSON.stringify(["activity", ...feed])]);
      const noted = (await client.query("select * from app.activity_changes where event_id=$1", [event.id])).rows;
      if (p.transition === "record") {
        assert.equal(noted.length, 1);
        const row = noted[0];
        assert.deepEqual([row.owner_kind, row.owner_id, row.row_kind, row.row_id, row.transition, row.from, row.to, row.changed_at],
          [...feed, "movement", event.entity_id, "record", null, "recorded", event.at]);
        const earlier = (await client.query(`select 1 from app.activity_changes where owner_kind=$1 and owner_id=$2
          and row_kind='movement' and row_id=$3 and seq<$4 limit 1`, [...feed, event.entity_id, row.seq])).rowCount;
        assert.equal(row.change, earlier ? "updated" : "new");
      } else {
        assert(p.transition === "remove" || p.transition === "restore", "a Movement transition Activity knows");
        assert.equal(noted.length, 0);
      }
      const before = await feedRows(client, [feed]);
      await note(client, event);
      assert.deepEqual(await feedRows(client, [feed]), before);
      evidence.push({ event: event.id, transition: p.transition, movement: event.entity_id, feed, rows: noted.length });
    } finally { await client.query("rollback"); client.release(); }
  }
  writeFileSync(join(dir, "movements.json"), JSON.stringify(evidence) + "\n");
}
