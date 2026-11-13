import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { migrateAgents } from "./door.ts";

test("native agents rows admit the authenticated owner or the agent's own principal, never owner labels alone", {
  skip: !process.env.CAPXUL_STORAGE_PROOF_DATABASE,
}, async () => {
  const url = new URL(process.env.CAPXUL_STORAGE_PROOF_DATABASE!);
  assert(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.pathname, "/agents_proof", "only the explicitly disposable component database is accepted");
  const sql = new pg.Client({ connectionString: url.href }); await sql.connect();
  const agentSafe = `0x${"a".repeat(40)}`;
  try {
    await sql.query("begin");
    // Closed dependency fixtures, rolled back with the test: Access's principals and Seat's current_member.
    // They prove no bearer or Seat authority; the combined Access/Seat proof is separate.
    if (!(await sql.query("select to_regclass('app.principals') as t")).rows[0].t) {
      await sql.query(`create table app.principals(person_id text primary key, kind text not null, email text,
        safe_address text not null, signer_address text, created_at timestamptz not null)`);
      await sql.query("grant select on app.principals to capxul_core");
    }
    if (!(await sql.query("select to_regprocedure('app.current_member(text)') as f")).rows[0].f) {
      await sql.query("create function app.current_member(text) returns boolean language sql as $$ select false $$");
    }
    await migrateAgents(sql);
    // Valid under Access's real principals schema too: an agent principal has a signer and no email.
    await sql.query(`insert into app.principals(person_id,kind,email,safe_address,signer_address,created_at)
      values('native-agent','agent',null,$1,$2,now())`, [agentSafe, `0x${"b".repeat(40)}`]);
    await sql.query(`insert into app.agents values('native-owner','person','agent_native','party_native',$1,$2,'file','creating',
      'native-owner',now(),null,null,now())`, [agentSafe, `0x${"b".repeat(40)}`]);
    const visible = async (settings: Record<string, string>) => {
      await sql.query("savepoint read; set local role capxul_core");
      for (const [key, value] of Object.entries(settings)) await sql.query("select set_config($1,$2,true)", [key, value]);
      const rows = (await sql.query("select agent_id from app.agents")).rows.map((r) => r.agent_id);
      await sql.query("rollback to savepoint read");
      return rows;
    };
    assert.deepEqual(await visible({ "app.owner_kind": "person", "app.owner_id": "native-owner" }), []);
    assert.deepEqual(await visible({ "app.person_id": "native-owner" }), ["agent_native"]);
    assert.deepEqual(await visible({ "app.person_id": "native-agent" }), ["agent_native"]);
    assert.deepEqual(await visible({ "app.person_id": "someone-else", "app.owner_kind": "person", "app.owner_id": "native-owner" }), []);
  } finally { await sql.query("rollback"); await sql.end(); }
});
