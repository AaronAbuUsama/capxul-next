import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { Database, type Sql } from "../src/platform/db.ts";
import { callerSafes, requireSeat, type Actor } from "../src/organizations/door.ts";

if (process.env.CAPXUL_DISPOSABLE !== "true" || !process.env.CAPXUL_WORLD || process.env.CAPXUL_WORLD === "main")
  throw new Error("named disposable migrated Postgres required");
// Until Access is composed into the wave, validate its exact published source in an isolated worktree.
const access = await import(new URL(process.env.CAPXUL_ACCESS_MODULE ?? "../src/access/door.ts", import.meta.url).href);
const db = new Database(process.env.DATABASE_URL!, process.env.WORKER_DATABASE_URL!);
const now = 946684800123, suffix = randomBytes(6).toString("hex");
const addr = () => `0x${randomBytes(20).toString("hex")}`;
const orgs = [0, 1, 2].map(n => ({ id: `seat-${suffix}-${n}`, safe: addr(), party: `org-party-${suffix}-${n}` }));
const people = ["human", "other", "agent", "no-party", "released"].map(name => ({
  id: `${name}-${suffix}`, safe: addr(), party: `${name}-party-${suffix}`, token: randomBytes(32).toString("base64url"),
  kind: name === "agent" ? "agent" : "person",
}));
const human = people[0]!, other = people[1]!, agent = people[2]!, noParty = people[3]!, released = people[4]!;
const actor = (p: typeof human): Actor => ({ principalId: p.id, kind: p.kind === "agent" ? "agent" : "human", safe: p.safe });
const as = <T>(p: typeof human, run: (sql: Sql) => Promise<T>, worker = false) => db.transaction("", async sql => {
  const principal = await access.authenticate(sql, p.token, now);
  assert.equal(principal.personId, p.id);
  return run(sql);
}, worker);

