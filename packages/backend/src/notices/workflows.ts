import type { Database, Sql } from "../platform/db.ts";
import type { TransitionEvent } from "../platform/outbox.ts";
import { planDelivery, type WorldNow } from "./delivery.ts";
import type { Intent } from "./templates.ts";

export const triggers = [
  ["waitlist-entry", "admit", "notices.accounts.welcome"],
  ["waitlist-entry", "admit_unlisted", "notices.accounts.welcome-unlisted"],
  ["proposal", "propose", "notices.board.proposal-waiting"],
  ["officer-change", "apply", "notices.board.officer-granted"],
  ["payment", "schedule", "notices.payments.scheduled"],
  ["payment", "come_due", "notices.payments.short"],
  ["payment", "lapse", "notices.payments.failed"],
  ["payment", "settle", "notices.payments.sent"],
  ["payment", "cancel", "notices.payments.cancelled"],
  ["payment", "cancel", "notices.payments.money-taken-back"],
  ["payment", "escrow", "notices.payments.money-waiting"],
  ["payment", "escrow", "notices.payments.money-reminders"],
  ["request", "settle", "notices.requests.paid"],
] as const;
export type Workflow = typeof triggers[number][2];
type Checkpoint = { targets: { recipient: string; notice_id: string }[]; days: number | null };
export type Resolve = (sql: Sql, workflow: Workflow, event: TransitionEvent, days: number | null) => Promise<{ intents: Intent[]; ended?: boolean }>;
const reminders = "notices.payments.money-reminders";
const day = 86_400_000;
export const sourceNames = ["waitlist_entry_transitioned", "proposal_transitioned", "officer_change_transitioned", "payment_transitioned", "request_transitioned"];

/** Shared relay calls this and ACKs using the same Sql. No mail and no source mutation. */
export async function schedule(sql: Sql, event: TransitionEvent) {
  await sql.query("select pg_advisory_xact_lock(hashtextextended('notices:dispatch-boundary',0))");
  if (event.name === "payment_transitioned" && event.props.to !== "escrowed") {
    // Correlate both payment and owner. A different Payment never ends another instance.
    await sql.query(`update app.notice_workflows set finished_at=$1 where workflow=$2 and finished_at is null
      and event->'props'->>'payment_id'=$3 and event->>'owner_kind' is not distinct from $4 and event->>'owner_id' is not distinct from $5`,
    [event.at, reminders, event.props.payment_id, event.owner_kind, event.owner_id]);
  }
  for (const [machine, transition, workflow] of triggers) {
    if (event.machine !== machine || event.props.transition !== transition) continue;
    await sql.query(`insert into app.notice_workflows (workflow,event_id,event,due_at) values ($1,$2,$3,$4)
      on conflict (workflow,event_id) do nothing`, [workflow, event.id, event, event.at + (workflow === reminders ? 3 * day : 0)]);
  }
}

