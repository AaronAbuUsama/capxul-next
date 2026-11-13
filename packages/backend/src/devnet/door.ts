import { createHash } from "node:crypto";
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

/** devnet.warp-barrier: the instants Core's own due work falls at, each with what keeps a row open. A warp stops at every one of
 *  them and moves on only when none at or before the stop is still open. A concept with new due work adds its table here. */
const DUE = [
  { table: "app.notice_workflows", at: "coalesce(retry_at,due_at)", open: "finished_at is null and failed_at is null and checkpoint is null" },
  { table: "app.notice_attempts", at: "due_at", open: "due_at is not null" },
] as const;
async function dueTables(db: Database) {
  const present = (await db.worker.query("select t from unnest($1::text[]) t where to_regclass(t) is not null", [DUE.map((d) => d.table)])).rows.map((r) => r.t);
  return DUE.filter((d) => present.includes(d.table));
}
/** The earliest open due instant after `after` and not after `until`, or null. */
export async function nextDue(db: Database, after: number, until: number): Promise<number | null> {
  let next: number | null = null;
  for (const d of await dueTables(db)) {
    const at = (await db.worker.query(`select min(${d.at}) as at from ${d.table} where ${d.open} and ${d.at}>$1 and ${d.at}<=$2`, [after, until])).rows[0]?.at;
    if (at !== null && at !== undefined && (next === null || Number(at) < next)) next = Math.ceil(Number(at));
  }
  return next;
}
/** How many rows of Core's due work at or before `at` are still open, by table: zero everywhere means Core has settled at `at`. */
export async function openDue(db: Database, at: number): Promise<Record<string, number>> {
  const open: Record<string, number> = {};
  for (const d of await dueTables(db)) {
    const n = Number((await db.worker.query(`select count(*) as n from ${d.table} where ${d.open} and ${d.at}<=$1`, [at])).rows[0].n);
    if (n) open[d.table] = n;
  }
  return open;
}
