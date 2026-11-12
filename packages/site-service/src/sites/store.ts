import { readFileSync } from "node:fs";
import type pg from "pg";
import { ServiceError } from "./http.ts";

type Sql = Pick<pg.PoolClient, "query">;
type Database = { transaction<T>(org: string, run: (sql: Sql) => Promise<T>, system?: boolean): Promise<T> };
type RecordEvent = (sql: Sql, org: string, kind: string, trace: string, data: unknown) => Promise<void>;
export type SiteRow = { org_id: string; site_id: string; world_id: string; slug: string; host: string;
  state: "creating" | "ready" | "suspended" | "archived" | "failed"; bench: string;
  app_version: string | null; map_version: string | null; failure: string | null;
  created_at: number; ready_at: number | null; updated_at: number };
type Call = { org: string; callId: string; person: string; verb: string; doctype: string | null; name: string | null;
  outcome: "ok" | "refused" | "held" | "failed"; refusal: string | null; trace: string };
const defaults = { accounts: true, people: true, projects: true, crm: true, payroll: false, whatsapp: false,
  attendance: false, recruitment: false, reviews: false, stock: false, manufacturing: false };

/** Invoke inside the migration owner's transaction after Core schema/roles exist. No new runtime credentials. */
export async function migrateSites(sql: Sql): Promise<void> {
  await sql.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
}

/** Migration authority, inside the paused restore transaction only. Never migrates or asserts readiness. */
export async function rewriteSites(sql: Sql, input: { world: string; bench: string; sites: Record<string, string> }): Promise<void> {
  const rows = (await sql.query<SiteRow>("select * from app.sites order by org_id for update")).rows;
  if (!input.world || !input.bench || rows.length !== Object.keys(input.sites).length ||
      rows.some((row) => !input.sites[row.org_id]) || new Set(Object.values(input.sites)).size !== rows.length)
    throw new ServiceError(400, "INVALID_INPUT", "Restore must map every saved site to a unique target host");
  for (const row of rows) await sql.query("update app.sites set host=$2,world_id=$3,bench=$4 where org_id=$1",
    [row.org_id, input.sites[row.org_id], input.world, input.bench]);
}

/** SQL callbacks reuse the checked-out tenant connection; no nested pool checkout. */
export class SitesStore {
  readonly db: Database;
  readonly record: RecordEvent;
  constructor(db: Database, record: RecordEvent) { this.db = db; this.record = record; }

  site(org: string): Promise<SiteRow | undefined> {
    return this.db.transaction(org, async (sql) => (await sql.query<SiteRow>("select * from app.sites where org_id=$1", [org])).rows[0]);
  }

  async confirmFeatures(org: string, features: Record<string, "on" | "off">): Promise<void> {
    await this.db.transaction(org, async (sql) => {
      const rows = (await sql.query("select feature,state from app.site_features where org_id=$1", [org])).rows;
      if (rows.length !== Object.keys(defaults).length || Object.keys(features).length !== rows.length ||
          rows.some((row) => features[row.feature] !== row.state))
        throw new ServiceError(502, "PROVIDER_RESPONSE_INVALID", "The site's actual features differ from the recorded defaults");
    });
  }