/** Resolve and persist recipients once at each durable boundary, before any provider attempt. */
export async function prepareDue(db: Database, now: WorldNow, resolve: Resolve) {
  const due = (await db.worker.query(`select workflow,event_id from app.notice_workflows
    where finished_at is null and failed_at is null and checkpoint is null and due_at<=$1
      and coalesce(retry_at,due_at)<=$1 order by due_at,workflow,event_id limit 100`, [await now(db.worker)])).rows;
  let prepared = 0;
  for (const key of due) {
    prepared += await db.transaction("", async (sql) => {
      // One preparer per job, but no row lock or dispatch boundary across source reads and chain RPC:
      // schedule takes the boundary before updating workflow rows, so holding either here would stall or deadlock it.
      if (!(await sql.query("select pg_try_advisory_xact_lock(hashtextextended($1,0)) as mine",
        [JSON.stringify(["notices:prepare", key.workflow, key.event_id])])).rows[0].mine) return 0;
      const at = await now(sql);
      const job = (await sql.query(`select * from app.notice_workflows where workflow=$1 and event_id=$2
        and finished_at is null and failed_at is null and checkpoint is null and due_at<=$3
        and coalesce(retry_at,due_at)<=$3`, [key.workflow,key.event_id,at])).rows[0];
      if (!job) return 0;
      const unchanged = `workflow=$1 and event_id=$2 and finished_at is null and failed_at is null and checkpoint is null and failures=$3`;
      const event = job.event as TransitionEvent;
      const deadline = event.at + (job.workflow === reminders ? 31 * day : 300_000);
      if (at >= deadline) {
        await sql.query(`update app.notice_workflows set failed_at=$4,last_error='preparation deadline exceeded' where ${unchanged}`, [key.workflow,key.event_id,job.failures,at]);
        return 1;
      }
      // Source-owned doors require the committed owner's canonical context on this same worker session.
      await sql.query(`select set_config('app.org_id',$1,true),set_config('app.owner_kind',$2,true),set_config('app.owner_id',$3,true)`,
        [event.owner_kind === "organization" ? event.owner_id ?? "" : "", event.owner_kind ?? "", event.owner_id ?? ""]);
      await sql.query("savepoint notice_prepare");
      try {
        const days = job.workflow === reminders ? Math.round((job.due_at - event.at) / day) : null;
        const plan = await resolve(sql, job.workflow, event, days);
        if (await now(sql) >= deadline) throw new Error("preparation deadline exceeded");
        // Only now take the boundary, then recheck: a stop committed during resolution wins over this plan.
        await sql.query("select pg_advisory_xact_lock(hashtextextended('notices:dispatch-boundary',0))");
        if (!(await sql.query(`select 1 from app.notice_workflows where ${unchanged} for update`, [job.workflow,job.event_id,job.failures])).rowCount) {
          await sql.query("rollback to savepoint notice_prepare");
          return 0;
        }
        if (plan.ended) {
          await sql.query("update app.notice_workflows set finished_at=$3 where workflow=$1 and event_id=$2", [job.workflow,job.event_id,at]);
        } else {
          for (const intent of plan.intents) await planDelivery(sql, intent, at);
          const checkpoint: Checkpoint = { targets: plan.intents.map((i) => ({ recipient: i.recipient.trim().toLowerCase(), notice_id: i.notice_id })), days };
          await sql.query("update app.notice_workflows set checkpoint=$3,retry_at=null where workflow=$1 and event_id=$2", [job.workflow,job.event_id,checkpoint]);
        }
        await sql.query("release savepoint notice_prepare");
      } catch {
        // Roll back this source read/intent set only; never erase another workflow's recipients.
        await sql.query("rollback to savepoint notice_prepare");
        const failedAt = await now(sql), failures = job.failures + 1;
        const stopped = failures > 5 || failedAt >= deadline;
        await sql.query(`update app.notice_workflows set failures=$3+1,retry_at=$4,failed_at=$5,last_error=$6
          where ${unchanged}`, [key.workflow,key.event_id,job.failures,
          stopped ? null : failedAt + 1000 * 2 ** (failures-1), stopped ? failedAt : null,
          failedAt >= deadline ? "preparation deadline exceeded" : "source preparation failed"]);
      }
      return 1;
    }, true);
  }
  return prepared;
}

/** Only completed first attempts advance the origin workflow; delivery retries have their own durable row. */
export async function finishDue(db: Database, now: WorldNow) {
  return db.transaction("", async (sql) => {
    const at = await now(sql);
    const jobs = (await sql.query(`select * from app.notice_workflows where finished_at is null and failed_at is null and checkpoint is not null
      order by due_at,workflow,event_id limit 100 for update skip locked`)).rows;
    let advanced = 0;
    for (const job of jobs) {
      const checkpoint = job.checkpoint as Checkpoint;
      let pending = false;
      for (const target of checkpoint.targets) {
        const row = (await sql.query("select scheduled_attempts from app.notice_attempts where recipient=$1 and notice_id=$2", [target.recipient, target.notice_id])).rows[0];
        if (!row || row.scheduled_attempts === 0) { pending = true; break; }
      }
      if (pending) continue;
      if (job.workflow === reminders && checkpoint.days !== 30) {
        const next = checkpoint.days === 3 ? 10 : 30;
        await sql.query("update app.notice_workflows set checkpoint=null,due_at=$3 where workflow=$1 and event_id=$2", [job.workflow, job.event_id, job.event.at + next * day]);
      } else await sql.query("update app.notice_workflows set finished_at=$3 where workflow=$1 and event_id=$2", [job.workflow, job.event_id, at]);
      advanced++;
    }
    return advanced;
  }, true);
}
