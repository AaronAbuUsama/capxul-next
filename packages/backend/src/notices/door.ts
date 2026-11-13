import { readFileSync } from "node:fs";
import type { Database, Sql } from "../platform/db.ts";
import { lookupBySafe } from "../parties/door.ts";
import { emit, relay } from "../platform/outbox.ts";
import type { Mail } from "../shared/door.ts";
import { deliverDue, type Emit, type WorldNow } from "./delivery.ts";
import { createResolver, type Links } from "./resolve.ts";
import type { Sources } from "./sources.ts";
import { finishDue, prepareDue, schedule, sourceNames } from "./workflows.ts";

export type { Sources } from "./sources.ts";
export type { Links } from "./resolve.ts";
export { schedule } from "./workflows.ts";

/** Explicit provisioning hook: the integrator calls this inside migrate.ts's existing transaction. */
export async function migrateNotices(sql: Sql) {
  await sql.query(readFileSync(new URL("./migration.sql", import.meta.url), "utf8"));
}

export interface DeliveryRecord {
  recipient: string; notice_id: string; template: string; subject_kind: string; subject_id: string; cause: string;
  person_id: string | null; org_id: string | null; facts: Record<string, unknown>;
  status: "sent" | "retrying" | "failed"; attempts: number;
  last_error: { code: "PROVIDER_ERROR" | "RATE_LIMITED" | "INVALID_INPUT"; message: string } | null;
  mail_id: string | null; next_attempt_at: number | null; created_at: number; updated_at: number;
}

/** Internal local-devnet inspection only. The devnet boundary checks the world before passing worker Sql. */
export async function readNotices(sql: Sql, options: { to?: string; template?: string; limit?: number } = {}): Promise<DeliveryRecord[]> {
  const maximum = options.limit ?? 200, mailbox = options.to?.trim().toLowerCase() ?? null;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 200 || mailbox === "")
    throw new Error("INVALID_INPUT: notice limit must be 1..200 and recipient nonempty");
  return options.template === undefined
    ? (await sql.query("select * from app.notices_by_changed($1,$2)", [mailbox, maximum])).rows
    : (await sql.query("select * from app.notices_by_template_changed($1,$2,$3)", [options.template, mailbox, maximum])).rows;
}

const transitioned: Emit = async (sql, props, at, id, trace) => {
  await emit(sql, { id: `notice:${id}`, name: "notice_transitioned", machine: "notice", entity_id: props.notice_id,
    owner_kind: props.org_id ? "organization" : props.person_id ? "person" : null,
    owner_id: props.org_id ?? props.person_id, actor: null, trace_id: trace, at, props });
};

/** `now` is devnet's canonical worldNow, injected by composition (notices.worker-authority); never a host clock. */
export async function deliverNotices(db: Database, mail: Mail, now: WorldNow) {
  return deliverDue(db, mail, now, transitioned);
}

/** Runtime integration, not a public notice procedure. The Core drain awaits this whole tick. */
export function noticesWorker(db: Database, mail: Mail, sources: Omit<Sources,"partyName">, links: Links, now: WorldNow) {
  const resolve = createResolver({ ...sources, partyName: async (sql, owner) => {
    const safe = owner.kind === "organization" ? (await sources.organization(sql,owner.id)).safe
      : (await sources.principal(sql,owner.id))?.safeAddress;
    return safe ? (await lookupBySafe(sql,safe))?.display_name ?? null : null;
  } }, links);
  return async () => {
    const scheduled = await relay(db, "notices", sourceNames, schedule);
    const prepared = await prepareDue(db, now, resolve);
    const delivered = await deliverNotices(db, mail, now);
    const finished = await finishDue(db, now);
    return scheduled + prepared + delivered + finished;
  };
}
