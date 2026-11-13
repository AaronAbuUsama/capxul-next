import { readFileSync } from "node:fs";
import type { Sql } from "../platform/db.ts";
export { upload, get, requireImage, expire, admit, type Upload, type Purpose, type MediaRuntime, type FileTransition } from "./files.ts";
export { routeMedia, tickMedia, mediaRuntime, mediaPaths, mediaBodyLimit, type MediaServices } from "./routes.ts";

export async function migrateMedia(sql: Sql) {
  await sql.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
}
