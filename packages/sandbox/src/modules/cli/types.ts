/**
 * The `pnpm sandbox` command line: argv in, a result out. It prints nothing and exits nothing itself (`src/main.ts`
 * does); a command's streamed output goes through `write`, so the whole CLI runs in a test.
 *
 *   up <name> [--dir <checkout>] [--branch <b>] [--owner <who>] [--ttl 2h]   start a box (and put a checkout's commits in it)
 *   exec <name> [--cwd <dir>] -- <command…>                                    run a command in it; its exit code is the CLI's
 *   push <name> <checkout> [--branch <b>]                                      make the box's copy of the checkout match it
 *   pull <name> <checkout> [--branch <b>] [--message <m>]                      commit in the box, bring the commits back
 *   ls [--json]                                                                every box: owner, age, expiry, running
 *   down <name>… | --owner <who> | --all                                       destroy boxes
 *   reap [--dry-run]                                                           destroy what is past its expiry or not running
 */
import type { Launcher } from "../box/types.ts";

export interface CliDeps {
  readonly launcher: Launcher;
  readonly now: () => Date;
  /** A command's output as it arrives (exec). */
  readonly write: (text: string) => void;
}

/** What the command came to: an exit code and the lines to print (stdout when `code` is 0, stderr otherwise). */
export interface CliResult { readonly code: number; readonly lines: readonly string[] }

/** Two hours: long enough for a run's rounds, short enough that a forgotten box costs little. */
export const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;
