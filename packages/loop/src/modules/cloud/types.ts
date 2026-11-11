/**
 * GENERIC. A box: one container a run's agents work in, off this machine. The orchestrator (the process that plays the
 * run, with its ledger and its model calls) stays here; every file an agent reads or writes and every command it or a
 * gate runs happens in the box.
 *
 * Inside the box a small server (`src/bin/box.ts`) holds pi-durable's own `NodeExecutionEnv` and answers over HTTP. Here,
 * `boxEnv` is an `ExecutionEnv` whose every call goes to that server, so pi-durable's coding tools work unchanged: they
 * do not know the files are elsewhere. The lane sits in the box at the same absolute path it has here, so paths an agent
 * sees, the confinement and the prompts are the same in both places.
 *
 * The lane travels as git: `push` sends the commits the box lacks as a bundle, `pull` commits what the box has and
 * brings those commits back into the lane here, which stays the copy the Runs page, the merge and the push read.
 */
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";

/** Where a box answers, and what proves the caller may talk to it. The headers carry the key; they are never stored. */
export interface Link { readonly url: string; readonly headers: Readonly<Record<string, string>> }

/** How a command run to its end in the box went: its exit code (null when it was killed) and the tail of what it printed. */
export interface Ran { readonly code: number | null; readonly out: string; readonly timedOut: boolean; readonly stopped: boolean }

export interface RunOptions {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  /** Polled every second; when it answers true the command is killed. */
  readonly stopped?: () => boolean;
  /** Every chunk of output as it arrives. */
  readonly onOutput?: (text: string) => void;
}

/** What the box says about itself: the commit its image holds (bundles are cut from it) and its programs' versions. */
export interface BoxInfo { readonly commit: string; readonly repo: string; readonly node: string }

/** A failure of the box itself (it is gone, it refused, the network failed), as a value. */
export interface BoxError { readonly kind: "box"; readonly message: string }
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: BoxError };

/** One box, reached through its link. */
export interface Box {
  readonly link: Link;
  info(): Promise<Result<BoxInfo>>;
  /** An execution environment rooted at `cwd` in the box, for pi-durable's tools; its commands see `vars` and nothing inherited. */
  env(cwd: string, vars?: Readonly<Record<string, string>>): ExecutionEnv;
  /** Runs one command to its end (a gate, a setup script), as `sh -c` when it is a string. */
  run(command: string | readonly string[], o: RunOptions): Promise<Ran>;
  /** Makes the lane `dir` (on `branch`) in the box hold what the lane `dir` here holds, committed. */
  push(dir: string, branch: string): Promise<Result<string>>;
  /** Commits what the box's lane has (with `message`), brings the commits back into the lane here, returns the head. */
  pull(dir: string, branch: string, message: string): Promise<Result<string>>;
  /** Undoes what is uncommitted in the box's lane; returns what was undone, as `git status --porcelain` lines. */
  restore(dir: string): Promise<Result<string[]>>;
}

/** Starts and stops boxes: a Cloudflare container through the Worker, or a local Docker container of the same image. */
export interface Launcher {
  readonly name: "cloudflare" | "docker";
  /** A box for this run, started or found again (safe to repeat). */
  start(id: string): Promise<Result<Link>>;
  /** Removes it. Never fails: a box that is already gone is the goal. */
  stop(id: string): Promise<void>;
}
