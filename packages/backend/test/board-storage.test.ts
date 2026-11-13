import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";
import { migrate, readOfficerChange, readProposal } from "../src/board/door.ts";

// Explicit disposable native Postgres control, not a selected-stack verdict or a substitute for Ponder.
test("board migration preserves exact schema, seat identity and tenant/writer isolation", {
  skip: !process.env.BOARD_TEST_DATABASE_URL,
}, async () => {
  assert.equal(process.env.CAPXUL_DISPOSABLE, "true");
  const db = new pg.Client({ connectionString: process.env.BOARD_TEST_DATABASE_URL });
  await db.connect();
  try {
    await db.query("begin");
    for (const role of ["capxul_core", "capxul_worker"]) {
      if (!(await db.query("select 1 from pg_roles where rolname=$1", [role])).rowCount) await db.query(`create role ${role} nosuperuser nobypassrls`);
    }
    await db.query(readFileSync(new URL("../src/schema.sql", import.meta.url), "utf8"));
    await db.query("grant usage on schema app to capxul_core,capxul_worker");
    await migrate(db);
    await migrate(db); // Provisioning retry must preserve the same constraints and policies.
    const schemas = {
      board_proposals: "org_id proposal_id chain_id safe_address nonce safe_tx_hash kind rejects to value data operation calls note opener subject_kind subject_id payment proposer_principal_id proposer_safe status approved_by threshold settled_by_safe_tx_hash execution_user_op_hash execution_tx_hash settled_block created_at settled_at updated_at",
      officer_changes: "org_id change_id member_id party_id principal_id member_safe email name change permission hat_id proposal_id note state waiting created_at settled_at updated_at",
      proposal_approvals: "org_id proposal_id approval_id director_principal_id director_safe step created_at",
    };
    const nullable: Record<string, string[]> = {
      board_proposals: "rejects note payment threshold settled_by_safe_tx_hash execution_user_op_hash execution_tx_hash settled_block settled_at".split(" "),
      officer_changes: "principal_id email name waiting settled_at".split(" "), proposal_approvals: [],
    };
    for (const [table, fields] of Object.entries(schemas)) {
      const columns = (await db.query(`select column_name,data_type,is_nullable from information_schema.columns
        where table_schema='app' and table_name=$1 order by ordinal_position`, [table])).rows;
      assert.deepEqual(columns.map((c) => c.column_name), fields.split(" "));
      for (const c of columns) {
        assert.equal(c.is_nullable, nullable[table]!.includes(c.column_name) ? "YES" : "NO", `${table}.${c.column_name} nullability`);
        const expectedType = ["created_at", "updated_at", "settled_at"].includes(c.column_name) ? "double precision"
          : c.column_name === "chain_id" ? "integer" : ["nonce", "threshold", "settled_block"].includes(c.column_name) ? "bigint"
          : ["calls", "payment"].includes(c.column_name) ? "jsonb" : c.column_name === "approved_by" ? "ARRAY"
          : c.column_name === "waiting" ? "boolean" : "text";
        assert.equal(c.data_type, expectedType, `${table}.${c.column_name} type`);
      }
    }
    const indexes = (await db.query(`select indexname,indexdef from pg_indexes where schemaname='app'
      and tablename=any($1::text[]) order by indexname`, [Object.keys(schemas)])).rows;
    assert.equal(indexes.length, 13);
    for (const [name, columns, unique] of [
      ["board_proposals_by_id", "proposal_id", true], ["board_proposals_by_org_nonce", "org_id, nonce, created_at", false],
      ["board_proposals_by_org_status_nonce", "org_id, status, nonce", false],
      ["board_proposals_by_org_subject", "org_id, opener, subject_kind, subject_id", true],
      ["board_proposals_by_org_safe_tx", "org_id, safe_tx_hash", true], ["board_proposals_by_org_rejects", "org_id, rejects", false],
      ["officer_changes_by_org_member_permission", "org_id, member_id, permission, waiting", true],
      ["officer_changes_by_org_proposal", "org_id, proposal_id", true], ["officer_changes_by_org_hat_waiting", "org_id, hat_id, waiting", false],
      ["proposal_approvals_by_org_proposal_director", "org_id, proposal_id, director_principal_id, created_at", false],
    ] as const) {
      const index = indexes.find((i) => i.indexname === name)!;
      assert(index, name); assert(index.indexdef.endsWith(`(${columns})`), index.indexdef);
      assert.equal(index.indexdef.includes("UNIQUE"), unique);
    }
    for (const [org, count] of [["board-a", 2], ["board-b", 1]] as const) {
      await db.query(`insert into app.organizations (org_id,name,safe,site,admin_email,token) values ($1,$1,$1,$1,$1,$1)`, [org]);
      for (let n = 0; n < count; n++) {
        await db.query(`insert into app.board_proposals
          (org_id,proposal_id,chain_id,safe_address,nonce,safe_tx_hash,kind,"to",value,data,operation,calls,opener,
           subject_kind,subject_id,proposer_principal_id,proposer_safe,status,approved_by,created_at,updated_at)
          values ($1,$2,84532,$1,$3,$2,'transaction',$1,'0','0x','call','[]','board','officer-change',$2,'director','safe','awaiting_approvals','{}',7,7)`, [org, `${org}-${n}`, n]);
        await db.query(`insert into app.officer_changes
          (org_id,change_id,member_id,party_id,principal_id,member_safe,change,permission,hat_id,proposal_id,note,state,waiting,created_at,updated_at)
          values ($1,$2,$2,'agent-party',null,'agent-safe','grant','manage-people','0x01',$2,'private note','proposed',true,7,7)`, [org, `${org}-${n}`]);
        await db.query(`insert into app.proposal_approvals values ($1,$2,$2,'director','safe','approve',7)`, [org, `${org}-${n}`]);
      }
    }
    for (const role of ["capxul_core", "capxul_worker"]) {
      await db.query(`set local role ${role}`);
      for (const [org, expected] of [["board-a", 2], ["board-b", 1], ["", 0]] as const) {
        await db.query("select set_config('app.org_id',$1,true)", [org]);
        for (const table of Object.keys(schemas)) assert.equal((await db.query(`select * from app.${table}`)).rowCount, expected, `${role}/${org}/${table}`);
        assert.equal(await readProposal(db, "board-b", "board-a-0"), null);
        assert.equal(await readOfficerChange(db, "board-a", "board-b-0"), null);
      }
      await db.query("select set_config('app.org_id','board-a',true)");
      assert.equal((await readOfficerChange(db, "board-a", "board-a-0"))!.principal_id, null);
      assert.equal((await readProposal(db, "board-a", "board-a-1"))!.nonce, 1);
      for (const table of Object.keys(schemas)) {
        await db.query("savepoint denied");
        if (role === "capxul_core") await assert.rejects(db.query(`update app.${table} set org_id=org_id`), /permission denied/);
        else {
          assert.equal((await db.query(`update app.${table} set org_id=org_id where org_id='board-b'`)).rowCount, 0);
          await assert.rejects(db.query(`update app.${table} set org_id='board-b' where org_id='board-a'`), /row-level security/);
        }
        await db.query("rollback to denied");
      }
      await db.query("reset role");
    }
    await db.query("rollback");
  } finally { await db.end(); }
});
