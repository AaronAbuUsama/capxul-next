import assert from "node:assert/strict";
import type { Admin } from "../../../../devnet/src/devnet/door.ts";

// Independent physical expectations for the three declared devnet tables, not imports from their migration.
const schemas = {
  worlds: {
    text: "world_id name kind profile chain_instance clock_mode state", nullable: "address template parent_world parent_snapshot",
    bigint: "chain_id world_now created_at updated_at", integer: "rate epoch", boolean: "hosted", nullableBigint: "parent_seq",
    key: ["world_id"], indexes: [{ name: "worlds-by-name", fields: ["name"], unique: true }],
    enums: { kind: ["local", "simulated", "staging", "production"], profile: ["core", "full"], clock_mode: ["frozen", "running"], state: ["creating", "running", "stopped", "restoring", "parked", "closed"] },
  },
  world_snapshots: {
    text: "world_id name chain_state_ref clock_mode code_version", nullable: "", bigint: "record_seq world_now created_at",
    integer: "epoch rate", boolean: "template", jsonb: "site_backups", key: ["world_id", "name"],
    indexes: [{ name: "world-snapshots-by-created", fields: ["world_id", "created_at"], unique: false }],
    enums: { clock_mode: ["frozen", "running"] },
  },
  command_records: {
    text: "world_id prev id trace_id kind args who_kind world_time world_time_end real_time outcome",
    nullable: "command actor_email actor_address org_id site error_code error_reason error_detail result changes run_id model policy_version surface",
    bigint: "seq", nullableBigint: "cause_seq", integer: "epoch v", boolean: "branch_abandoned", "text[]": "actor_hats", "double precision": "duration_ms",
    key: ["world_id", "epoch", "seq"], indexes: [{ name: "command-records-by-who", fields: ["world_id", "actor_email", "world_time"], unique: false }, { name: "command-records-by-trace", fields: ["world_id", "trace_id"], unique: false }],
    enums: { kind: ["command", "tool-call", "reply", "born", "restore", "clock", "event", "join", "handover", "score"], who_kind: ["person", "agent", "system"], outcome: ["ok", "refused", "failed"], surface: ["cli", "sdk", "mcp", "http", "workflow"] },
  },
} as const;
export type Table = keyof typeof schemas;
export async function observeSchema(query: Admin, table: Table) {
  const [row] = await query(`SELECT jsonb_build_object(
    'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'nullable',NOT a.attnotnull) ORDER BY a.attnum)
      FROM pg_attribute a WHERE a.attrelid='app.${table}'::regclass AND a.attnum>0 AND NOT a.attisdropped),
    'key',(SELECT jsonb_agg(a.attname ORDER BY k.n) FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum,n)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum WHERE c.conrelid='app.${table}'::regclass AND c.contype='p'),
    'indexes',(SELECT jsonb_agg(jsonb_build_object('name',cl.relname,'unique',i.indisunique,'fields',(SELECT jsonb_agg(a.attname ORDER BY k.n)
      FROM unnest(i.indkey) WITH ORDINALITY k(attnum,n) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)) ORDER BY cl.relname)
      FROM pg_index i JOIN pg_class cl ON cl.oid=i.indexrelid WHERE i.indrelid='app.${table}'::regclass AND NOT i.indisprimary),
    'checks',(SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid='app.${table}'::regclass AND contype='c' AND convalidated))`);
  assert(row, "schema observation is empty");
  return row;
}
export function assertSchema(table: Table, row: Record<string, unknown>) {
  const expected = schemas[table];
  const columns = Object.entries(expected).filter(([kind]) => !["key", "indexes", "enums"].includes(kind)).flatMap(([kind, fields]) =>
    (fields as string).split(" ").filter(Boolean).map((name) => ({ name, type: kind === "nullable" ? "text" : kind === "nullableBigint" ? "bigint" : kind, nullable: kind.startsWith("nullable") })));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  assert.deepEqual([...(row.columns as typeof columns)].sort(byName), columns.sort(byName), `${table} fields/types/nullability differ from the blueprint`);
  assert.deepEqual(row.key, expected.key, `${table} primary key differs`);
  assert.deepEqual(row.indexes, [...expected.indexes].sort(byName), `${table} indexes differ`);
  const checks = row.checks as string[];
  assert(Array.isArray(checks), `${table} has no validated constraints`);
  for (const [field, values] of Object.entries(expected.enums)) {
    const constraint = checks.find((c) => new RegExp(`\\b${field} = ANY\\b`).test(c));
    assert(constraint, `${table}.${field} is not enum-constrained`);
    assert.deepEqual([...constraint.matchAll(/'([^']+)'::text/g)].map((m) => m[1]).sort(), [...values].sort(), `${table}.${field} enum differs`);
  }
}
