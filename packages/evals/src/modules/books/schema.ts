import assert from "node:assert/strict";
import type { Sql } from "../../../../backend/src/platform/db.ts";

// Independent expected contracts from blueprint/books/data.ts and blueprint/budgets/data.ts,
// not parsed from migration SQL (which is the implementation under test).
const contracts = {
  book_feeds: {
    columns: "org_id:text last_seq:integer created_at:double updated_at:double",
    key: ["org_id"], indexes: [], checks: ["last_seq >= 0"],
  },
  book_annotations: {
    columns: "owner_kind:text owner_id:text reference_kind:text reference_id:text account:text? account_number:text? party_type:text? party_id:text? cost_center:text? project:text? references:jsonb suggestion:text? memo:text? status:text last_editor_kind:text last_editor_id:text created_at:double updated_at:double",
    key: ["owner_kind", "owner_id", "reference_kind", "reference_id"],
    indexes: [["book_annotations_by_owner_status_account", false, ["owner_kind", "owner_id", "status", "account", "updated_at"]]],
    checks: ["owner_kind", "reference_kind", "party_type", "status", "last_editor_kind", "jsonb_typeof"],
  },
  book_facts: {
    columns: "org_id:text fact_id:text seq:integer kind:text occurred_at:double recorded_at:double account:text? from_account:text? reference_kind:text? reference_id:text? rows:jsonb money_key:text? generation:double? direction:text? asset_id:text? symbol:text? decimals:double? amount_raw:text? fee_raw:text? usd_value:text? usd_rate:text? usd_source:text? safe_address:text? counterparty:text? party_id:text? source_kind:text? source_id:text? chain_id:double? block_number:double? tx_hash:text? log_index:double? reverses_fact_id:text? actor_kind:text actor_id:text?",
    key: ["org_id", "fact_id"],
    indexes: [
      ["book_facts_by_org_seq", true, ["org_id", "seq"]],
      ["book_facts_by_org_occurred", false, ["org_id", "occurred_at", "fact_id"]],
      ["book_facts_by_org_kind_occurred", false, ["org_id", "kind", "occurred_at", "fact_id"]],
      ["book_facts_by_org_source", false, ["org_id", "source_kind", "source_id", "occurred_at"]],
      ["book_facts_by_org_money_key", true, ["org_id", "money_key", "generation", "kind"]],
      ["book_facts_by_org_reference", false, ["org_id", "reference_kind", "reference_id"]],
      ["book_facts_by_org_asset", false, ["org_id", "asset_id", "occurred_at"]],
    ],
    checks: ["seq > 0", "kind", "reference_kind", "direction", "source_kind", "actor_kind", "jsonb_typeof"],
  },
  budgets: {
    columns: "org_id:text budget_ref:text kind:text key:text key_claim:text? name:text parent_budget_id:text? token:text period:text budget_id:text? hat_id:text admin_hat_id:text status:text created_change_id:text created_at:double updated_at:double",
    key: ["org_id", "budget_ref"],
    indexes: [
      ["budgets_by_org_key_claim", true, ["org_id", "key_claim"]],
      ["budgets_by_org_budget_id", true, ["org_id", "budget_id"]],
      ["budgets_by_org_kind_ref", false, ["org_id", "kind", "budget_ref"]],
    ],
    checks: ["kind", "period", "status"],
  },
} as const;

export async function assertSchema(sql: Sql, table: keyof typeof contracts) {
  const expected = contracts[table];
  const columns = (await sql.query(`select column_name as name,data_type as type,is_nullable='YES' as nullable
    from information_schema.columns where table_schema='app' and table_name=$1 order by ordinal_position`, [table])).rows;
  const wanted = expected.columns.split(" ").map((column) => {
    const [name, type] = column.split(":") as [string, string];
    return { name, type: type.replace(/\?$/, "").replace(/^double$/, "double precision"), nullable: type.endsWith("?") };
  });
  assert.deepEqual(columns, wanted, `${table} exact fields/types/nullability`);
  const indexes = (await sql.query(`select c.relname as name,i.indisprimary as primary,i.indisunique as unique,
      array_agg(a.attname::text order by k.ord) as fields
    from pg_index i join pg_class c on c.oid=i.indexrelid
    cross join lateral unnest(i.indkey) with ordinality k(num,ord)
    join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.num
    where i.indrelid=$1::regclass group by c.relname,i.indisprimary,i.indisunique`, [`app.${table}`])).rows;
  assert.deepEqual(indexes.filter((i) => i.primary).map((i) => i.fields), [expected.key]);
  assert.deepEqual(indexes.filter((i) => !i.primary).map((i) => [i.name, i.unique, i.fields]).sort(), [...expected.indexes].sort());
  const checks = (await sql.query(`select pg_get_constraintdef(oid) as definition from pg_constraint
    where conrelid=$1::regclass and contype='c'`, [`app.${table}`])).rows.map((r) => String(r.definition));
  assert.equal(checks.length, expected.checks.length, `${table} declared check constraints`);
  for (const check of expected.checks) assert(checks.some((c) => c.includes(check)), `${table} missing ${check} constraint`);
  const policy = (await sql.query(`select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass`, [`app.${table}`])).rows[0];
  assert.deepEqual(policy, { relrowsecurity: true, relforcerowsecurity: true });
  return { table, columns, indexes, checks, policy };
}
