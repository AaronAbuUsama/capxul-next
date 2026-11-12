import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRunReceipt } from "@capxul/blueprint-engine";
import { Database } from "../../../../backend/src/devnet/door.ts";

export type TableContract = {
  table: "agents" | "documents" | "files";
  columns: readonly (readonly [string, string, boolean])[];
  key: readonly string[];
  indexes: readonly (readonly [string, readonly string[], boolean])[];
  enums: Readonly<Record<string, readonly string[]>>;
};

/** Reads the selected world's actual catalog. It never migrates, seeds, sets caller labels or imports receipts. */
export async function runStorage(area: string, contract: TableContract) {
  const prefix = area.toUpperCase();
  const names = [`${prefix}.schema`, `${prefix}.closed-table-writes`];
  if (process.argv.includes("--list")) {
    for (const name of names) console.log(`${name}\tcheck`);
    return;
  }
  let db: Database | undefined;
  let ready = false;
  const emit = async (name: string, effect: () => Promise<void>) => {
    const start = performance.now();
    try {
      await effect();
      console.log(`@check\t${name}\tpass\t${Math.round(performance.now() - start)}\tselected-world native catalog checked`);
    } catch {
      // Do not echo connection strings, bearer tokens, query parameters or HTTP bodies.
      process.exitCode = 1;
      console.log(`@check\t${name}\tfail\t${Math.round(performance.now() - start)}\tselected-world prerequisite or native storage contract failed`);
    }
  };
  try {
    await emit(names[0]!, async () => {
      const dir = process.env.CAPXUL_EVAL_RUN_DIR;
      const database = process.env.CAPXUL_STORAGE_EVAL_DATABASE;
      const coreUrl = process.env.CAPXUL_CORE_URL;
      assert(dir && database && coreUrl, "receipt and restricted selected-world database/Core required");
      const parsed = parseRunReceipt(JSON.parse(readFileSync(join(dir, "receipt.json"), "utf8")));
      assert(parsed.ok);
      const receipt = parsed.value;
      assert.equal(receipt.state, "running");
      assert.equal(receipt.environment.world, "slice-zero");
      assert.equal(receipt.environment.storage, "postgres");
      assert.equal(receipt.environment.indexer, "ponder");
      assert.equal(receipt.environment.stack, "postgres-ponder-erpnext-v4");
      assert(receipt.scripts.some((s) => s.script === `packages/evals/src/modules/${area}/run.sh`));
      const preparation = JSON.parse(readFileSync(join(dir, "preparation.json"), "utf8"));
      assert.deepEqual(preparation.run, { id: receipt.id, at: receipt.at, commit: receipt.commit });
      assert.equal(typeof preparation.world?.id, "string");
      assert(preparation.world.id.length > 0);
      assert(Number.isSafeInteger(preparation.world.epoch) && preparation.world.epoch >= 1);
      const response = await fetch(new URL("/ready", coreUrl), { signal: AbortSignal.timeout(10000) });
      assert(response.ok);
      const health = await response.json();
      assert.equal(health.world, preparation.world.id);
      assert.equal(health.storage, "postgres"); assert.equal(health.indexer, "ponder");
      db = new Database(database, database);
      const sql = await db.tenant.connect();
      try {
        const role = (await sql.query("select current_user as name,rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0];
        assert.equal(role.name, "capxul_core"); assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
        const world = (await sql.query("select world_id,epoch from app.world")).rows[0];
        assert.equal(world?.world_id, preparation.world.id);
        assert.equal(Number(world.epoch), preparation.world.epoch);
        const columns = (await sql.query(`select a.attname as name,format_type(a.atttypid,a.atttypmod) as type,a.attnotnull as required
          from pg_attribute a where a.attrelid=$1::regclass and a.attnum>0 and not a.attisdropped order by a.attnum`, [`app.${contract.table}`])).rows;
        assert.deepEqual(columns.map((c) => [c.name, c.type, c.required]), contract.columns);
        const indexes = (await sql.query(`select ci.relname as name,i.indisprimary as primary,i.indisunique as unique,
          i.indpred is null and i.indexprs is null and i.indisvalid and i.indisready as plain,
          array(select a.attname::text from unnest(i.indkey) with ordinality k(attnum,n)
            join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum order by k.n) as fields
          from pg_index i join pg_class ci on ci.oid=i.indexrelid where i.indrelid=$1::regclass order by ci.relname`, [`app.${contract.table}`])).rows;
        assert.deepEqual(indexes.filter((i) => i.primary).map((i) => i.fields), [contract.key]);
        assert.deepEqual(indexes.filter((i) => !i.primary).map((i) => [i.name, i.fields, i.unique]), contract.indexes);
        assert(indexes.every((i) => i.plain), "partial, expression or invalid index cannot stand in for the declared key");
        const constraints = (await sql.query(`select pg_get_constraintdef(c.oid) as definition,
          array(select a.attname::text from unnest(c.conkey) k(attnum) join pg_attribute a
            on a.attrelid=c.conrelid and a.attnum=k.attnum) as fields
          from pg_constraint c where c.conrelid=$1::regclass and c.contype='c'`, [`app.${contract.table}`])).rows;
        for (const [field, values] of Object.entries(contract.enums)) {
          assert(constraints.some((c) => c.fields.length === 1 && c.fields[0] === field &&
            JSON.stringify([...c.definition.matchAll(/'((?:''|[^'])*)'/g)].map((m) => m[1]).sort()) === JSON.stringify([...values].sort())), `missing enum constraint for ${field}`);
        }
        const rls = (await sql.query("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass", [`app.${contract.table}`])).rows[0];
        assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
        ready = true;
      } finally { sql.release(); }
    });
    await emit(names[1]!, async () => {
      assert(ready && db);
      for (const role of ["capxul_core", "capxul_worker"]) for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        const rows: { allowed: boolean }[] = (await db.tenant.query("select has_table_privilege($1,$2,$3) as allowed", [role, `app.${contract.table}`, privilege])).rows;
        assert.equal(rows[0]?.allowed, false);
      }
    });
  } finally { await db?.close(); }
}
