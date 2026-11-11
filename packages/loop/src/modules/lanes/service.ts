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

/**
 * Pushes `branch`, trying again after 2, 4, 8 and 16 seconds when the remote fails. One "remote rejected (failed)" from
 * GitHub threw away a run that every gate and its reviewer had passed (m1-gaps-dev-stand-11110802, 11 November 2026).
 */
export const pushBranch = async (cwd: string, branch: string, wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms))): Promise<void> => {
  for (const ms of [2_000, 4_000, 8_000, 16_000]) {
    try { git(cwd, "push", "-u", "origin", branch); return; } catch { await wait(ms); }
  }
  git(cwd, "push", "-u", "origin", branch);
};

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

/**
 * Removes the lane's worktree and frees its branch name, so the next lane of the same name starts from the base. A
 * branch already merged into its base is deleted. One that is not keeps its work under `keepAs` when a name is given,
 * and stays where it is otherwise.
 */
export const dropLane = (repo: string, lane: Lane, keepAs?: string): string => {
  if (existsSync(lane.dir)) git(repo, "worktree", "remove", "--force", lane.dir);
  try { git(repo, "worktree", "prune"); } catch { /* nothing to prune */ }
  if (!exists(repo, lane.branch)) return "its branch was already gone";
  try { git(repo, "branch", "-d", lane.branch); return `its branch ${lane.branch} was merged and is deleted`; } catch { /* not merged */ }
  if (keepAs === undefined) return `its branch ${lane.branch} is not merged and stays`;
  git(repo, "branch", "-M", lane.branch, keepAs);
  return `its unmerged work is kept as the branch ${keepAs}`;
};

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
