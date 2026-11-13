import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseRunReceipt } from "@capxul/blueprint-engine";
import { Database } from "../../../../backend/src/devnet/door.ts";
import { fixtureFrom } from "../acceptance/fixture.ts";

// Storage observations only. No component fixture or unmounted mutation may satisfy a lifecycle claim.
const tables = {
  board_proposals: "org_id proposal_id chain_id safe_address nonce safe_tx_hash kind rejects to value data operation calls note opener subject_kind subject_id payment proposer_principal_id proposer_safe status approved_by threshold settled_by_safe_tx_hash execution_user_op_hash execution_tx_hash settled_block created_at settled_at updated_at",
  officer_changes: "org_id change_id member_id party_id principal_id member_safe email name change permission hat_id proposal_id note state waiting created_at settled_at updated_at",
  proposal_approvals: "org_id proposal_id approval_id director_principal_id director_safe step created_at",
};
const checks = ["BOARD.selected-stack", "BOARD.schema", "BOARD.writer-acl"];
if (process.argv.includes("--list")) {
  for (const name of checks) console.log(`${name}\tcheck`);
} else {
  const seen = new Set<string>(); let failed = false;
  const emit = async (name: string, check: () => Promise<void>) => {
    const start = performance.now(); let passed = true;
    try { await check(); } catch { passed = false; failed = true; }
    console.log(`@check\t${name}\t${passed ? "pass" : "fail"}\t${Math.ceil(performance.now() - start)}\t${passed ? "selected-world storage observation only; no lifecycle credit" : "selected-world assertion failed; no fixture substituted"}`);
    seen.add(name); return passed;
  };
  let db: Database | undefined;
  try {
    const run = process.env.CAPXUL_EVAL_RUN_DIR, configPath = process.env.CAPXUL_WORLD_CONFIG;
    const fixturePath = process.env.CAPXUL_ACCEPTANCE_FIXTURE, slug = process.argv[2];
    assert(run && configPath && fixturePath && slug);
    const fixture = fixtureFrom(fixturePath, slug), c = JSON.parse(readFileSync(configPath, "utf8"));
    const parsed = parseRunReceipt(JSON.parse(readFileSync(join(run, "receipt.json"), "utf8"))); assert(parsed.ok);
    const receipt = parsed.value, dir = resolve(run, "board"); mkdirSync(dir, { recursive: true });
    const selected = await emit("BOARD.selected-stack", async () => {
      assert.equal(receipt.state, "running"); assert.equal(receipt.environment.world, "slice-zero"); assert.equal(fixture.world, "slice-zero");
      assert.equal(receipt.environment.storage, "postgres"); assert.equal(receipt.environment.indexer, "ponder");
      assert.equal(receipt.environment.stack, "postgres-ponder-erpnext-v4"); assert.notEqual(c.world.id, "main");
      assert.equal(receipt.commit, c.codeVersion);
      assert.equal(receipt.commit, execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
      const inspection = JSON.parse(execFileSync("pnpm", ["--silent", "capxul", "world", "inspect", "--config", configPath, "--json"], {
        encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"],
      }));
      assert.equal(inspection.codeVersion, receipt.commit); assert.equal(inspection.world.id, c.world.id);
      assert.equal(inspection.world.epoch, c.world.epoch); assert.equal(inspection.core.world, c.world.id);
      assert.equal(inspection.stack, "postgres-ponder-erpnext-v4");
      const url = (key: "tenant" | "worker", role: string) => {
        const value = new URL(c.database[key]); assert.equal(decodeURIComponent(value.username), role);
        assert(["localhost", "127.0.0.1", "[::1]"].includes(value.hostname)); value.pathname = `/${c.world.database}`; return value.href;
      };
      db = new Database(url("tenant", "capxul_core"), url("worker", "capxul_worker"));
      const identity = (await db.worker.query("select world_id,epoch from app.world")).rows[0];
      assert.equal(identity.world_id, c.world.id); assert.equal(Number(identity.epoch), c.world.epoch);
      for (const [pool, name] of [[db.tenant, "capxul_core"], [db.worker, "capxul_worker"]] as const) {
        assert.deepEqual((await pool.query("select current_user as name,rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0],
          { name, rolsuper: false, rolbypassrls: false });
      }
      writeFileSync(join(dir, "selected.json"), JSON.stringify({ run: receipt.id, commit: receipt.commit, world: inspection.world }) + "\n");
    });
    assert(selected && db); const database = db;
    await emit("BOARD.schema", async () => {
      const evidence = [];
      for (const [table, names] of Object.entries(tables)) {
        const columns = (await database.worker.query(`select column_name,data_type,is_nullable from information_schema.columns
          where table_schema='app' and table_name=$1 order by ordinal_position`, [table])).rows;
        assert.deepEqual(columns.map((c) => c.column_name), names.split(" "));
        const nullable = (table === "board_proposals" ? "rejects note payment threshold settled_by_safe_tx_hash execution_user_op_hash execution_tx_hash settled_block settled_at"
          : table === "officer_changes" ? "principal_id email name waiting settled_at" : "").split(" ");
        for (const c of columns) {
          assert.equal(c.is_nullable, nullable.includes(c.column_name) ? "YES" : "NO");
          const type = ["created_at", "updated_at", "settled_at"].includes(c.column_name) ? "double precision"
            : c.column_name === "chain_id" ? "integer" : ["nonce", "threshold", "settled_block"].includes(c.column_name) ? "bigint"
            : ["calls", "payment"].includes(c.column_name) ? "jsonb" : c.column_name === "approved_by" ? "ARRAY" : c.column_name === "waiting" ? "boolean" : "text";
          assert.equal(c.data_type, type);
        }
        evidence.push({ table, columns });
      }
      writeFileSync(join(dir, "schema.json"), JSON.stringify(evidence) + "\n");
    });
    await emit("BOARD.writer-acl", async () => {
      const evidence = [];
      for (const table of Object.keys(tables)) {
        const rls = (await database.worker.query("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass", [`app.${table}`])).rows[0];
        assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
        const roles = (await database.worker.query(`select r as role,has_table_privilege(r,$1,'SELECT') as read,
          has_table_privilege(r,$1,'INSERT') as insert,has_table_privilege(r,$1,'UPDATE') as update,
          has_table_privilege(r,$1,'DELETE') as delete,has_table_privilege(r,$1,'TRUNCATE') as truncate
          from unnest(array['capxul_core','capxul_worker']) r order by r`, [`app.${table}`])).rows;
        assert.deepEqual(roles, [
          { role: "capxul_core", read: true, insert: false, update: false, delete: false, truncate: false },
          { role: "capxul_worker", read: true, insert: true, update: true, delete: false, truncate: false },
        ]);
        evidence.push({ table, rls, roles });
      }
      writeFileSync(join(dir, "writer-acl.json"), JSON.stringify(evidence) + "\n");
    });
  } catch { failed = true; }
  finally { await db?.close(); }
  for (const name of checks.filter((name) => !seen.has(name))) await emit(name, async () => { throw new Error("prerequisite failed"); });
  process.exitCode = failed ? 1 : 0;
}
