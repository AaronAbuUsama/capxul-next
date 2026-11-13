import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { migrateWorldCompanies, readWorldCompanies } from "@capxul/backend/organizations";

const adminUrl = process.env.WORLD_COMPANY_TEST_ADMIN_URL;
if (!adminUrl || new URL(adminUrl).pathname !== "/world_companies_test" ||
    !["localhost", "127.0.0.1"].includes(new URL(adminUrl).hostname)) {
  throw new Error("WORLD_COMPANY_TEST_ADMIN_URL must name a fresh dedicated loopback world_companies_test DB with the foundation migration");
}
for (const [name, role] of [["DATABASE_URL", "capxul_core"], ["WORKER_DATABASE_URL", "capxul_worker"]] as const) {
  const url = new URL(process.env[name]!);
  assert.equal(url.hostname, new URL(adminUrl).hostname);
  assert.equal(url.port, new URL(adminUrl).port);
  assert.equal(url.pathname, new URL(adminUrl).pathname);
  assert.equal(url.username, role);
}

test("world inventory includes core-only and released companies, stays read-only and refuses tenant inventory", async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  const worker = new pg.Client({ connectionString: process.env.WORKER_DATABASE_URL });
  const tenant = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await Promise.all([admin.connect(), worker.connect(), tenant.connect()]);
    // Provisioning is explicit and idempotent; the public reader must also work before any company exists.
    await admin.query("begin");
    await migrateWorldCompanies(admin);
    await migrateWorldCompanies(admin);
    await admin.query("commit");
    assert.deepEqual(await readWorldCompanies(worker), []);
    await assert.rejects(readWorldCompanies(admin), /FORBIDDEN/);
    const expected = [
      { orgId: "a-hosted", name: "Different Hosted Name", site: "Hosted.Example.test" },
      { orgId: "m-released", name: "Historical Company", site: null },
      { orgId: "z-core", name: "Core Only Company", site: null },
    ];
    for (const [i, row] of [...expected].reverse().entries()) {
      await worker.query(`insert into app.organizations(org_id,name,safe,site,admin_email,token,released)
        values ($1,$2,$3,$4,$5,$6,$7)`, [row.orgId, row.name, `safe-${i}`, row.site,
        "private@example.test", "private-token", row.orgId === "m-released"]);
    }
    // An org GUC must neither expand the tenant's RLS nor truncate the worker's inventory.
    await tenant.query("begin read only");
    await tenant.query("select set_config('app.org_id','a-hosted',true)");
    assert.deepEqual((await tenant.query("select org_id from app.organizations")).rows, [{ org_id: "a-hosted" }]);
    await assert.rejects(readWorldCompanies(tenant), /FORBIDDEN/);
    await tenant.query("select set_config('app.org_id','',true)");
    await assert.rejects(readWorldCompanies(tenant), /FORBIDDEN/);
    await worker.query("begin read only");
    await worker.query("select set_config('app.org_id','a-hosted',true)");
    assert.deepEqual(await readWorldCompanies(worker), expected);
    assert.equal((await worker.query("select current_setting('app.org_id') as org")).rows[0].org, "a-hosted");
    const role = (await worker.query("select rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0];
    assert.deepEqual(role, { rolsuper: false, rolbypassrls: false });
    await worker.query("commit");
    await tenant.query("rollback");
  } finally {
    await Promise.all([worker.query("rollback").catch(() => {}), tenant.query("rollback").catch(() => {}), admin.query("rollback").catch(() => {})]);
    await Promise.all([admin.end(), worker.end(), tenant.end()]);
  }
});
