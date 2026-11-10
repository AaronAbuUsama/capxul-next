// node --experimental-strip-types src/main.ts <blueprint module> [out dir]
// The module exports `name`, `stage` and `records`. Prints the summary, writes the views,
// and exits 1 when the blueprint has problems.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildBlueprint } from "./build.ts";
import { conceptPage, summaryPage } from "./views.ts";

const [modulePath, out = "book-out"] = process.argv.slice(2);
if (!modulePath) throw new Error("usage: main.ts <blueprint module> [out dir]");
const mod = (await import(pathToFileURL(resolve(modulePath)).href)) as { name?: string; stage?: "as-is" | "target"; records: unknown[] };
const blueprint = buildBlueprint({ name: mod.name ?? modulePath, stage: mod.stage ?? "target", records: mod.records });

mkdirSync(join(out, "concepts"), { recursive: true });
writeFileSync(join(out, "README.md"), summaryPage(blueprint));
for (const r of blueprint.records.values()) if (r._kind === "concept") writeFileSync(join(out, "concepts", `${r.id}.md`), conceptPage(blueprint, r));
writeFileSync(join(out, "evals.json"), JSON.stringify(blueprint.evals, null, 2));
writeFileSync(join(out, "findings.json"), JSON.stringify({ problems: blueprint.problems, gaps: blueprint.gaps, standing: blueprint.standing }, null, 2));

console.log(`${blueprint.records.size} records, ${blueprint.evals.length} evals, ${blueprint.problems.length} problems, ${blueprint.gaps.length} gaps, ${blueprint.standing.length} standing → ${out}`);
for (const p of blueprint.problems) console.log(`problem ${p.record} ${p.rule}: ${p.detail}`);
process.exitCode = blueprint.problems.length ? 1 : 0;
