import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import type { Sql } from "../platform/db.ts";
import { emit, readEvent, type TransitionEvent } from "../platform/outbox.ts";
import { worldNow } from "../devnet/door.ts";
import type { SiteAck } from "./site-contracts.ts";
import { enqueue } from "./door.ts";

export type RoleOccurrence = { id: string; at: number; trace_id: string; actor: string | null };
export type RoleGrant = {
  org_id: string; grant_id: string; person_id: string; address: string; hat: string;
  department: string | null; roles: string[]; map_version: string;
  chain_tx_hash: string; chain_log_index: number;
  status: "pending" | "applied" | "failed" | "revoked"; failure: string | null;
  created_at: number; updated_at: number;
};
export type GrantInput = Omit<RoleGrant, "status" | "failure" | "created_at" | "updated_at"> & { email: string; name: string };
export type GrantChange = { transition: "apply"; map_version: string }
  | { transition: "fail"; failure: string } | { transition: "revoke" | "retire" };

/** Explicit provisioning only. Composition owns this transaction and migrates the common outbox first. */
export async function migrateRoleProjections(sql: Sql): Promise<void> {
  await sql.query(readFileSync(new URL("./roles.sql", import.meta.url), "utf8"));
}

function event(row: RoleGrant, occurrence: RoleOccurrence, from: RoleGrant["status"] | null,
  to: RoleGrant["status"], transition: string): TransitionEvent {
  if (!occurrence.id || !Number.isSafeInteger(occurrence.at) || occurrence.at < 0) throw new Error("INVALID_INPUT: role occurrence");
  return {
    id: JSON.stringify(["plugs.role-grant", row.org_id, occurrence.id]), name: "role_grant_transitioned", machine: "role-grant",
    entity_id: row.grant_id, owner_kind: "organization", owner_id: row.org_id,
    actor: occurrence.actor, trace_id: occurrence.trace_id, at: occurrence.at,
    props: { from, to, transition, org_id: row.org_id, hat: row.hat, department: row.department, roles: row.roles.length },
  };
}

/** Trusted storage boundary, not an HTTP authority door. Finalized fact, canonical person and shipped map come from composition. */
export async function recordRoleGrant(sql: Sql, input: GrantInput, occurrence: RoleOccurrence): Promise<RoleGrant> {
  const { email, name, ...source } = input;
  if (!source.org_id || !source.grant_id || !source.person_id || !source.hat || !source.map_version || !email || !name ||
      !/^0x[0-9a-fA-F]{40}$/.test(source.address) || !/^0x[0-9a-fA-F]{64}$/.test(source.chain_tx_hash) ||
      !Number.isSafeInteger(source.chain_log_index) || source.chain_log_index < 0 ||
      !source.roles.length || source.roles.some((role) => !role) || new Set(source.roles).size !== source.roles.length) {
    throw new Error("INVALID_INPUT: finalized role grant");
  }
  source.address = source.address.toLowerCase(); source.chain_tx_hash = source.chain_tx_hash.toLowerCase();
  source.department = source.department || null;
  source.roles = [...source.roles].sort();
  const row: RoleGrant = { ...source, status: "pending", failure: null, created_at: occurrence.at, updated_at: occurrence.at };
  const born = event(row, occurrence, null, "pending", "record");
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [source.org_id]);
  const old: RoleGrant | undefined = (await sql.query(`select * from app.role_grants
    where org_id=$1 and (grant_id=$2 or (chain_tx_hash=$3 and chain_log_index=$4))`,
  [source.org_id, source.grant_id, source.chain_tx_hash, source.chain_log_index])).rows[0];
  if (old) {
    const { status: _status, failure: _failure, created_at: _created, updated_at: _updated, ...identity } = old;
    identity.department = identity.department || null;
    if (!isDeepStrictEqual(identity, source)) throw new Error("IDEMPOTENCY_CONFLICT: role occurrence changed");
    await emit(sql, event(old, occurrence, null, "pending", "record")); return old;
  }
  const user = (await sql.query("select * from app.site_users where org_id=$1 and person_id=$2 for update", [source.org_id, source.person_id])).rows[0];
  if (user && user.address !== source.address) throw new Error("IDEMPOTENCY_CONFLICT: canonical person address changed");
  await sql.query(`insert into app.site_users
    (org_id,person_id,address,email,name,frappe_user,created_by_grant_id,status,created_at,updated_at)
    values ($1,$2,$3,$4,$5,$4,$6,'active',$7,$7) on conflict (org_id,person_id) do update
    set email=excluded.email,name=excluded.name,status='active',updated_at=excluded.updated_at`,
  [source.org_id, source.person_id, source.address, email, name, source.grant_id, occurrence.at]);
  await sql.query(`insert into app.role_grants
    (org_id,grant_id,person_id,address,hat,department,roles,map_version,chain_tx_hash,chain_log_index,status,failure,created_at,updated_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',null,$11,$11)`,
  [row.org_id, row.grant_id, row.person_id, row.address, row.hat, row.department, row.roles, row.map_version, row.chain_tx_hash, row.chain_log_index, occurrence.at]);
  await enqueue(sql, row.org_id, occurrence.id, "hat_granted", {
    hat: row.hat, person_email: user?.frappe_user ?? email, person_name: name, address: row.address,
    department: row.department, tx_hash: row.chain_tx_hash,
  }, occurrence.trace_id, occurrence.at);
  await emit(sql, born);
  return row;
}

