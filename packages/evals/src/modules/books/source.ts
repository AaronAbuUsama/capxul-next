import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** A table's SQL writers stay in its concept; other concepts invoke only its door. */
export function assertWriters(concept: "books" | "budgets", table: string) {
  const root = "packages/backend/src", inspected: string[] = [], writers: string[] = [];
  function visit(dir: string) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, item.name);
      if (item.isDirectory()) { visit(file); continue; }
      if (!/\.(ts|sql)$/.test(file)) continue;
      const source = readFileSync(file, "utf8");
      inspected.push(file);
      const write = new RegExp(`\\b(?:insert\\s+into|update|delete\\s+from|truncate(?:\\s+table)?)\\s+app\\.${table}\\b`, "i");
      if (!write.test(source)) continue;
      const local = relative(root, file);
      assert(local.startsWith(`${concept}/`), `undeclared cross-concept SQL writer ${file}`);
      writers.push(file);
    }
  }
  visit(root);
  return { table, inspected, writers };
}
