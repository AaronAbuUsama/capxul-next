/**
 * CAPXUL-SPECIFIC. How this repository's work is read and judged: tasks from the plan, the checks of CLAUDE.md, the role
 * definitions in `.claude/agents/`, the hand-back and check shapes of docs/design/swarm-templates.md. Everything here
 * reaches the repository through commands and files, never through imports.
 */
import type { Models } from "@earendil-works/pi-ai";
import type { Evidence, Exec, Tooling } from "../evidence/types.ts";
import type { Lane } from "../lanes/service.ts";
import type { Run } from "../runs/service.ts";

export type SandboxKind = "none" | "light" | "heavy";

/** What a person chose on the command line; the script reads it as `job.opts`. */
export interface Opts {
  readonly script: string;
  /** `provider/id` of the maker (and the researcher); the owner's pi default when absent. */
  readonly model?: string;
  /** `provider/id` of the checkers; the maker's when absent. */
  readonly checkerModel?: string;
  readonly sandbox: SandboxKind;
  readonly rounds: number;
  readonly budgetUsd: number;
  readonly timeoutMin: number;
  readonly checkers?: readonly string[];
}

/** The environment, the clock and the voice, handed in by `main.ts`: nothing else here reads the process. */
export interface Ctx {
  readonly root: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: () => Date;
  readonly say: (line: string) => void;
  /** Tests hand in a fake provider's models. */
  readonly models?: Models;
  /** Tests hand in short waits; absent, pi retries a request 3 times and the loop then waits 20 s, 60 s and 3 min for the gateway. */
  readonly retry?: { readonly maxRetries: number; readonly baseDelayMs: number; readonly waitsMs: readonly number[] };
  /** Tests hand in the capture programs and how they are run; absent, what this machine's `PATH` holds (modules/evidence). */
  readonly evidence?: { readonly tooling: Tooling; readonly exec: Exec };
  /** Tests hand in the gates to run; absent, the repository's own (internal/gates.ts). */
  readonly gates?: readonly { name: string; sh: string }[];
}

/** A task as a loop sees it: from `plan/tasks/<id>.md` and the plan, or an entry of docs/mission/tasks.json. */
export interface Task {
  readonly id: string;
  readonly source: "plan" | "derived";
  readonly title: string;
  readonly goal: string;
  readonly evals: readonly string[];
  readonly checkers: readonly string[];
  readonly paths: readonly string[];
  readonly budgetUsd?: number;
}

export interface SandboxInfo { readonly kind: SandboxKind; readonly env: Readonly<Record<string, string>>; readonly port?: number; readonly pid?: number; readonly world?: string }

/** What a script is handed: the run, the task, the options, and (once made) its lane and sandbox. */
export interface Job { readonly ctx: Ctx; readonly run: Run; /** What the agents' commands see: filled in by `sandbox`. */ readonly env: Record<string, string>; readonly task: Task; readonly opts: Opts; lane?: Lane; box?: SandboxInfo }

export interface Finding { id?: string; check?: string; severity: "blocking" | "advisory"; where?: { path: string; line?: number }; text: string }
export interface Handover { done: string[]; left: string[]; decisions: string[]; where: string[] }
/** swarm-templates.md section 3 (the pull request is the runner's push, so `pr` is 0). */
export interface Handback { /** What it shows for what it says: claims about captures it made (modules/evidence). */ evidence?: Evidence[]; submit?: { version: { kind: "commit"; repo: string; commit: string }; addresses: string[]; note: string }; pr?: number; handover?: Handover; ran?: Record<string, number>; ask?: { to: "manager"; text: string; options?: string[] } }
/** swarm-templates.md section 4.1. */
export interface Check { /** What the checker shows for its verdict: claims about captures it made. */ evidence?: Evidence[]; version?: { kind: "commit"; repo: string; commit: string }; verdict: "approve" | "changes"; findings: Finding[]; fixed: string[]; ran?: Record<string, number>; verdicts?: unknown[] }
export interface Gate { name: string; ok: boolean; tail: string }
/** What an agent step returned (kept in the run's ledger). */
export interface Said { ok: boolean; text: string; json?: unknown; costUsd: number; tokens: number; head: string; error?: string }
