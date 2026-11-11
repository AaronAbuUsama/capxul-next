// node --experimental-strip-types --no-warnings packages/atlas/src/main.ts [out dir]   (default var/atlas)
// Generates the atlas: what the product is and where it stands, from the blueprint, the status document and git.
// Exits 1 when the blueprint cannot be built or a generated page fails its check.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseStatus } from "../../blueprint-engine/src/index.ts";
import { loadTarget } from "../../blueprint-engine/scripts/target.ts";
import { checkSite } from "./check.ts";
import { readHistory } from "./history.ts";
import { buildModel } from "./model.ts";
import { renderSite } from "./render.ts";

const ROOT = resolve(import.meta.dirname, "../../..");

export const generate = async (): Promise<{ pages: Map<string, string>; errors: string[] }> => {
  const loaded = await loadTarget();
  if (!loaded.ok) return { pages: new Map(), errors: [loaded.error] };
  const file = join(ROOT, "status/status.json");
  const parsed = existsSync(file) ? parseStatus(JSON.parse(readFileSync(file, "utf8")) as unknown) : null;
  if (parsed && !parsed.ok) return { pages: new Map(), errors: [...parsed.errors] };
  const model = buildModel({ blueprint: loaded.blueprint, status: parsed?.value ?? null, history: readHistory(ROOT), built: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC" });
  const pages = renderSite(model);
  return { pages, errors: checkSite(model, pages) };
};

if (process.argv[1] === import.meta.filename) {
  const out = resolve(ROOT, process.argv[2] ?? "var/atlas");
  const { pages, errors } = await generate();
  if (errors.length) { console.error(`atlas: ${errors.length} error${errors.length === 1 ? "" : "s"}\n${errors.map((e) => `  - ${e}`).join("\n")}`); process.exit(1); }
  rmSync(out, { recursive: true, force: true });
  for (const [path, html] of pages) { mkdirSync(dirname(join(out, path)), { recursive: true }); writeFileSync(join(out, path), html); }
  console.log(`atlas: ${pages.size} pages → ${out}`);
}
