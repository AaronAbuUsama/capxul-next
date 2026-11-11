/** A task must explicitly authorize new Questions-page entries; mentioning a ruling is not authorization. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Gate, Task } from "../types.ts";

const git = (dir: string, ...args: string[]): string => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

/** Evaluate each checkout's own predicate and records in a fresh process, never a cached import or built report. */
const waiting = (dir: string): string[] => {
  const code = `import { records } from './blueprint/index.ts';
import { forAaron } from './blueprint/shared/waiting.ts';
console.log(JSON.stringify(records.filter(r => r._kind === 'decision' && forAaron(r)).map(r => r.id)));`;
  return JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", code], { cwd: dir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })) as string[];
};

/** Shared by pair and merge through runGates. Base files are materialized only inside this lane's var/. */
export const questionsGate = (dir: string, task: Task, base: string): Gate => {
  const name = "no new questions for Aaron";
  // Historical loop fixtures/checkouts without a blueprint do not have a Questions page.
  if (!existsSync(join(dir, "blueprint/index.ts"))) return { name, ok: true, tail: "No blueprint Questions page in this checkout." };
  let snapshot: string | undefined;
  try {
    const baseCommit = git(dir, "rev-parse", "--verify", `${base}^{commit}`);
    mkdirSync(join(dir, "var"), { recursive: true });
    snapshot = mkdtempSync(join(resolve(dir), "var", "questions-base-"));
    const archive = execFileSync("git", ["archive", baseCommit, "blueprint", "packages/blueprint-engine"], { cwd: dir, maxBuffer: 64 * 1024 * 1024 });
    execFileSync("tar", ["-x", "-C", snapshot], { input: archive });
    symlinkSync(resolve(dir, "node_modules"), join(snapshot, "node_modules"), "dir");
    const before = new Set(waiting(snapshot));
    const added = [...new Set(waiting(resolve(dir)))].filter((id) => !before.has(id)).sort();
    const authorized = /^Brings Aaron a question:\s*yes\s*$/im.test(task.goal);
    return { name, ok: added.length === 0 || authorized, tail: added.length === 0 ? "No new for-aaron decisions." : `${authorized ? "Task authorizes" : "Refused:"} new for-aaron decisions: ${added.join(", ")}. Required task line: Brings Aaron a question: yes` };
  } catch (cause) {
    return { name, ok: false, tail: `Cannot compare for-aaron decisions against ${base}: ${String(cause).slice(-1000)}` };
  } finally {
    if (snapshot) rmSync(snapshot, { recursive: true, force: true });
  }
};
