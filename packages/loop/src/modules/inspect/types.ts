/**
 * What `loop status --json` and `loop show <run> --json` print: one `RunView` per run. Plain data, readable without
 * opening anything: the portal's Live page runs the command and reads this. Nothing here carries file contents, a prompt,
 * a reply or an environment value: tool calls are a name and a short summary, and every free text is scrubbed (README).
 */

/** A run's status as a reader sees it: the run's own (runs/types.ts, `Status`), or `dead` when it says running and its process is gone. */
export type RunStatus = "running" | "ready" | "answered" | "blocked" | "failed" | "stopped" | "merged" | "dead";

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
  readonly status: RunStatus;
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

/** A tool call an agent made: the tool and its arguments, each argument scrubbed and cut. */
export interface Call { readonly id: string; readonly name: string; readonly args: Readonly<Record<string, string | number | boolean>> }
/** One entry of an agent's conversation: what it was told, what it said (with its tool calls), or what a tool answered. */
export interface Entry {
  readonly id: number;
  readonly role: "user" | "assistant" | "tool";
  /** Milliseconds since the epoch, or null when the entry carries no time. */
  readonly at: number | null;
  readonly text: string;
  /** A user entry that is not the workflow's prompt: a note a person sent. */
  readonly note?: boolean;
  readonly thinking?: string;
  readonly calls?: readonly Call[];
  readonly error?: string | null;
  readonly callId?: string;
  readonly name?: string;
  readonly isError?: boolean;
  /** The loop's policy refused this call: `text` says why. */
  readonly refused?: boolean;
  readonly durationMs?: number | null;
}
export interface AgentUsage { turns: number; tools: Record<string, number>; refused: number; errors: number; tokensIn: number; tokensOut: number }
/** An agent's durable conversation in a run, addressed as run plus `key` (`make.1`, `reviewer.1.agent`). */
export interface AgentSession {
  readonly key: string;
  readonly role: string;
  readonly model: string | null;
  readonly tools: readonly string[];
  readonly instructions: string;
  readonly state: "working" | "failed" | "done";
  readonly failure: { readonly reason: string; readonly detail: string } | null;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly usage: AgentUsage;
  readonly messages: readonly Entry[];
}
/** What a builder's commit changed: its subject, the files, and the start of the diff. */
export interface Changes { readonly commit: string; readonly subject: string; readonly stat: string; readonly diff: string }
/** A step of the run as the ledger holds it, with what it left behind. */
export interface StepRecord {
  name: string;
  state: "running" | "done";
  checks?: { name: string; ok: boolean; tail: string }[];
  review?: { verdict: string; findings: unknown[]; fixed: string[] };
  said?: { ok: boolean; error: string | null; head: string; tokens: number; json: unknown };
  changes?: Changes | null;
  result?: unknown;
  end?: string;
  reasons?: string[];
}
/** One run in full: `loop show <run> --json --full`, and what the host serves to a page. */
export interface RunDetail {
  readonly id: string;
  readonly task: { readonly id: string; readonly title: string; readonly goal: string };
  readonly workflow: string;
  readonly status: RunStatus;
  readonly round: number;
  readonly rounds: number | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly updatedAt: string;
  readonly tokens: number;
  readonly branch: string | null;
  readonly base: string | null;
  readonly reasons: readonly string[];
  readonly error: string | null;
  readonly step: string | null;
  readonly steps: readonly StepRecord[];
  readonly agents: readonly AgentSession[];
}

/** The longest a summary of one argument, a reason or an event may be, in characters. */
export const CAP = 90;
export const WHY_CAP = 300;
