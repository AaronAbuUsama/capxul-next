import { createHash } from "node:crypto";
import type { Database, Sql } from "../platform/db.ts";
import { transaction } from "../platform/db.ts";
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

export const providerKey = (recipient: string, notice: string) => JSON.stringify([recipient, notice]);

/** Called only by the committed-source workflow, using its caller transaction. Not an RPC. */
export async function planDelivery(sql: Sql, input: Intent, at: number) {
  const intent = { ...input, recipient: input.recipient.trim().toLowerCase() };
  if (!intent.recipient || !intent.notice_id || !intent.subject_id || !intent.cause || !templates.includes(intent.template)
      || !Number.isSafeInteger(at) || at < 0) throw new Error("INVALID_INPUT: notice intent and world time required");
  // The same payer/command occasion is deliberately shared across a batch's source workflows.
  await sql.query(`insert into app.notice_attempts (recipient,notice_id,intent,due_at) values ($1,$2,$3,$4)
    on conflict (recipient,notice_id) do nothing`, [intent.recipient, intent.notice_id, intent, at]);
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
  let completed = 0;
  for (const key of due) {
    const client = await db.worker.connect();
    const lock = `notice:${providerKey(key.recipient, key.notice_id)}`;
    let locked = false;
    try {
      locked = (await client.query("select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [lock])).rows[0].locked;
      if (!locked) continue;
      const current = (await client.query("select * from app.notice_attempts where recipient=$1 and notice_id=$2", [key.recipient, key.notice_id])).rows[0];
      if (!current || current.scheduled_attempts !== key.scheduled_attempts || current.due_at === null || current.due_at > await now(client)) continue;
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
      if (event) completed++;
    } finally {
      try { if (locked) await client.query("select pg_advisory_unlock(hashtextextended($1,0))", [lock]); }
      finally { client.release(); }
    }
  }
  return completed;
}
