import { readFileSync } from "node:fs";
import type { Sql } from "../platform/db.ts";

export async function migrateRequests(sql: Sql) {
  await sql.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
}
