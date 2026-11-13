import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import { record, transaction, type Sql } from "../src/platform/db.ts";

const url = process.env.RECORD_TEST_ADMIN_URL;
if (!url || new URL(url).pathname !== "/record_test" || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  throw new Error("RECORD_TEST_ADMIN_URL must name a dedicated loopback record_test database");
}

test("records preserve supplied world instants, caller rollback and ordering, with no database-time fallback", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  // The callback Sites requires: an older five-argument implementation is assignable but ignores its instant.
  const append: (sql: Sql, org: string, kind: string, trace: string, data: unknown, at: number) => Promise<void> = record;
  const frozen = 946684800123, advanced = frozen + 47_000;
  const rows = async () => (await sql.query("select trace,at,previous_hash,hash from app.records where org_id='clock-org' order by id")).rows;
  try {
    await sql.query(await readFile(new URL("../src/schema.sql", import.meta.url), "utf8"));
    await sql.query(`insert into app.organizations (org_id,name,safe,site,admin_email,token)
      values ('clock-org','before','clock-safe','clock.test','clock@example.test','test-only')`);
    for (const [trace, at] of [["epoch-zero", 0], ["frozen-first", frozen], ["frozen-second", frozen], ["advanced", advanced]] as const) {
      await transaction(sql, "clock-org", (tx) => append(tx, "clock-org", "clock_control", trace, { trace }, at));
    }
    const before = await rows();
    assert.deepEqual(before.map((r) => r.at.getTime()), [0, frozen, frozen, advanced]);
    assert.equal(before[0].previous_hash, "");
    for (let i = 1; i < before.length; i++) assert.equal(before[i].previous_hash, before[i - 1].hash);
    await assert.rejects(transaction(sql, "clock-org", async (tx) => {
      await tx.query("update app.organizations set name='rolled back' where org_id='clock-org'");
      await append(tx, "clock-org", "clock_control", "aborted", {}, advanced + 19_000);
      throw new Error("abort-source");
    }), /abort-source/);
    assert.deepEqual(await rows(), before, "source rollback must also remove its dated event");
    assert.equal((await sql.query("select name from app.organizations where org_id='clock-org'")).rows[0].name, "before");
    // No host-clock fallback (inv:time.no-direct-reads): a record without the caller's world instant is refused,
    // and the column has no default for a writer that bypasses record().
    await assert.rejects(transaction(sql, "clock-org", (tx) => record(tx, "clock-org", "clock_control", "missing", {}, undefined as unknown as number)),
      /INVALID_INPUT/);
    await assert.rejects(sql.query(`insert into app.records (org_id,kind,trace,data,previous_hash,hash)
      values ('clock-org','clock_control','bypass','{}','','')`), /null value in column "at"/);
    assert.deepEqual(await rows(), before);
  } finally { await sql.end(); }
});
