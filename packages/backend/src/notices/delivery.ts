import { createHash } from "node:crypto";
import type { Database, Sql } from "../platform/db.ts";
import { transaction } from "../platform/db.ts";
import { hasPending } from "../platform/outbox.ts";
import type { Mail } from "../shared/door.ts";
import { render, templates, type Intent } from "./templates.ts";

export type NoticeEvent = {
  from: null | "retrying"; to: "sent" | "retrying" | "failed";
  transition: "send" | "hold" | "refuse" | "deliver" | "defer" | "fail";
  notice_id: string; template: string; cause: string; attempts: number; error_code: string | null;
  person_id: string | null; org_id: string | null;
};
export type Emit = (sql: Sql, props: NoticeEvent, at: number, id: string, trace: string) => Promise<void>;
export type WorldNow = (sql: Sql) => Promise<number>;
export type Outcome = { id: string } | { error: { code: "PROVIDER_ERROR" | "RATE_LIMITED" | "INVALID_INPUT"; message: string } };

export const providerKey = (recipient: string, notice: string) => {
  const identity = JSON.stringify([recipient, notice]);
  return identity.length <= 256 ? identity : `notice:${createHash("sha256").update(identity).digest("hex")}`;
};

/** Called only by the committed-source workflow, using its caller transaction. Not an RPC. */
export async function planDelivery(sql: Sql, input: Intent, at: number) {
  const intent = { ...input, recipient: input.recipient.trim().toLowerCase() };
  if (!intent.recipient || !intent.notice_id || !intent.subject_id || !intent.cause || !templates.includes(intent.template)
      || !Number.isSafeInteger(at) || at < 0) throw new Error("INVALID_INPUT: notice intent and world time required");
  await sql.query("select pg_advisory_xact_lock(hashtextextended('notices:dispatch-boundary',0))");
  // The same payer/command occasion is deliberately shared across a batch's source workflows.
  await sql.query(`insert into app.notice_attempts (recipient,notice_id,intent,due_at) values ($1,$2,$3,$4)
    on conflict (recipient,notice_id) do update set due_at=excluded.due_at,intent=excluded.intent
    where notice_attempts.scheduled_attempts=0 and not notice_attempts.dispatch_started and notice_attempts.due_at is null`,
  [intent.recipient, intent.notice_id, intent, at]);
}

export async function recordOutcome(sql: Sql, recipient: string, notice: string, expected: number, outcome: Outcome, at: number, emit: Emit) {
  const event: NoticeEvent | null = (await sql.query("select app.notice_outcome($1,$2,$3,$4,$5) as event", [recipient, notice, expected, outcome, at])).rows[0].event;
  if (event) {
    const trace = (await sql.query("select intent->>'trace_id' as trace from app.notice_attempts where recipient=$1 and notice_id=$2", [recipient, notice])).rows[0].trace;
    await emit(sql, event, at, createHash("sha256").update(JSON.stringify([recipient, notice, event.attempts])).digest("hex"), trace);
  }
  return event;
}

/** A session lock survives the mail call without an open transaction; SIGKILL releases it. */
export async function deliverDue(db: Database, mail: Mail, now: WorldNow, emit: Emit) {
  const due = (await db.worker.query(`select recipient,notice_id,scheduled_attempts from app.notice_attempts
    where due_at<=$1 order by due_at,recipient,notice_id limit 100`, [await now(db.worker)])).rows;
  let completed = 0, failure: unknown, pending = false;
  for (const key of due) {
    // One unclassified failure must not starve the rows sorted after it; the first is rethrown after the batch.
    try { completed += await deliverOne(key); } catch (error) { failure ??= error; }
  }
  if (failure !== undefined) throw failure;
  return completed;

  async function deliverOne(key: { recipient: string; notice_id: string; scheduled_attempts: number }): Promise<number> {
    const client = await db.worker.connect();
    const lock = `notice:${providerKey(key.recipient, key.notice_id)}`;
    let locked = false;
    try {
      locked = (await client.query("select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [lock])).rows[0].locked;
      if (!locked) return 0;
      const current = await transaction(client, "", async (sql) => {
        // Serialize with source wake and recipient checkpoint, never across the network call.
        await sql.query("select pg_advisory_xact_lock(hashtextextended('notices:dispatch-boundary',0))");
        const row = (await sql.query("select * from app.notice_attempts where recipient=$1 and notice_id=$2 for update", [key.recipient,key.notice_id])).rows[0];
        if (!row || row.scheduled_attempts !== key.scheduled_attempts || row.due_at === null || row.due_at > await now(sql)) return null;
        if (!row.dispatch_started && row.scheduled_attempts === 0) {
          const references = (await sql.query(`select bool_or(workflow='notices.payments.money-reminders') as reminder,
            bool_or(finished_at is null and failed_at is null) as live from app.notice_workflows
            where checkpoint @> $1::jsonb`, [JSON.stringify({ targets: [{ recipient: key.recipient, notice_id: key.notice_id }] })])).rows[0];
          if (references.reminder && !references.live) {
            await sql.query("update app.notice_attempts set due_at=null where recipient=$1 and notice_id=$2", [key.recipient,key.notice_id]);
            return { ...row, canceled: true };
          }
          // A bounded relay batch can leave a committed stop (or its lock-busy ACK) unseen.
          // A yes holds for the rest of this tick; a no is rechecked, so a stop committed meanwhile is still seen.
          if (references.reminder && (pending ||= await hasPending(sql,"notices",["payment_transitioned"]))) return { ...row, deferred: true };
        }
        // A crash after this commit may hide acceptance. Never cancel that identity's replay.
        await sql.query("update app.notice_attempts set dispatch_started=true where recipient=$1 and notice_id=$2", [key.recipient,key.notice_id]);
        return row;
      });
      if (!current) return 0;
      if (current.canceled || current.deferred) return 1;
      const intent = current.intent as Intent;
      const message = { ...render(intent), template: intent.template };
      let outcome: Outcome;
      try { outcome = await mail.send({ to: intent.recipient, ...message, idempotencyKey: providerKey(intent.recipient, intent.notice_id) }); }
      catch (error) {
        // Unknown exceptions are execution failures, not evidence of an actual mail attempt outcome.
        const e = error as { code?: string; message?: string };
        const code = e.code;
        if (code !== "PROVIDER_ERROR" && code !== "RATE_LIMITED" && code !== "INVALID_INPUT") throw error;
        outcome = { error: { code, message: e.message ?? "Mail failed" } };
      }
      const at = await now(client);
      if (!Number.isSafeInteger(at) || at < 0) throw new Error("INVALID_CLOCK: world milliseconds required");
      const event = await transaction(client, "", (sql) => recordOutcome(sql, key.recipient, key.notice_id, key.scheduled_attempts, outcome, at, emit));
      return event ? 1 : 0;
    } finally {
      try { if (locked) await client.query("select pg_advisory_unlock(hashtextextended($1,0))", [lock]); }
      finally { client.release(); }
    }
  }
}
