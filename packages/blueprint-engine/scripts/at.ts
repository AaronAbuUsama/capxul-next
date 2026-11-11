// The blueprint as it was at a commit, built with that commit's own engine: the commit is checked out into a
// temporary worktree under var/at/<commit> and removed again. Null when that commit cannot be built.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Blueprint } from "../src/index.ts";

export const ROOT = resolve(import.meta.dirname, "../../..");
export const git = (...args: string[]) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });

export type Past = Pick<Blueprint, "records" | "links" | "evals">;

export const blueprintAt = async (commit: string): Promise<Past | null> => {
  const sha = git("rev-parse", "--verify", `${commit}^{commit}`).stdout.trim();
  if (!sha) return null;
  const dir = join(ROOT, "var/at", sha);
  if (!existsSync(dir) && git("worktree", "add", "--detach", dir, sha).status !== 0) return null;
  try {
    const engine = (await import(pathToFileURL(join(dir, "packages/blueprint-engine/src/index.ts")).href)) as {
      buildBlueprint: (i: { name: string; stage: "target"; records: unknown[] }) => Past;
    };
    const mod = (await import(pathToFileURL(join(dir, "blueprint/index.ts")).href)) as { records: unknown[] };
    return engine.buildBlueprint({ name: sha, stage: "target", records: mod.records });
  } catch {
    return null;
  } finally {
    git("worktree", "remove", "--force", dir);
    rmSync(dir, { recursive: true, force: true });
  }
};
