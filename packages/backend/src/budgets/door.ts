import { readFileSync } from "node:fs";
import type { Sql } from "../platform/db.ts";

/** Provisioning composition calls this on its existing admin transaction, never at runtime. */
export async function migrate(sql: Sql) {
  await sql.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
}

/** Read only the selected tenant's live indexed office; never cache wearers in budget metadata. */
export async function currentWearers(sql: Sql, input: { orgId: string; chainId: number; budgetId: string }): Promise<string[]> {
  // A module-ruled hat moves wearers with no Hats event, so its projection is not current (indexing.hats-indexed).
  const ruled = (await sql.query(`select c.hat_id from app.chain_budgets b join app.chain_hats c on c.chain_id=b.chain_id and c.hat_id=b.hat_id
    where current_setting('app.org_id',true)=$1 and b.chain_id=$2 and b.budget_id=$3 and c.live`, [input.orgId, input.chainId, input.budgetId])).rows[0];
  if (ruled) throw new Error(`HISTORICAL_UNAVAILABLE: hat ${BigInt(ruled.hat_id)} is ruled by a module; read Hats live`);
  const rows = await sql.query(`select distinct h.wearer from app.chain_budgets b
    join app.hat_wearers h on h.chain_id=b.chain_id and h.company_safe=b.company_safe and h.hat_id=b.hat_id
    where current_setting('app.org_id',true)=$1 and b.chain_id=$2 and b.budget_id=$3 and h.wearing
    order by h.wearer`, [input.orgId, input.chainId, input.budgetId]);
  return rows.rows.map((row) => String(row.wearer));
}
