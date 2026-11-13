import { readFileSync } from "node:fs";
import type { Sql } from "../platform/db.ts";

/** Provisioning composition calls this on its existing admin transaction, never at runtime. */
export async function migrate(sql: Sql) {
  await sql.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
}

/** Read only the selected tenant's live indexed office; never cache wearers in budget metadata. */
export async function currentWearers(sql: Sql, input: { orgId: string; chainId: number; budgetId: string }): Promise<string[]> {
  const rows = await sql.query(`select distinct h.wearer from app.chain_budgets b
    join app.hat_wearers h on h.chain_id=b.chain_id and h.company_safe=b.company_safe and h.hat_id=b.hat_id
    where current_setting('app.org_id',true)=$1 and b.chain_id=$2 and b.budget_id=$3 and h.wearing
    order by h.wearer`, [input.orgId, input.chainId, input.budgetId]);
  return rows.rows.map((row) => String(row.wearer));
}

export { proposeChange, settleChange, type Carry, type CarrierEnd, type ChangeBirth, type PlannedBudget, type Terms } from "./changes.ts";
export { createDepartment, type DepartmentServices, type Carried, type CarrierInput, type People } from "./departments.ts";
export { listDepartments } from "./list.ts";
export { departmentsHandler } from "./routes.ts";
