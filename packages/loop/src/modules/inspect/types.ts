/**
 * What `loop status --json` and `loop show <run> --json` print: one `RunView` per run. Plain data, readable without
 * opening anything: the portal's Live page runs the command and reads this. Nothing here carries file contents, a prompt,
 * a reply or an environment value: tool calls are a name and a short summary, and every free text is scrubbed (README).
 */
import type { Info } from "../runs/types.ts";

export interface EventLine {
  /** ISO time of the entry. */
  readonly at: string;
  /** The agent's name in the run: `make.1`, `reviewer.2.agent`. */
  readonly who: string;
  /** `bash git diff a..b`, `read books/target/x.ts`, `replied`, `model error`. */
  readonly what: string;
}

export interface RunView {
  readonly id: string;
  /** The task the run works on (the plan's task id, or a derived task's key). */
  readonly task: string;
  readonly script: string | null;
  /** The run's own status, except `dead` for a run that says running while its process is gone. */
  readonly status: Info["status"] | "dead";
  readonly step: string | null;
  readonly round: number;
  /** The most rounds the run may take, when it says. */
  readonly rounds: number | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** The newest of: an agent's last entry and the run's own last save. */
  readonly lastEventAt: string;
  /** The model of the maker, and of each checker by role (`reviewer`). Null or absent when that agent has not started. */
  readonly models: { readonly maker: string | null; readonly checkers: Readonly<Record<string, string>> };
  readonly turns: number;
  readonly toolCalls: { readonly total: number; readonly byName: Readonly<Record<string, number>> };
  readonly tokens: { readonly in: number; readonly out: number };
  /** The lane's branch, when the run has a lane. */
  readonly branch: string | null;
  /** The newest events last, as many as were asked for. */
  readonly events: readonly EventLine[];
  /** Why the run is not going on: its reasons or its error, scrubbed and capped. Empty while it is running or ready. */
  readonly why: readonly string[];
  /** False when the run's storage could not be read: the counts are then zero and `why` says so. */
  readonly readable: boolean;
}

/** The longest a summary of one argument, a reason or an event may be, in characters. */
export const CAP = 90;
export const WHY_CAP = 300;
