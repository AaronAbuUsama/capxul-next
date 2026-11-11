// `pnpm evals claims`: give each recorded verdict that names no claim the claim it proved, read from the blueprint at
// the commit the verdict was recorded at. A verdict recorded before verdicts named their claim would otherwise read as
// stale forever. Each old commit is checked out into a temporary worktree under var/ and built with its own engine, so
// the claim is the one that run saw; the current blueprint then decides whether it still holds. Writes status/status.json.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseStatus, staleEvals, type Blueprint, type EvalStatus, type StatusDocument } from "@capxul/blueprint-engine";
import { loadTarget } from "../../blueprint-engine/scripts/target.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const STATUS = join(ROOT, "status/status.json");

const git = (...args: string[]) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });

/** The claims the blueprint derived at one commit, by eval id; null when that commit cannot be built. */
const claimsAt = async (commit: string): Promise<ReadonlyMap<string, string> | null> => {
  const dir = join(ROOT, "var/claims", commit);
  if (!existsSync(dir) && git("worktree", "add", "--detach", dir, commit).status !== 0) return null;
  try {
    const engine = (await import(pathToFileURL(join(dir, "packages/blueprint-engine/src/index.ts")).href)) as {
      buildBlueprint: (i: { name: string; stage: "target"; records: unknown[] }) => Pick<Blueprint, "evals">;
    };
    const mod = (await import(pathToFileURL(join(dir, "blueprint/index.ts")).href)) as { records: unknown[] };
    return new Map(engine.buildBlueprint({ name: commit, stage: "target", records: mod.records }).evals.map((e) => [e.id, e.claim]));
  } catch {
    return null;
  } finally {
    git("worktree", "remove", "--force", dir);
    rmSync(dir, { recursive: true, force: true });
  }
};

export const claims = async (): Promise<number> => {
  if (!existsSync(STATUS)) { console.log("No status document: nothing has run."); return 0; }
  const parsed = parseStatus(JSON.parse(readFileSync(STATUS, "utf8")) as unknown);
  if (!parsed.ok) { console.error(parsed.errors.join("\n")); return 1; }
  const doc = parsed.value;
  const missing = Object.entries(doc.evals).filter(([, s]) => s.claim === undefined && s.verdict !== "not_run");
  const commits = [...new Set(missing.map(([, s]) => s.commit))];
  const evals: Record<string, EvalStatus> = { ...doc.evals };
  for (const commit of commits) {
    const at = await claimsAt(commit);
    if (at === null) { console.log(`${commit}: cannot be built here, so its verdicts stay without a claim and read as stale`); continue; }
    for (const [id, s] of missing.filter(([, x]) => x.commit === commit)) {
      const claim = at.get(id);
      if (claim === undefined) console.log(`${id}: the blueprint at ${commit} derives no such eval; left without a claim`);
      else evals[id] = { ...s, claim };
    }
  }
  const next: StatusDocument = { version: 1, evals };
  writeFileSync(STATUS, `${JSON.stringify(next, null, 2)}\n`);
  const target = await loadTarget();
  const stale = target.ok ? staleEvals(target.blueprint, next) : [];
  console.log(`${missing.length} verdicts had no claim; ${Object.values(evals).filter((s) => s.claim !== undefined).length} now name one. Stale against the blueprint now: ${stale.length}${stale.length ? ` (${stale.join(", ")})` : ""}.`);
  return 0;
};
