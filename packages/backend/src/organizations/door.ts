import { readFileSync } from "node:fs";
import type { Database, Sql } from "../platform/db.ts";

export { begin, get, readAdmittedDeployment, readSetupFounder, resume, view, type AdmittedDeployment, FUNDAMENTAL_APPS, HEAD_APPS, SEATS_AT_BIRTH,
  type BeginInput, type Board, type SetupIssue, type SetupServices, type SetupStatus, type SetupView } from "./setups.ts";
export { addBoughtSeats, returnBoughtSeats, type BoughtSeats } from "./procedures.ts";
export { advance, type Advanced, type MoneyDeploymentFact, type SetupProcessServices } from "./process.ts";
export { onApprovalEnded, onApprovalTransitioned } from "./install-approval.ts";
export { setupFacts, setupRunner, setupServicesFromEnv, type SetupBindings, type SetupChain, type SetupRunnerOptions } from "./runner.ts";

export type WorldCompany = { orgId: string; name: string; site: string | null };

/** World-scoped service inventory, not tenant admission: every Organization by orgId, with its site host or null. The
 * caller authorizes the world read and selects the world. Names are read by the worker; each site host in that
 * Organization's own scoped worker transaction (Sites' app.sites admits one Organization at a time), so `hosts` is
 * Sites' `readSiteHosts`. */
export async function readWorldCompanies(db: Database, hosts: (sql: Sql) => Promise<Record<string, string>>): Promise<WorldCompany[]> {
  const orgs = await db.transaction("", async (sql) => {
    const role = (await sql.query<{ role: string }>("select current_user as role")).rows[0]!.role;
    if (role !== "capxul_worker") throw new Error("FORBIDDEN: world company inventory requires capxul_worker");
    return (await sql.query<{ orgId: string; name: string }>('select org_id as "orgId",name from app.organizations order by org_id')).rows;
  }, true);
  const companies: WorldCompany[] = [];
  for (const o of orgs) companies.push({ ...o, site: (await db.transaction(o.orgId, hosts, true))[o.orgId] ?? null });
  return companies;
}

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
