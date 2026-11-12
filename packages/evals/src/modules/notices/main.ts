import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseRunReceipt } from "@capxul/blueprint-engine";
import { Database, worldNow } from "../../../../backend/src/devnet/door.ts";
import { fixtureFrom } from "../acceptance/fixture.ts";

const checks = ["NOTICES.selected-stack", "NOTICES.schema", "NOTICES.mailbox-reads", "NOTICES.writer-acl"];
if (process.argv.includes("--list")) {
  for (const name of checks) console.log(`${name}\tcheck`);
} else {
  const only = process.argv.indexOf("--only");
  const prefixes = only < 0 ? ["NOTICES"] : (process.argv[only+1] ?? "").split(",").filter(Boolean);
  const requested = checks.filter((name) => prefixes.some((prefix) => name.startsWith(prefix)));
  const seen = new Set<string>(); let failed = false;
  const emit = async (name: string, check: () => Promise<void>) => {
    if (!requested.includes(name) && name !== checks[0]) return true;
    const start = performance.now(); let passed = true;
    try { await check(); } catch { passed = false; failed = true; }
    console.log(`@check\t${name}\t${passed ? "pass" : "fail"}\t${Math.ceil(performance.now()-start)}\t${passed ? "live selected-world assertion retained" : "live assertion failed; no component evidence substituted"}`);
    seen.add(name); return passed;
  };
  let db: Database | undefined;
  try {
    assert(requested.length > 0, "no notices checks selected");
    const run = process.env.CAPXUL_EVAL_RUN_DIR, path = process.env.CAPXUL_WORLD_CONFIG;
    const fixturePath = process.env.CAPXUL_ACCEPTANCE_FIXTURE, slug = process.argv[2];
    assert(run && path && fixturePath && slug);
    const fixture = fixtureFrom(fixturePath, slug), config = JSON.parse(readFileSync(path, "utf8"));
    const parsed = parseRunReceipt(JSON.parse(readFileSync(join(run,"receipt.json"),"utf8"))); assert(parsed.ok);
    const receipt = parsed.value, dir = resolve(run,"notices"); mkdirSync(dir,{ recursive: true });
    const selected = await emit("NOTICES.selected-stack", async () => {
      assert.equal(receipt.state,"running"); assert.equal(receipt.environment.world,"slice-zero");
      assert.equal(fixture.world,"slice-zero"); assert.notEqual(config.world.id,"main");
      assert.equal(config.world.kind,"local");
      assert.equal(fixture.coreUrl,`http://127.0.0.1:${config.ports.core}`);
      assert.equal(fixture.rpcUrl,`http://127.0.0.1:${config.ports.publicRpc}`);
      assert.equal(fixture.frappeUrl,`http://127.0.0.1:${config.ports.publicBench}`);
      assert.equal(receipt.environment.storage,"postgres"); assert.equal(receipt.environment.indexer,"ponder");
      assert.equal(receipt.environment.stack,"postgres-ponder-erpnext-v4");
      assert.equal(receipt.commit,config.codeVersion);
      assert.equal(receipt.commit,execFileSync("git",["rev-parse","HEAD"],{ encoding: "utf8" }).trim());
      const inspection = JSON.parse(execFileSync("pnpm",["--silent","capxul","world","inspect","--config",path,"--json"],{
        encoding: "utf8", timeout: 60_000, stdio: ["ignore","pipe","pipe"],
      }));
      assert.equal(inspection.codeVersion,receipt.commit); assert.equal(inspection.world.id,config.world.id);
      assert.equal(inspection.world.epoch,config.world.epoch); assert.equal(inspection.core.world,config.world.id);
      assert.equal(inspection.stack,"postgres-ponder-erpnext-v4");
      const url = (key: "tenant" | "worker", role: string) => {
        const u = new URL(config.database[key]); assert.equal(decodeURIComponent(u.username),role);
        assert(["localhost","127.0.0.1","[::1]"].includes(u.hostname)); u.pathname = `/${config.world.database}`; return u.href;
      };
      db = new Database(url("tenant","capxul_core"),url("worker","capxul_worker"));
      const world = (await db.worker.query("select world_id,epoch from app.world")).rows[0];
      assert.equal(world.world_id,config.world.id); assert.equal(Number(world.epoch),config.world.epoch);
      const worldInstant = await worldNow(db.worker);
      for (const [pool,name] of [[db.tenant,"capxul_core"],[db.worker,"capxul_worker"]] as const) {
        const role = (await pool.query("select current_user as name,rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0];
        assert.deepEqual(role,{ name, rolsuper: false, rolbypassrls: false });
      }
      writeFileSync(join(dir,"selected.json"),JSON.stringify({ run: receipt.id, commit: receipt.commit, world: inspection.world, worldInstant, observedAt: inspection.observedAt })+"\n");
    });
    assert(selected && db); const database = db;
    await emit("NOTICES.schema", async () => {
      const columns = (await database.worker.query(`select column_name,data_type,is_nullable from information_schema.columns
        where table_schema='app' and table_name='notices' order by ordinal_position`)).rows;
      assert.deepEqual(columns,[
        ["recipient","text","NO"],["notice_id","text","NO"],["template","text","NO"],["subject_kind","text","NO"],
        ["subject_id","text","NO"],["cause","text","NO"],["person_id","text","YES"],["org_id","text","YES"],
        ["facts","jsonb","NO"],["status","text","NO"],["attempts","integer","NO"],["last_error","jsonb","YES"],
        ["mail_id","text","YES"],["next_attempt_at","double precision","YES"],["created_at","double precision","NO"],["updated_at","double precision","NO"],
      ].map(([column_name,data_type,is_nullable]) => ({ column_name,data_type,is_nullable })));
      const indexes = (await database.worker.query(`select indexrelid::regclass::text as name,indisprimary as primary,indisunique as unique,
        array(select a.attname::text from unnest(i.indkey) with ordinality k(attnum,n)
          join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum order by k.n) as fields
        from pg_index i where indrelid='app.notices'::regclass order by indexrelid::regclass::text`)).rows;
      assert.deepEqual(indexes,[
        { name: "app.by_changed", primary: false, unique: false, fields: ["updated_at"] },
        { name: "app.by_recipient_changed", primary: false, unique: false, fields: ["recipient","updated_at"] },
        { name: "app.by_template_changed", primary: false, unique: false, fields: ["template","updated_at"] },
        { name: "app.notices_pkey", primary: true, unique: true, fields: ["recipient","notice_id"] },
      ]);
      writeFileSync(join(dir,"schema.json"),JSON.stringify({ columns,indexes })+"\n");
    });
    await emit("NOTICES.mailbox-reads", async () => {
      const rls = (await database.worker.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='app.notices'::regclass")).rows[0];
      assert.deepEqual(rls,{ relrowsecurity: true, relforcerowsecurity: true });
      const observer = await database.worker.connect();
      try {
        await observer.query("begin isolation level repeatable read read only");
        const snapshot = (await observer.query("select pg_export_snapshot() as snapshot")).rows[0].snapshot as string;
        assert(/^[0-9A-F-]+$/.test(snapshot));
        const all = (await observer.query("select * from app.notices_by_changed()")).rows;
        const mailboxes = [...new Set(all.map((r) => r.recipient as string))]; assert(mailboxes.length >= 2);
        const counts = [];
        for (const mailbox of mailboxes) {
          const expected = (await observer.query("select * from app.notices_by_changed($1)",[mailbox])).rows;
          assert(expected.length > 0 && expected.every((r) => r.recipient === mailbox));
          const client = await database.tenant.connect();
          try {
            await client.query("begin isolation level repeatable read read only"); await client.query(`set transaction snapshot '${snapshot}'`);
            assert.equal((await client.query("select * from app.notices")).rowCount,0);
            await client.query("select set_config('app.email',$1,true)",[mailbox]);
            const actual = (await client.query("select * from app.notices order by updated_at desc,recipient,notice_id limit 200")).rows;
            assert.deepEqual(actual,expected); await client.query("commit");
            assert.equal((await client.query("select * from app.notices")).rowCount,0);
            counts.push({ mailbox: counts.length+1, visible: actual.length });
          } finally { await client.query("rollback"); client.release(); }
        }
        writeFileSync(join(dir,"mailbox-reads.json"),JSON.stringify(counts)+"\n");
      } finally { await observer.query("rollback"); observer.release(); }
    });
    await emit("NOTICES.writer-acl", async () => {
      const privileges = (await database.worker.query(`select r as role,has_table_privilege(r,'app.notices','SELECT') as read,
        has_table_privilege(r,'app.notices','INSERT') as insert,has_table_privilege(r,'app.notices','UPDATE') as update,
        has_table_privilege(r,'app.notices','DELETE') as delete,has_table_privilege(r,'app.notices','TRUNCATE') as truncate,
        has_function_privilege(r,'app.notice_outcome(text,text,integer,jsonb,double precision)','EXECUTE') as outcome,
        has_function_privilege(r,'app.notices_by_changed(text,integer)','EXECUTE') as inspect
        from unnest(array['capxul_core','capxul_worker','capxul_ponder']) r order by r`)).rows;
      assert.deepEqual(privileges,[
        { role: "capxul_core", read: true, insert: false, update: false, delete: false, truncate: false, outcome: false, inspect: false },
        { role: "capxul_ponder", read: false, insert: false, update: false, delete: false, truncate: false, outcome: false, inspect: false },
        { role: "capxul_worker", read: true, insert: false, update: false, delete: false, truncate: false, outcome: true, inspect: true },
      ]);
      // These statements cannot change rows even if a grant regresses; check actual permission refusal, not just ACL prose.
      for (const pool of [database.tenant,database.worker]) {
        for (const statement of ["update app.notices set status=status where false", "delete from app.notices where false",
          "insert into app.notices select * from app.notices where false"])
          await assert.rejects(pool.query(statement),{ code: "42501" });
      }
      await assert.rejects(database.tenant.query("select * from app.notices_by_changed()"),{ code: "42501" });
      await assert.rejects(database.tenant.query("select app.notice_outcome(null,null,0,'{}'::jsonb,0)"),{ code: "42501" });
      writeFileSync(join(dir,"writer-acl.json"),JSON.stringify(privileges)+"\n");
    });
  } catch { failed = true; }
  finally { await db?.close(); }
  for (const name of requested.filter((name) => !seen.has(name))) await emit(name,async () => { throw new Error("prerequisite failed"); });
  process.exitCode = failed ? 1 : 0;
}