test.before(async () => {
  for (const pool of [db.tenant, db.worker]) {
    const role = (await pool.query("select rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0];
    assert.deepEqual(role, { rolsuper: false, rolbypassrls: false });
  }
  // Source fixtures only, not public onboarding proof: seed immutable principals and opaque sessions with the worker.
  await db.transaction("", async sql => {
    for (const o of orgs) {
      await sql.query(`insert into app.organizations(org_id,name,safe,site,admin_email,token)
        values($1,$1,$2,$1,'fixture@example.test',$2)`, [o.id, o.safe]);
      await sql.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at)
        values($1,'organization','active',$2,'organization',$3,$4,$4)`, [o.party, o.safe, o.id, now]);
    }
    for (const p of people) {
      await sql.query(`insert into app.principals(person_id,kind,email,safe_address,signer_address,created_at)
        values($1,$2,$3,$4,$5,$6)`, [p.id, p.kind, p.kind === "person" ? `${p.id}@example.test` : null,
        p.safe, p.kind === "agent" ? addr() : null, new Date(now)]);
      await sql.query(`insert into app.sessions(person_id,session_id,token_hash,method,status,client,created_at,expires_at)
        values($1,$1,$2,'code','active','organizations-native',$3,$4)`,
      [p.id, access.digest(p.token), new Date(now), new Date(now + 3600_000)]);
      if (p !== noParty) await sql.query(`insert into app.parties(party_id,kind,state,safe_address,owner_kind,owner_id,created_at,updated_at)
        values($1,$2,$3,$4,'person',$5,$6,$6)`, [p.party, p.kind, p === released ? "released" : "active", p.safe, p.id, now]);
    }
    for (const [p, indices] of [[human, [0, 1]], [other, [2]], [agent, [1]], [released, [0]]] as const) {
      for (const i of indices) await sql.query(`insert into app.org_members
        (org_id,member_id,party_id,principal_id,kind,safe_address,seat_use,status,joined_at,updated_at)
        values($1,$2,$3,$4,$5,$6,$7,'active',$8,$8)`,
      [orgs[i]!.id, `${p.id}-${i}`, p.party, p === agent ? null : p.id, p.kind === "agent" ? "agent" : "human", p.safe,
        p === agent ? "organization" : "seat", now]);
    }
  }, true);
});
test.after(() => db.close());

test("authenticated human admits only active Seats and their organization Safes on both restricted roles", async () => {
  for (const worker of [false, true]) await as(human, async sql => {
    const seat = await requireSeat(sql, orgs[0]!.id, actor(human));
    assert.equal(seat.principal_id, human.id);
    assert.equal(seat.party_id, human.party);
    assert.equal(Number(seat.joined_at), now);
    assert.deepEqual(await callerSafes(sql), [human.safe, orgs[0]!.safe, orgs[1]!.safe].sort());
    const rows = (await sql.query("select org_id from app.org_members where org_id=any($1::text[])", [orgs.map(o => o.id)])).rows;
    if (!worker) assert.deepEqual([...new Set(rows.map(r => r.org_id))].sort(), [orgs[0]!.id, orgs[1]!.id].sort());
    await assert.rejects(requireSeat(sql, orgs[2]!.id, actor(human)), /ROLE_PERMISSION_DENIED/);
    await assert.rejects(requireSeat(sql, "nonexistent", actor(human)), /ROLE_PERMISSION_DENIED/);
    await assert.rejects(requireSeat(sql, orgs[2]!.id, actor(other)), /ROLE_PERMISSION_DENIED/);
    await assert.rejects(requireSeat(sql, orgs[0]!.id, { ...actor(human), safe: other.safe }), /ROLE_PERMISSION_DENIED/);
    await assert.rejects(requireSeat(sql, orgs[0]!.id, { ...actor(human), kind: "agent" }), /ROLE_PERMISSION_DENIED/);
  }, worker);
});

test("organization owner labels cannot authenticate; an authenticated outsider cannot borrow another actor", async () => {
  for (const worker of [false, true]) await db.ownerTransaction({ kind: "organization", id: orgs[0]!.id }, async sql => {
    assert.deepEqual(await callerSafes(sql), []);
    if (!worker) assert.equal((await sql.query("select * from app.org_members where org_id=$1", [orgs[0]!.id])).rowCount, 0);
    await assert.rejects(requireSeat(sql, orgs[0]!.id, actor(human)), /ROLE_PERMISSION_DENIED/);
  }, worker);
  await as(other, async sql => {
    await sql.query("select set_config('app.org_id',$1,true),set_config('app.owner_kind','organization',true),set_config('app.owner_id',$1,true),set_config('app.safe_address',$2,true)", [orgs[0]!.id, human.safe]);
    await assert.rejects(requireSeat(sql, orgs[0]!.id, actor(human)), /ROLE_PERMISSION_DENIED/);
    assert.deepEqual(await callerSafes(sql), [other.safe, orgs[2]!.safe].sort());
  });
});

test("agent Seat uses its own authenticated Safe despite null principal; no Party admits no Safes", async () => {
  await as(agent, async sql => {
    const seat = await requireSeat(sql, orgs[1]!.id, actor(agent));
    assert.equal(seat.principal_id, null);
    assert.equal(seat.safe_address, agent.safe);
    assert.deepEqual(await callerSafes(sql), [agent.safe, orgs[1]!.safe].sort());
    await assert.rejects(requireSeat(sql, orgs[1]!.id, { ...actor(agent), safe: human.safe }), /ROLE_PERMISSION_DENIED/);
  });
  for (const p of [noParty, released]) await as(p, async sql => assert.deepEqual(await callerSafes(sql), []));
});

test("Seat removal is immediately effective and a rolled-back removal preserves admission", async () => {
  await assert.rejects(db.transaction("", async sql => {
    await sql.query("update app.org_members set status='removed',removed_reason='agent_removed',removed_at=$3,updated_at=$3 where org_id=$1 and party_id=$2", [orgs[1]!.id, agent.party, now + 47000]);
    throw new Error("abort-removal");
  }, true), /abort-removal/);
  await as(agent, sql => requireSeat(sql, orgs[1]!.id, actor(agent)));
  await db.transaction("", sql => sql.query("update app.org_members set status='removed',removed_reason='agent_removed',removed_at=$3,updated_at=$3 where org_id=$1 and party_id=$2", [orgs[1]!.id, agent.party, now + 47000]), true);
  await as(agent, async sql => {
    await assert.rejects(requireSeat(sql, orgs[1]!.id, actor(agent)), /ROLE_PERMISSION_DENIED/);
    assert.deepEqual(await callerSafes(sql), [agent.safe]);
    assert.equal((await sql.query("select * from app.org_members where org_id=$1", [orgs[1]!.id])).rowCount, 0);
  });
});

test("tenant cannot write Seats, even after authentication and organization scope", async () => {
  for (const query of ["update app.org_members set status='removed' where org_id=$1", "delete from app.org_members where org_id=$1",
    "insert into app.org_members select * from app.org_members where org_id=$1"]) {
    await assert.rejects(as(human, async sql => {
      await sql.query("select set_config('app.org_id',$1,true)", [orgs[0]!.id]);
      await sql.query(query, [orgs[0]!.id]);
    }), /permission denied/);
  }
  await as(human, sql => requireSeat(sql, orgs[0]!.id, actor(human)));
});
