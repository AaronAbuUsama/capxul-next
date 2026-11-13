import { readFileSync } from "node:fs";
import { record, type Sql } from "../platform/db.ts";

export { begin, get, readDeployment, readSetupFounder, resume, view, type Deployment, FUNDAMENTAL_APPS, HEAD_APPS, SEATS_AT_BIRTH,
  type BeginInput, type Board, type SetupIssue, type SetupServices, type SetupStatus, type SetupView } from "./setups.ts";
export { addBoughtSeats, returnBoughtSeats, type BoughtSeats } from "./procedures.ts";

/** Explicit privileged world provisioning, after Access and Parties; never a route or restore hook. */
export async function migrate(sql: Sql): Promise<void> {
  await sql.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
}

export type Actor = { principalId: string; kind: "human" | "agent"; safe: string };
export type Seat = {
  org_id: string; member_id: string; party_id: string; principal_id: string | null;
  kind: "human" | "agent"; safe_address: string; invitation_id: string | null;
  seat_use: "seat" | "owner-seat" | "organization"; covering_member_id: string | null;
  status: "active" | "removed"; removed_reason: "agent_removed" | null;
  joined_at: string; removed_at: string | null; updated_at: string;
};

/** Committed-source worker read, not actor authentication; the caller's existing RLS still applies. */
export async function readSeatBySafe(sql: Sql, orgId: string, wearerSafe: string): Promise<Seat | null> {
  return (await sql.query("select * from app.org_members where org_id=$1 and safe_address=$2 and status='active'",
    [orgId, wearerSafe.toLowerCase()])).rows[0] ?? null;
}

/** Actor is mapped from Access.authenticate, not request fields; owner scope is not authentication. Released Parties or
 * Organizations admit no Seat (app.current_member, the same rule as callerSafes and the Seat RLS). */
export async function requireSeat(sql: Sql, orgId: string, actor: Actor): Promise<Seat> {
  const row: Seat | undefined = (await sql.query(`select m.* from app.org_members m join app.principals p
    on p.person_id=nullif(current_setting('app.person_id',true),'')
    where m.org_id=$1 and m.status='active' and p.person_id=$2 and p.safe_address=$3
    and (($4='human' and p.kind='person' and m.kind='human' and m.principal_id=p.person_id)
      or ($4='agent' and p.kind='agent' and m.kind='agent' and m.safe_address=p.safe_address))
    and app.current_member(m.org_id)`,
  [orgId, actor.principalId, actor.safe.toLowerCase(), actor.kind])).rows[0];
  if (!row) throw new Error("ROLE_PERMISSION_DENIED: current Seat required");
  return row;
}

export async function callerSafes(sql: Sql): Promise<string[]> {
  return (await sql.query("select app.caller_safes() as safes")).rows[0].safes;
}

export type Registration = {
  slug: string; name: string; safe: string; site: string; adminEmail: string; token: string;
  hats?: Record<string, { name: string; department?: string }>;
  people?: { email: string; name: string; address: string; personalSafe?: string }[];
};
const address = /^0x[0-9a-fA-F]{40}$/;
export async function register(sql: Sql, b: Registration, trace: string) {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(b.slug) || !address.test(b.safe) || !address.test(b.token) || !b.site || !b.name || !b.adminEmail) {
    throw new Error("INVALID_INPUT: company slug, Safe, token, site, name and founder are required");
  }
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [b.slug]);
  const existing = (await sql.query("select * from app.organizations where org_id=$1", [b.slug])).rows[0];
  if (existing && (existing.safe !== b.safe.toLowerCase() || existing.token !== b.token.toLowerCase() || existing.site !== b.site)) {
    throw new Error("IDENTITY_CONFLICT: an existing company cannot be rebound to another Safe, token or site");
  }
  await sql.query(`insert into app.organizations (org_id,name,safe,site,admin_email,token) values ($1,$2,$3,$4,$5,$6)
    on conflict (org_id) do nothing`, [b.slug, b.name, b.safe.toLowerCase(), b.site, b.adminEmail, b.token.toLowerCase()]);
  for (const p of b.people ?? []) {
    if (!address.test(p.address) || p.personalSafe !== undefined && !address.test(p.personalSafe) || !p.email || !p.name || "privateKey" in p || "key" in p) throw new Error("INVALID_INPUT: directory people need addresses, never signing keys");
    await sql.query(`insert into app.people (org_id,address,email,name,personal_safe) values ($1,$2,$3,$4,$5)
      on conflict (org_id,address) do update set email=excluded.email,name=excluded.name,personal_safe=excluded.personal_safe`, [b.slug, p.address.toLowerCase(), p.email, p.name, p.personalSafe?.toLowerCase() ?? null]);
  }
  for (const [id, h] of Object.entries(b.hats ?? {})) {
    if (!/^\d+$/.test(id) || !h.name) throw new Error("INVALID_INPUT: hat IDs are uint256 decimal strings");
    await sql.query(`insert into app.hats (org_id,hat_id,name,department) values ($1,$2,$3,$4)
      on conflict (org_id,hat_id) do update set name=excluded.name,department=excluded.department`, [b.slug, id, h.name, h.department ?? null]);
  }
  if (!existing) await record(sql, b.slug, "company_registered", trace, { safe: b.safe.toLowerCase(), site: b.site });
  return info(sql, b.slug);
}
export async function info(sql: Sql, org: string) {
  const row = (await sql.query(`select org_id as slug,name,safe,site,admin_email as "adminEmail",token,released from app.organizations where org_id=$1`, [org])).rows[0];
  if (!row) throw new Error("NOT_FOUND: unknown company");
  const hats = Object.fromEntries((await sql.query("select hat_id,name,department from app.hats where org_id=$1", [org])).rows.map((h) => [h.hat_id, { name: h.name, department: h.department }]));
  const people = (await sql.query('select email,name,address,personal_safe as "personalSafe" from app.people where org_id=$1', [org])).rows;
  return { ...row, hats, people };
}
export async function release(sql: Sql, org: string) {
  const r = await sql.query("update app.organizations set released=true,retry_at=null where org_id=$1 returning org_id", [org]);
  if (!r.rowCount) throw new Error("NOT_FOUND: unknown company");
  return { ok: true };
}