  async begin(input: { org: string; world: string; host: string; bench: string; trace: string }): Promise<void> {
    await this.db.transaction(input.org, async (sql) => {
      // Site id is stable for the organization; the host is not its identity (a clone can rename it).
      await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [input.org]);
      const old = (await sql.query<SiteRow>("select * from app.sites where org_id=$1 for update", [input.org])).rows[0];
      if (old && (old.host !== input.host || old.world_id !== input.world || old.bench !== input.bench))
        throw new ServiceError(400, "INVALID_INPUT", "A site's registered identity cannot be rebound");
      if (old && ["suspended", "archived"].includes(old.state))
        throw new ServiceError(403, "ROLE_PERMISSION_DENIED", "The site is not being served");
      if (old && old.state !== "failed") return;
      const now = Date.now();
      await sql.query(`insert into app.sites (org_id,site_id,world_id,slug,host,state,bench,created_at,updated_at)
        values ($1,$1,$2,$1,$3,'creating',$4,$5,$5) on conflict (org_id,site_id)
        do update set state='creating',failure=null,updated_at=excluded.updated_at`, [input.org, input.world, input.host, input.bench, now]);
      await this.record(sql, input.org, "site_transitioned", input.trace,
        { from: old?.state ?? null, to: "creating", transition: old ? "retry" : "begin", org_id: input.org, world_id: input.world });
      for (const [feature, wanted] of Object.entries(defaults)) {
        const result = await sql.query(`insert into app.site_features (org_id,feature,state,wanted,updated_at)
          values ($1,$2,$3,$4,$5) on conflict do nothing returning feature`, [input.org, feature, wanted ? "on" : "off", wanted, now]);
        if (result.rowCount) await this.record(sql, input.org, "site_feature_transitioned", input.trace,
          { from: null, to: wanted ? "on" : "off", transition: wanted ? "seed_on" : "seed_off", org_id: input.org, feature });
      }
    });
  }

  async transition(org: string, event: "ready" | "fail" | "suspend" | "resume" | "archive", trace: string,
    details: { appVersion?: string; mapVersion?: string; failure?: string } = {}): Promise<void> {
    await this.db.transaction(org, async (sql) => {
      await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [org]);
      const row = (await sql.query<SiteRow>("select * from app.sites where org_id=$1 for update", [org])).rows[0];
      const allowed = { ready: ["creating"], fail: ["creating"], suspend: ["ready"], resume: ["suspended"], archive: ["ready", "suspended", "failed"] };
      const target = { ready: "ready", fail: "failed", suspend: "suspended", resume: "ready", archive: "archived" }[event];
      if (!row) throw new ServiceError(400, "INVALID_INPUT", "The site does not exist");
      if (row.state === target) return;
      if (!allowed[event].includes(row.state)) throw new ServiceError(409, "WRONG_STATE", "Invalid site transition");
      if (event === "ready" && (!details.appVersion || !details.mapVersion)) throw new ServiceError(400, "INVALID_INPUT", "Ready requires the observed app and map versions");
      if (event === "ready") {
        const delivery = (await sql.query(`select released and next_seq>1 and last_ack=next_seq-1 and
          not exists(select 1 from app.site_events e where e.org_id=$1 and e.state<>'applied') as acknowledged
          from app.organizations where org_id=$1`, [org])).rows[0];
        if (!delivery?.acknowledged) throw new ServiceError(409, "WRONG_STATE", "First site events are not acknowledged");
      }
      if (event === "fail" && !details.failure) throw new ServiceError(400, "INVALID_INPUT", "A failed creation must retain its failure");
      const now = Date.now();
      await sql.query(`update app.sites set state=$2,updated_at=$3,failure=$4,
        ready_at=case when $2='ready' then coalesce(ready_at,$3) else ready_at end,
        app_version=coalesce($5,app_version),map_version=coalesce($6,map_version) where org_id=$1`,
      [org, target, now, event === "fail" ? details.failure : null, details.appVersion ?? null, details.mapVersion ?? null]);
      await this.record(sql, org, "site_transitioned", trace,
        { from: row.state, to: target, transition: event, org_id: org, world_id: row.world_id });
    });
  }

  async logCall(call: Call): Promise<void> {
    await this.db.transaction(call.org, async (sql) => {
      await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [call.org]);
      const old = (await sql.query("select * from app.door_calls where org_id=$1 and call_id=$2 for update", [call.org, call.callId])).rows[0];
      if (old && (old.person_id !== call.person || old.verb !== call.verb || old.doctype !== call.doctype ||
          old.docname && call.name && old.docname !== call.name)) throw new ServiceError(400, "INVALID_INPUT", "The call id belongs to a different call");
      // Keep the first successful effect, even if its replay is refused after the person's permission was revoked.
      if (old && ["ok", "held"].includes(old.outcome)) return;
      await sql.query(`insert into app.door_calls (org_id,call_id,person_id,verb,doctype,docname,outcome,refusal,created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (org_id,call_id)
        do update set docname=excluded.docname,outcome=excluded.outcome,refusal=excluded.refusal`,
      [call.org, call.callId, call.person, call.verb, call.doctype, call.name, call.outcome, call.refusal, Date.now()]);
      await this.record(sql, call.org, "document_door_call", call.trace,
        { call_id: call.callId, verb: call.verb, doctype: call.doctype, docname: call.name, outcome: call.outcome, refusal: call.refusal });
    });
  }
}
