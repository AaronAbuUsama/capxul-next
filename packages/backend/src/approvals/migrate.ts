import { readFileSync } from "node:fs";
import type { Sql } from "../platform/db.ts";

/** Shared migration calls after legacy schema/roles are installed, in the same admin transaction. */
export async function migrateApprovals(sql: Sql) {
  await sql.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
}
