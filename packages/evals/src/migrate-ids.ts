// One-time migration from a saved pre-key catalogue. Historical run directories are immutable.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseStatus, type EvalDef } from "@capxul/blueprint-engine";
import { loadTarget } from "../../blueprint-engine/scripts/target.ts";

export const migrateIds = async (catalogue: string): Promise<number> => {
  const root = resolve(import.meta.dirname, "../../..");
  const before = JSON.parse(readFileSync(resolve(catalogue), "utf8")) as EvalDef[];
  const loaded = await loadTarget();
  if (!loaded.ok) throw new Error(loaded.error);
  const after = loaded.blueprint.evals;
  if (before.length !== after.length) throw new Error("catalogues have different lengths; migrate before changing records");
  const mapping = new Map<string, string>();
  for (const [i, old] of before.entries()) {
    const next = after[i]!;
    if (old.subject !== next.subject || old.level !== next.level || old.claim !== next.claim || old.decider !== next.decider ||
      (!old.id.startsWith("ref:") && old.observes !== next.observes))
      throw new Error(`catalogue contract changed at ${old.id}; refuse an ambiguous migration`);
    mapping.set(old.id, next.id);
  }
  if (new Set(mapping.values()).size !== mapping.size) throw new Error("new eval IDs collide");
  const statusPath = join(root, "status/status.json");
  const parsed = parseStatus(JSON.parse(readFileSync(statusPath, "utf8")));
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  const moved = Object.entries(parsed.value.evals).map(([id, entry]) => {
    const next = mapping.get(id);
    if (!next) throw new Error(`status eval ${id} is absent from the saved catalogue`);
    return [next, entry] as const;
  });
  const bindingsDir = join(root, "evals/bindings");
  const files = readdirSync(bindingsDir).filter((f) => f.endsWith(".json")).map((name) => {
    const path = join(bindingsDir, name);
    const file = JSON.parse(readFileSync(path, "utf8")) as { bindings: { eval: string }[]; near: { eval: string }[] };
    for (const row of [...file.bindings, ...file.near]) {
      const next = mapping.get(row.eval);
      if (!next) throw new Error(`binding eval ${row.eval} is absent from the saved catalogue`);
      row.eval = next;
    }
    return { path, file };
  });
  for (const { path, file } of files) writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  writeFileSync(statusPath, `${JSON.stringify({ version: 1, evals: Object.fromEntries(moved.sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`);
  console.log(`migrated ${[...mapping].filter(([a, b]) => a !== b).length} IDs; preserved ${moved.filter(([, e]) => e.verdict === "pass").length} passes and every historical evidence path`);
  return 0;
};