/** Apply/fail comes from the native delivery acknowledgement; revoke/retire from a new finalized chain occurrence. */
export async function transitionRoleGrant(sql: Sql, org: string, grantId: string, change: GrantChange, occurrence: RoleOccurrence): Promise<RoleGrant> {
  await sql.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [org]);
  const row: RoleGrant | undefined = (await sql.query("select * from app.role_grants where org_id=$1 and grant_id=$2 for update", [org, grantId])).rows[0];
  if (!row) throw new Error("NOT_FOUND: role grant");
  if (change.transition === "apply" && change.map_version !== row.map_version) throw new Error("PROVIDER_RESPONSE_INVALID: native hat map differs from recorded grant");
  if (change.transition === "fail" && !change.failure) throw new Error("INVALID_INPUT: failed grant requires its reason");
  const to = { apply: "applied", fail: "failed", revoke: "revoked", retire: "revoked" }[change.transition] as RoleGrant["status"];
  const candidate = event(row, occurrence, row.status, to, change.transition);
  const old = await readEvent(sql, candidate.id);
  if (old) {
    // A source retry after later transitions must not replay an old state change or enqueue removal again.
    await emit(sql, { ...candidate, props: { ...candidate.props, from: old.props.from } }); return row;
  }
  const allowed = { apply: ["pending", "failed"], fail: ["pending"], revoke: ["applied", "failed"], retire: ["pending"] };
  if (!allowed[change.transition].includes(row.status)) throw new Error("WRONG_STATE: invalid role transition");
  const failure = change.transition === "fail" ? change.failure : null;
  await sql.query("update app.role_grants set status=$3,failure=$4,updated_at=$5 where org_id=$1 and grant_id=$2", [org, grantId, to, failure, occurrence.at]);
  if (to === "revoked") {
    const user = (await sql.query("select frappe_user,name from app.site_users where org_id=$1 and person_id=$2", [org, row.person_id])).rows[0]!;
    const retained = await sql.query(`select 1 from app.role_grants where org_id=$1 and person_id=$2 and hat=$3
      and nullif(department,'') is not distinct from nullif($4::text,'') and status<>'revoked'`, [org, row.person_id, row.hat, row.department]);
    // Native grants are keyed by person/hat/department, not the historical source log.
    if (!retained.rowCount) await enqueue(sql, org, occurrence.id, "hat_revoked", {
      hat: row.hat, person_email: user.frappe_user, person_name: user.name, address: row.address, department: row.department,
    }, occurrence.trace_id, occurrence.at);
    await sql.query(`update app.site_users set status=case when exists
      (select 1 from app.role_grants where org_id=$1 and person_id=$2 and status<>'revoked') then 'active' else 'disabled' end,
      updated_at=$3 where org_id=$1 and person_id=$2`, [org, row.person_id, occurrence.at]);
  }
  await emit(sql, candidate);
  return { ...row, status: to, failure, updated_at: occurrence.at };
}

/** Same delivery/repair transaction. Only our durable record occurrence can identify a projected grant. */
export async function settleRoleDelivery(sql: Sql, org: string, key: string, ack: SiteAck): Promise<number | undefined> {
  const born = await readEvent(sql, JSON.stringify(["plugs.role-grant", org, key]));
  if (!born) return; // Legacy hat events have no Core grant projection.
  if (born.name !== "role_grant_transitioned" || born.owner_kind !== "organization" || born.owner_id !== org ||
      born.props.transition !== "record") throw new Error("INVALID_INPUT: role delivery source occurrence");
  const row: RoleGrant | undefined = (await sql.query("select * from app.role_grants where org_id=$1 and grant_id=$2 for update", [org, born.entity_id])).rows[0];
  if (!row) throw new Error("NOT_FOUND: projected delivery grant");
  const at = await worldNow(sql);
  // A rewind or repair must never reactivate an old revoked grant or repeat an applied occurrence.
  if (row.status === "revoked" || row.status === "applied" || ack.parked && row.status === "failed") return at;
  const change: GrantChange = ack.parked ? { transition: "fail", failure: ack.error }
    : { transition: "apply", map_version: ack.map_version ?? "" };
  await transitionRoleGrant(sql, org, row.grant_id, change, {
    id: JSON.stringify(["native-ack", key, change.transition]), at, trace_id: born.trace_id, actor: null,
  });
  return at;
}

/** Internal read: the public caller must authorize self/Director before selecting organization owner scope. */
export async function readRoles(sql: Sql, org: string, person: string) {
  const user = (await sql.query("select frappe_user from app.site_users where org_id=$1 and person_id=$2", [org, person])).rows[0];
  const grants: RoleGrant[] = (await sql.query("select * from app.role_grants where org_id=$1 and person_id=$2 order by created_at,grant_id", [org, person])).rows;
  const roles = [...new Set(grants.filter((grant) => grant.status === "applied").flatMap((grant) => grant.roles))].sort();
  return { person, frappeUser: user?.frappe_user ?? null, grants, roles };
}
