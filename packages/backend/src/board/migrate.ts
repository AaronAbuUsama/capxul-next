import { readFileSync } from "node:fs";
import type { Sql } from "../platform/db.ts";

/** Explicit provisioning only, inside the integrator's migration transaction. Never on resume. */
export async function migrate(sql: Sql) {
  await sql.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  for (const table of ["board_proposals", "officer_changes", "proposal_approvals"]) {
    await sql.query(`alter table app.${table} enable row level security; alter table app.${table} force row level security`);
    await sql.query(`drop policy if exists tenant on app.${table}`);
    await sql.query(`create policy tenant on app.${table} to capxul_core,capxul_worker
      using (org_id=current_setting('app.org_id',true)) with check (org_id=current_setting('app.org_id',true))`);
    // Public sessions may read their company, never issue table writes. Mutations run behind authenticated doors.
    await sql.query(`revoke all on app.${table} from public,capxul_core,capxul_worker`);
    await sql.query(`grant select on app.${table} to capxul_core,capxul_worker`);
    await sql.query(`grant insert,update on app.${table} to capxul_worker`);
  }
}
