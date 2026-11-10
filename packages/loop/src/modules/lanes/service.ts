/**
 * GENERIC. A lane is a git worktree on its own branch cut from a base branch: the directory one run's agent works in.
 * It isolates files, nothing more (a worktree is not a security boundary). Plain `git`, run in a directory.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

export interface Lane { readonly dir: string; readonly branch: string; readonly base: string }

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();

/** A task key as a name for branches and folders: `operation:auth.list` becomes `operation-auth.list`. */
export const slug = (id: string): string => id.replace(/[^A-Za-z0-9._-]+/g, "-");

const exists = (cwd: string, ref: string): boolean => { try { git(cwd, "rev-parse", "--verify", "--quiet", ref); return true; } catch { return false; } };

/** Makes the lane `lane/<name>` in `dir` if it is not there (safe to repeat); `install` runs after a fresh checkout. */
export const ensureLane = (repo: string, dir: string, name: string, base: string, install?: (dir: string) => void): Lane => {
  const branch = `lane/${slug(name)}`;
  if (!existsSync(join(dir, ".git"))) {
    if (!exists(repo, base)) throw new Error(`the base branch ${base} does not exist here`);
    try { git(repo, "worktree", "add", ...(exists(repo, branch) ? [dir, branch] : ["-b", branch, dir, base])); }
    catch (cause) { throw new Error(`cannot make the lane ${branch}: ${(cause as { stderr?: string }).stderr ?? cause}. If another run holds it, \`pnpm loop clean <run>\` first.`); }
    install?.(dir);
  }
  return { dir, branch, base };
};

/** Why the lane `lane/<name>` could not be made in `dir` right now, or undefined. Asked before a run claims anything. */
export const laneBlocked = (repo: string, dir: string, name: string, base: string): string | undefined => {
  if (existsSync(join(dir, ".git"))) return undefined;
  if (!exists(repo, base)) return `the base branch ${base} does not exist here`;
  const branch = `lane/${slug(name)}`;
  const held = git(repo, "worktree", "list", "--porcelain").split("\n\n").find((w) => w.split("\n").includes(`branch refs/heads/${branch}`));
  return held ? `${branch} is checked out in ${held.split("\n")[0]!.replace(/^worktree /, "")} (another run holds it; \`pnpm loop clean <run>\` removes a finished run's lane)` : undefined;
};

export const head = (dir: string): string => git(dir, "rev-parse", "HEAD");
export const dirty = (dir: string): boolean => git(dir, "status", "--porcelain") !== "";

/** Commits whatever is uncommitted, so a checker always reads a commit. Returns the head. */
export const commitAll = (dir: string, message: string): string => {
  if (dirty(dir)) { git(dir, "add", "-A"); git(dir, "commit", "-m", message); }
  return head(dir);
};

export const dropLane = (repo: string, lane: Lane): void => { if (existsSync(lane.dir)) git(repo, "worktree", "remove", "--force", lane.dir); };

/** Brings the base into the lane. Returns false, and leaves the lane as it was, when they conflict. */
export const catchUp = (lane: Lane): boolean => {
  try { git(lane.dir, "merge", "--no-edit", lane.base); return true; }
  catch { try { git(lane.dir, "merge", "--abort"); } catch { /* nothing to abort */ } return false; }
};

/** A port nobody is listening on right now. Asked of the system, never assumed. */
export const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = createServer();
  s.once("error", reject);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); });
});
