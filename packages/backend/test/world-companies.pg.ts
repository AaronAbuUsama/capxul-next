import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { readWorldCompanies } from "@capxul/backend/organizations";
import { Database, type Sql } from "../src/platform/db.ts";

// On a world migrated by the real src/migrate.ts (the target app.organizations). Run:
// WORLD_COMPANY_TEST_ADMIN_URL=…/world_companies_test with DATABASE_URL and WORKER_DATABASE_URL on that DB.
const adminUrl = process.env.WORLD_COMPANY_TEST_ADMIN_URL;
if (!adminUrl || new URL(adminUrl).pathname !== "/world_companies_test" ||
    !["localhost", "127.0.0.1"].includes(new URL(adminUrl).hostname)) {
  throw new Error("WORLD_COMPANY_TEST_ADMIN_URL must name a fresh dedicated loopback world_companies_test DB migrated by src/migrate.ts");
}
for (const [name, role] of [["DATABASE_URL", "capxul_core"], ["WORKER_DATABASE_URL", "capxul_worker"]] as const) {
  const url = new URL(process.env[name]!);
  assert.deepEqual([url.hostname, url.port, url.pathname, url.username], [new URL(adminUrl).hostname, new URL(adminUrl).port, new URL(adminUrl).pathname, role]);
}
const hex = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

test("world inventory: every Organization by orgId, each site host read in its own scoped worker transaction", async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  const db = new Database(process.env.DATABASE_URL!, process.env.WORKER_DATABASE_URL!);
  const tenantOnly = new Database(process.env.DATABASE_URL!, process.env.DATABASE_URL!);
  try {
    await admin.connect();
    // Sites' app.sites admits one Organization at a time: the stand-in answers only the scoped one, as readSiteHosts does,
    // and also names another Organization, which the reader must not take.
    const seen: string[] = [];
    const hosts = async (sql: Sql): Promise<Record<string, string>> => {
      const r = (await sql.query("select current_user as role,current_setting('app.org_id',true) as org")).rows[0];
      seen.push(`${r.role}:${r.org}`);
      return r.org === "a-hosted" ? { "a-hosted": "Hosted.Example.test", "z-core": "Leaked.Example.test" } : {};
    };
    assert.deepEqual(await readWorldCompanies(db, hosts), [], "before any company exists");
    for (const [i, [orgId, name]] of [["z-core", "Core Only Company"], ["a-hosted", "Different Hosted Name"]].entries()) {
      await admin.query(`insert into app.parties(party_id,kind,state,handle,safe_address,owner_kind,owner_id,created_at,updated_at)
        values($1,'organization','active',$2,$3,'organization',$2,1,1),($4,'person','active',null,$5,'person',$4,1,1)`,
      [`party_${orgId}`, orgId, hex(0xa0 + i), `party_founder_${i}`, hex(0xf0 + i)]);
      await admin.query(`insert into app.organizations(org_id,party_id,name,country,chain_id,safe_address,founder_party_id,founder_safe,seat_limit,
        abbr,default_currency,time_zone,fiscal_year_start,created_at,updated_at) values($1,$2,$3,'GB',84532,$4,$5,$6,3,'AC','GBP','Europe/London','01-01',1,1)`,
      [orgId, `party_${orgId}`, name, hex(0xa0 + i), `party_founder_${i}`, hex(0xf0 + i)]);
    }
    assert.deepEqual(await readWorldCompanies(db, hosts), [
      { orgId: "a-hosted", name: "Different Hosted Name", site: "Hosted.Example.test" },
      { orgId: "z-core", name: "Core Only Company", site: null },
    ]);
    assert.deepEqual(seen, ["capxul_worker:a-hosted", "capxul_worker:z-core"]);
    // A worker URL that is really the tenant role is refused, never a tenant-filtered partial list.
    await assert.rejects(readWorldCompanies(tenantOnly, hosts), /FORBIDDEN/);
  } finally {
    await Promise.all([admin.end(), db.close(), tenantOnly.close()]);
  }
});
