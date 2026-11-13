import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database, Sql } from "../platform/db.ts";
export { Database } from "../platform/db.ts";

export type WorldClock = { nowMs: number; clockMode: "stopped" | "running"; rate: number };
/** Business time in the caller's transaction; no host-time fallback or unanchored extrapolation. */
export async function worldNow(sql: Sql): Promise<number> {
  const rows = (await sql.query("select clock from app.world")).rows;
  const clock = rows[0]?.clock;
  if (rows.length !== 1 || !Number.isSafeInteger(clock?.nowMs) || !Number.isFinite(clock?.rate) || clock.rate < 1 || clock.rate > 60 ||
      !["stopped", "running"].includes(clock?.clockMode)) throw new Error("INVALID_CLOCK: one valid authority clock required");
  if (clock.clockMode !== "stopped") throw new Error("UNSUPPORTED_CLOCK: running authority with anchored stops is not installed");
  return clock.nowMs;
}
export async function updateWorldClock(db: Database, clock: WorldClock) {
  if (!Number.isSafeInteger(clock.nowMs) || !Number.isFinite(clock.rate) || clock.rate < 0 || !["stopped", "running"].includes(clock.clockMode)) throw new Error("INVALID_CLOCK: authority clock required");
  await db.worker.query("update app.world set clock=$1", [clock]);
}

/** File stem the supervisor and Core share for one consumer's resume fault; consumer names never enter paths. */
export const resumeFaultStem = (consumer: string) => `resume-${createHash("sha256").update(consumer).digest("hex").slice(0, 32)}`;

/**
 * Devnet-only resume fault point between a consumer's effect and its ACK, inside their shared transaction.
 * Inert unless the world supervisor gave this Core a private CAPXUL_FAULT_DIR. An armed consumer claims its
 * one-shot arm by rename, reports where it stopped, then holds the uncommitted effect until the supervisor's SIGKILL.
 */
export async function resumeFault(consumer: string, event: { id: string; name: string; props: Record<string, unknown> }): Promise<void> {
  const directory = process.env.CAPXUL_FAULT_DIR;
  if (!directory) return;
  const stem = join(directory, resumeFaultStem(consumer));
  let arm: { event?: string; transition?: string };
  try { arm = JSON.parse(await readFile(`${stem}.armed`, "utf8")); } catch (error: any) { if (error.code === "ENOENT") return; throw error; }
  // An arm may name the event and its transition; any other delivery of this consumer passes untouched.
  if ((arm.event && arm.event !== event.name) || (arm.transition && arm.transition !== event.props.transition)) return;
  try { await rename(`${stem}.armed`, `${stem}.claimed`); } catch (error: any) { if (error.code === "ENOENT") return; throw error; }
  await writeFile(`${stem}.tmp`, JSON.stringify({ consumer, eventId: event.id, event: event.name, transition: event.props.transition ?? null,
    pid: process.pid, at: Date.now() }), { mode: 0o600 });
  await rename(`${stem}.tmp`, `${stem}.reached`);
  await new Promise<never>(() => { setInterval(() => {}, 60_000); });
}

export async function readSnapshotCut(db: Database) {
  return db.transaction("", async (sql) => {
    const world = (await sql.query("select world_id,epoch,clock,lineage from app.world")).rows[0];
    const heads = (await sql.query(`select distinct on (org_id) org_id,id,hash from app.records order by org_id,id desc`)).rows;
    const recordSeq = heads.reduce((max, h) => Math.max(max, Number(h.id)), 0);
    const recordHead = createHash("sha256").update(JSON.stringify(heads)).digest("hex");
    return { ...world, epoch: Number(world.epoch), recordSeq, recordHead, heads };
  }, true);
}
export async function rewriteRestoredWorld(db: Database, input: {
  worldId: string; epoch: number; clock: unknown;
  lineage: { snapshot: string; parentWorld: string; recordSeq: number; recordHead: string };
  sites: Record<string, string>; coreUrl?: string;
}) {
  const origin = input.coreUrl ? new URL(input.coreUrl) : undefined;
  if (origin && !["http:", "https:"].includes(origin.protocol)) throw new Error("INVALID_CORE_URL: HTTP(S) gateway origin required");
  return db.transaction("", async (sql) => {
    await sql.query("update app.world set world_id=$1,epoch=$2,clock=$3,lineage=$4", [input.worldId, input.epoch, input.clock, input.lineage]);
    for (const [org, site] of Object.entries(input.sites)) {
      await sql.query("update app.organizations set site=$2 where org_id=$1", [org, site]);
      await sql.query("update app.approvals set request=jsonb_set(request,'{site}',to_jsonb($2::text)) where org_id=$1", [org, site]);
      await sql.query("update app.site_request_answers set request=jsonb_set(request,'{site}',to_jsonb($2::text)) where org_id=$1", [org, site]);
      if (origin) await sql.query(`update app.site_request_answers set answer=jsonb_set(answer,'{approval_url}',
        to_jsonb(regexp_replace(answer->>'approval_url','^https?://[^/?#]+',$2,'i')))
        where org_id=$1 and answer->>'approval_url'<>''`, [org, origin.origin]);
    }
    await sql.query("insert into app.world_record (kind,data) values ('restored',$1)", [input]);
  }, true);
}
export async function exportAbandonedBranch(db: Database) {
  return db.transaction("", async (sql) => ({
    world: (await sql.query("select * from app.world")).rows,
    lifecycle: (await sql.query("select * from app.world_record order by id")).rows,
    records: (await sql.query("select * from app.records order by id")).rows,
  }), true);
}
