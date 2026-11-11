// node --experimental-strip-types src/main.ts <book module> [out dir]
// The module exports `name`, `stage` and `records`. Prints the summary, writes the views,
// and exits 1 when the book has problems.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildBook } from "./build.ts";
import { conceptPage, summaryPage } from "./views.ts";

const [modulePath, out = "book-out"] = process.argv.slice(2);
if (!modulePath) throw new Error("usage: main.ts <book module> [out dir]");
const mod = (await import(pathToFileURL(resolve(modulePath)).href)) as { name?: string; stage?: "as-is" | "target"; records: unknown[] };
const book = buildBook({ name: mod.name ?? modulePath, stage: mod.stage ?? "target", records: mod.records });

mkdirSync(join(out, "concepts"), { recursive: true });
writeFileSync(join(out, "README.md"), summaryPage(book));
for (const r of book.records.values()) if (r._kind === "concept") writeFileSync(join(out, "concepts", `${r.id}.md`), conceptPage(book, r));
writeFileSync(join(out, "evals.json"), JSON.stringify(book.evals, null, 2));
writeFileSync(join(out, "findings.json"), JSON.stringify({ problems: book.problems, gaps: book.gaps }, null, 2));

console.log(`${book.records.size} records, ${book.evals.length} evals, ${book.problems.length} problems, ${book.gaps.length} gaps → ${out}`);
for (const p of book.problems) console.log(`problem ${p.record} ${p.rule}: ${p.detail}`);
process.exitCode = book.problems.length ? 1 : 0;
