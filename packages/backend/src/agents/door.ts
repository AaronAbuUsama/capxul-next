import { readFileSync } from "node:fs";
import type { Sql } from "../platform/db.ts";

export async function migrateAgents(sql: Sql) {
  await sql.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
}

export async function bySafe(sql: Sql, safe: string) {
  return (await sql.query("select * from app.agents where safe_address=$1", [safe.toLowerCase()])).rows[0] ?? null;
}
export async function byId(sql: Sql, id: string) {
  return (await sql.query("select * from app.agents where agent_id=$1", [id])).rows[0] ?? null;
}
