import { readFileSync } from "node:fs";
import { record, type Sql } from "../platform/db.ts";

export type WorldCompany = { orgId: string; name: string; site: string | null };

/** Explicit privileged provisioning after the foundation schema; never run during a read. */
export async function migrateWorldCompanies(sql: Sql): Promise<void> {
  await sql.query(readFileSync(new URL("./world-companies.sql", import.meta.url), "utf8"));
}

/** World-scoped service inventory, not tenant admission. Caller authorizes and selects the world. */
export async function readWorldCompanies(sql: Sql): Promise<WorldCompany[]> {
  const role = (await sql.query<{ role: string }>("select current_user as role")).rows[0]!.role;
  if (role !== "capxul_worker") throw new Error("FORBIDDEN: world company inventory requires capxul_worker");
  // Existing worker RLS admits the whole DB. site is stored metadata, not a proven public URL.
  return (await sql.query<WorldCompany>('select org_id as "orgId",name,site from app.organizations order by org_id')).rows;
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
