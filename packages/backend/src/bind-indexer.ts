import pg from "pg";
import { required } from "./platform/config.ts";

// Run explicitly after Ponder creates its tables. Never on service resume: restored rows are not migrations.
const admin = new URL(required("PG_ADMIN_URL"));
admin.pathname = new URL(required("DATABASE_URL")).pathname;
const db = new pg.Client({ connectionString: admin.href });
await db.connect();
try {
  await db.query("begin");
  const safe = (column: string) => `exists (select 1 from app.organizations o where o.org_id=current_setting('app.org_id',true) and o.safe=${column})`;
  const views = {
    chain_payments: safe("p.sender"),
    transfers: `(${safe('p."from"')} or ${safe('p."to"')})`,
    chain_logs: `(${safe("p.args->>'safe'")} or exists (select 1 from app.hats h where h.org_id=current_setting('app.org_id',true) and h.hat_id=p.args->>'id'))`,
    user_operations: `(${safe("p.sender")} or exists (select 1 from app.people u where u.org_id=current_setting('app.org_id',true) and coalesce(u.personal_safe,u.address)=p.sender))`,
  };
  for (const [table, scope] of Object.entries(views)) {
    // The security barrier and explicit session scope remain effective even though the view owner reads raw facts.
    await db.query(`create or replace view app.${table} with (security_barrier=true) as select p.* from ponder.${table} p
      where current_user='capxul_worker' or ${scope}`);
    await db.query(`grant select on app.${table} to capxul_core,capxul_worker`);
  }
  await db.query("commit");
  console.log("Ponder tables bound through session-scoped company views; tenant role has no raw-schema access");
} catch (error) { await db.query("rollback"); throw error; }
finally { await db.end(); }
