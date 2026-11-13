import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Effect } from "effect";
import pg from "pg";
import { digest, migrateAccess } from "../src/access/door.ts";
import { migrateAccounts } from "../src/accounts/door.ts";
import { migrate as migrateOrganizations } from "../src/organizations/door.ts";
import { Database } from "../src/platform/door.ts";
import { migrateOutbox } from "../src/platform/outbox.ts";
import { authorizeProvisioning } from "../src/sites/provision.ts";

// Provisioning's authority on a disposable database built from the concept migrations: real Access sessions,
// Organizations' setup founder and Seats, read on one worker transaction (sites.provision-principal).
const adminUrl = process.env.PG_ADMIN_URL;
if (!adminUrl || process.env.CAPXUL_DISPOSABLE !== "true" || !["127.0.0.1", "localhost"].includes(new URL(adminUrl).hostname))
  throw new Error("PG_ADMIN_URL must name a disposable loopback cluster and CAPXUL_DISPOSABLE=true");

test("provisioning admits the founder of a deployed, unfinished setup, or a Seat holder, and refuses everyone else", async (t) => {
  const name = `sites_provision_${randomBytes(4).toString("hex")}`;
  const at = (user?: string, password?: string) => {
    const u = new URL(adminUrl); u.pathname = `/${name}`; if (user) { u.username = user; u.password = password!; } return u.href;
  };
  const root = new pg.Client({ connectionString: adminUrl }); await root.connect();
  await root.query(`create database ${name}`);
  const admin = new pg.Client({ connectionString: at() }); await admin.connect();
  let db: Database | undefined;
  t.after(async () => { await db?.close(); await admin.end(); await root.query(`drop database if exists ${name} with (force)`); await root.end(); });
  await admin.query("create schema if not exists app; grant usage on schema app to capxul_core,capxul_worker");
  await migrateOutbox(admin); await migrateAccess(admin); await migrateAccounts(admin);
  await admin.query(readFileSync(new URL("../src/parties/schema.sql", import.meta.url), "utf8"));
  await migrateOrganizations(admin);
  db = new Database(at("capxul_core", "corepw"), at("capxul_worker", "workerpw"));

  const now = 1_791_555_000_000, safe = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
  const tokens: Record<string, string> = {};
  for (const [i, person] of ["founder", "member", "outsider"].entries()) {
    tokens[person] = randomBytes(32).toString("base64url");
    await admin.query("insert into app.principals values($1,'person',$2,$3,null,$4)", [person, `${person}@acme.test`, safe(0x10 + i), new Date(now)]);
    await admin.query(`insert into app.sessions(person_id,session_id,token_hash,method,status,client,created_at,expires_at)
      values($1,$1,$2,'code','active','fixture',$3,$4)`, [person, digest(tokens[person]!), new Date(now), new Date(now + 3_600_000)]);
    await admin.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at)
      values($1,'person','active',$2,'person',$1,$3,$3)`, [person, safe(0x10 + i), now]);
  }
  await admin.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at)
    values('org-acme','organization','active',$1,'organization','acme',$2,$2)`, [safe(0xac), now]);
  await admin.query(`insert into app.organizations(org_id,party_id,name,country,chain_id,safe_address,founder_party_id,founder_safe,seat_limit,
    abbr,default_currency,time_zone,fiscal_year_start,created_at,updated_at)
    values('acme','org-acme','Acme','GH',84532,$1,'founder',$2,5,'ACME','GHS','Africa/Accra','01-01',$3,$3)`, [safe(0xac), safe(0x10), now]);
  await admin.query(`insert into app.org_members(org_id,member_id,party_id,principal_id,kind,safe_address,seat_use,status,joined_at,updated_at)
    values('acme','member','member','member','human',$1,'seat','active',$2,$2)`, [safe(0x11), now]);
  await admin.query(`insert into app.org_setups(org_id,founder_principal_id,intent_hash,with_fde,status,steps,checked_at,created_at,updated_at)
    values('acme','founder',$1,false,'processing','{safe_minted}',$2,$2,$2)`, ["0".repeat(64), now]);
  const setup = (status: string, steps: string[]) =>
    admin.query("update app.org_setups set status=$1, steps=$2, ready_at=$3 where org_id='acme'", [status, steps, status === "ready" ? now : null]);

  const authorize = authorizeProvisioning(db, async () => now);
  const as = async (person: string | undefined, orgId = "acme") => {
    const result = await Effect.runPromise(Effect.result(authorize({ orgId, bearer: person ? tokens[person]! : "not-a-session" })));
    return result._tag === "Success" ? `admitted ${result.success.personId}` : result.failure.code;
  };

  assert.equal(await as("founder"), "ROLE_PERMISSION_DENIED", "a founder holds no authority before the money is deployed");
  await setup("processing", ["safe_minted", "money_deployed"]);
  assert.equal(await as("founder"), "admitted founder", "the founder of a deployed, unfinished setup needs no Seat");
  await setup("needs_attention", ["safe_minted", "money_deployed"]);
  assert.equal(await as("founder"), "admitted founder");
  assert.equal(await as("member"), "admitted member", "a Seat holder is admitted whatever the setup's state");
  assert.equal(await as("outsider"), "ROLE_PERMISSION_DENIED");
  assert.equal(await as("founder", "other"), "ROLE_PERMISSION_DENIED", "founding one company admits nothing in another");
  assert.equal(await as(undefined), "NOT_AUTHENTICATED");
  await setup("failed", ["safe_minted", "money_deployed"]);
  assert.equal(await as("founder"), "ROLE_PERMISSION_DENIED", "a failed setup admits no founder");
  // Once the setup completes the founder's own Seat carries the authority, so a removed founder is refused.
  await setup("ready", ["safe_minted", "money_deployed", "installed"]);
  assert.equal(await as("founder"), "ROLE_PERMISSION_DENIED");
  await admin.query(`insert into app.org_members(org_id,member_id,party_id,principal_id,kind,safe_address,seat_use,status,joined_at,updated_at)
    values('acme','founder','founder','founder','human',$1,'owner-seat','active',$2,$2)`, [safe(0x10), now]);
  assert.equal(await as("founder"), "admitted founder");
  assert.equal(await as("member"), "admitted member");
});
