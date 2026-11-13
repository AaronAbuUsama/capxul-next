import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Database, Sql } from "../platform/db.ts";

/** World creation only, after base roles/schema and the common outbox; never on up or restore. */
export async function migrateAccess(sql: Sql): Promise<void> {
  await sql.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
}

export { challenge, sendCode, verifyCode, withKey, revoke, type AccessConfig, type SignIn } from "./sign-in.ts";
export { routeAccess, accessPaths, accessError, type AccessServices } from "./routes.ts";

export type Principal = {
  personId: string; kind: "person" | "agent"; email: string | null;
  safeAddress: string; signerAddress: string | null;
};
export type GateRule = { ids: string[] | null; rollout: number };
export type Flag = { key: string; active: boolean; target: "person" | "organization";
  rules: GateRule[]; unsupported: string | null; checked_at: Date };
export type Gate = { target: Flag["target"]; money: boolean };
export type GateCatalogue = Readonly<Record<string, Gate>>;
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || email.split("@")[0]!.length > 64 ||
    !/^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+(?:\.[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+)*@[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?)+$/u.test(email))
    throw new Error("INVALID_INPUT: email");
  return email;
}
function principal(row: Record<string, any>): Principal {
  return { personId: row.person_id, kind: row.kind, email: row.email,
    safeAddress: row.safe_address, signerAddress: row.signer_address };
}

/** Runtime boundary, called on the request's checked-out transaction before any concept door. */
export async function authenticate(sql: Sql, bearer: string, now: number): Promise<Principal> {
  // Clear a previous actor even when the next bearer is missing or invalid.
  await sql.query(`select set_config('app.person_id','',true),set_config('app.email','',true),set_config('app.safe_address','',true),
    set_config('app.owner_kind','',true),set_config('app.owner_id','',true),set_config('app.org_id','',true)`);
  if (!/^[A-Za-z0-9_-]{43}$/.test(bearer)) throw new Error("NOT_AUTHENTICATED: session required");
  const row = (await sql.query("select * from app.resolve_bearer($1,$2)", [digest(bearer), new Date(now)])).rows[0];
  if (!row) throw new Error("NOT_AUTHENTICATED: session ended or expired");
  await sql.query(`select set_config('app.person_id',$1,true),set_config('app.email',$2,true),set_config('app.safe_address',$3,true),
    set_config('app.owner_kind','person',true),set_config('app.owner_id',$1,true)`, [row.person_id, row.email ?? "", row.safe_address]);
  return principal(row);
}

/** Normal callers can read only their own row; committed-source consumers use the restricted worker. */
export async function readPrincipal(sql: Sql, personId: string): Promise<Principal | null> {
  const row = (await sql.query("select * from app.principals where person_id=$1", [personId])).rows[0];
  return row ? principal(row) : null;
}
export async function readPrincipalBySafe(sql: Sql, safe: string): Promise<Principal | null> {
  const row = (await sql.query("select * from app.principals where safe_address=$1", [safe.toLowerCase()])).rows[0];
  return row ? principal(row) : null;
}
export async function readPrincipalByEmail(sql: Sql, email: string): Promise<Principal | null> {
  const row = (await sql.query("select * from app.principals where email=$1", [normalizeEmail(email)])).rows[0];
  return row ? principal(row) : null;
}

/** The catalogue belongs to deployment code, not arbitrary PostHog definitions or request bodies. */
export async function feature(sql: Sql, key: string, actor: { personId: string; orgId?: string },
  catalogue: GateCatalogue, now: number): Promise<boolean> {
  const gate = catalogue[key];
  if (!gate) throw new Error("INVALID_INPUT: unknown feature key");
  const subject = gate.target === "person" ? actor.personId : actor.orgId;
  if (!subject) return false;
  const flag = (await sql.query<Flag>("select * from app.feature_flags where key=$1", [key])).rows[0];
  if (!flag || !flag.active || flag.unsupported || flag.target !== gate.target ||
    gate.money && now - flag.checked_at.getTime() > 600_000) return false;
  // PostHog's local boolean rollout algorithm, not a process-dependent hash.
  const bucket = parseInt(createHash("sha1").update(`${key}.${subject}`).digest("hex").slice(0, 15), 16) / 0xfffffffffffffff;
  return flag.rules.some((rule) => (rule.ids === null || rule.ids.includes(subject)) &&
    Number.isInteger(rule.rollout) && rule.rollout >= 0 && rule.rollout <= 100 && bucket < rule.rollout / 100);
}
export async function requireFeature(sql: Sql, key: string, actor: { personId: string; orgId?: string },
  catalogue: GateCatalogue, now: number): Promise<void> {
  if (!await feature(sql, key, actor, catalogue, now)) throw new Error("FEATURE_NOT_AVAILABLE: feature is off");
}

/** Core's deployment catalogue (access.gate-catalogue): the only gates Core reads, with their targets and money class. */
export const gates: GateCatalogue = {
  "beta-access": { target: "person", money: false },
  "owner-safe-proposals": { target: "organization", money: true },
  "payment-agreements": { target: "organization", money: true },
  equity: { target: "organization", money: true },
  books: { target: "organization", money: false },
  "payslip-preview": { target: "organization", money: false },
};

/**
 * The approval carrier's held-send check: the approval's gate, read through `gates` for its signer and Organization at
 * world time in its own read, then `needs` without the gate. A key the catalogue does not name stays closed.
 */
export function gatedNeeds<A extends { gate: string | null; person_id: string; org_id: string | null }>(
  db: Database, now: () => Promise<Date>, needs: (approval: A) => Promise<boolean>) {
  return async (approval: A): Promise<boolean> => {
    const key = approval.gate;
    if (key !== null) {
      if (!Object.hasOwn(gates, key)) return false;
      const at = (await now()).getTime();
      const actor = { personId: approval.person_id, ...(approval.org_id ? { orgId: approval.org_id } : {}) };
      if (!await db.transaction("", (sql) => feature(sql, key, actor, gates, at), true)) return false;
    }
    return needs({ ...approval, gate: null });
  };
}

/** The workflow fetches first; failed provider reads must never call this transaction-local writer. */
export async function syncFlags(sql: Sql, flags: readonly Flag[], catalogue: GateCatalogue, now: number) {
  const kept = flags.filter((flag) => catalogue[flag.key]);
  if (new Set(kept.map((flag) => flag.key)).size !== kept.length) throw new Error("INVALID_INPUT: duplicate flags");
  for (const flag of kept) {
    const unsupported = flag.unsupported ?? (flag.target !== catalogue[flag.key]!.target || !Array.isArray(flag.rules) ||
      flag.rules.some((rule) => !Number.isInteger(rule.rollout) || rule.rollout < 0 || rule.rollout > 100 ||
        rule.ids !== null && (!Array.isArray(rule.ids) || rule.ids.some((id) => typeof id !== "string"))) ? "unsupported rule" : null);
    await sql.query(`insert into app.feature_flags(key,active,target,rules,unsupported,checked_at) values($1,$2,$3,$4,$5,$6)
      on conflict(key) do update set active=excluded.active,target=excluded.target,rules=excluded.rules,
      unsupported=excluded.unsupported,checked_at=excluded.checked_at`,
    [flag.key, flag.active, catalogue[flag.key]!.target, JSON.stringify(Array.isArray(flag.rules) ? flag.rules : []), unsupported, new Date(now)]);
  }
  await sql.query("delete from app.feature_flags where not(key=any($1::text[]))", [kept.map((flag) => flag.key)]);
}
