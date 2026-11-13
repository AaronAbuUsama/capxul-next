import assert from "node:assert/strict";
import type { Database } from "../../../../backend/src/platform/db.ts";

/** Actual second company and actual persisted row, not an empty-table policy inspection. */
export async function tenancy(db: Database, table: "book_facts" | "book_feeds" | "book_annotations" | "budgets", org: string) {
  const second = (await db.worker.query("select org_id from app.organizations where org_id<>$1 order by org_id limit 1", [org])).rows[0]?.org_id;
  assert(second, "a second real organization is required for tenant controls");
  const field = table === "book_annotations" ? "owner_id" : "org_id";
  const before = await db.transaction(org, async (sql) => {
    const rows = (await sql.query(`select * from app.${table} where ${field}=$1`, [org])).rows;
    assert(rows.length, `${table} needs a real writer's persisted row`);
    return rows;
  });
  await db.transaction(second, async (sql) => {
    assert.deepEqual((await sql.query(`select * from app.${table} where ${field}=$1`, [org])).rows, []);
    if (table !== "book_facts") {
      const update = await sql.query(`update app.${table} set ${field}=${field} where ${field}=$1`, [org]);
      assert.equal(update.rowCount, 0, "a second tenant cannot update the first's rows");
    }
  });
  await assert.rejects(db.transaction(second, (sql) => sql.query(`insert into app.${table}
    select r.* from jsonb_populate_record(null::app.${table},$1::jsonb) r`, [JSON.stringify(before[0])])),
  (error: { code?: string }) => error.code === "42501", "cross-tenant insert must be refused by RLS");
  const after = await db.transaction(org, async (sql) => (await sql.query(`select * from app.${table} where ${field}=$1`, [org])).rows);
  assert.deepEqual(after, before, "tenant probes cannot change persisted state");
  return { table, first: org, second, before, after };
}
