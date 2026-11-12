import { readFileSync } from "node:fs";
import type { Sql } from "../platform/db.ts";
export { upload, get, expire, admit, type Upload, type Purpose, type MediaRuntime, type FileTransition } from "./files.ts";

export async function migrateMedia(sql: Sql) {
  await sql.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
}
