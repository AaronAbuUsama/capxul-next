/**
 * GENERIC. A run is a folder: `run.sqlite` (the pi-durable storage: the ledger of steps and every agent's conversation, the
 * only source of truth) and `status.json` (a small index derived from it, so listing runs never opens a database).
 */
import type { Host } from "../agents/service.ts";

export type Status = "running" | "ready" | "answered" | "blocked" | "failed" | "stopped" | "merged";
/** Statuses a run does not leave by itself (`resume` can still move failed and stopped). */
export const SETTLED: readonly Status[] = ["ready", "answered", "blocked", "merged"];

export interface Info {
  id: string;
  subject: string;
  status: Status;
  step: string | null;
  round: number;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  pid: number;
  spentUsd: number;
  tokens: number;
  reasons: string[];
  error?: string;
  /** Whatever the caller wants listed with the run (a branch, a sandbox), as JSON. */
  extra: Record<string, unknown>;
}

export interface Run {
  readonly id: string;
  readonly dir: string;
  readonly host: Host;
  readonly info: Info;
  readonly stopFile: string;
  /** Runs `fn` once under `name`: a replay after a restart answers from the ledger and does not run it. */
  step<T>(name: string, fn: () => Promise<T>): Promise<T>;
  /** Ends the run with a verdict. */
  end(status: "ready" | "answered" | "blocked", reasons: string[]): Promise<void>;
  save(): Promise<void>;
}
export type Script = (run: Run) => Promise<void>;
