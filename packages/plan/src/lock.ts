/**
 * One writer at a time. Two loop runs started together both ran `plan task start` within 26 ms (11 November 2026); each
 * read plan/plan.json, changed it and wrote it back, and one start was lost. The lock is a directory, made atomically by
 * mkdir; a holder that died leaves it behind, so a lock older than `staleMs` is taken over.
 */
import { mkdirSync, rmSync, statSync } from "node:fs";

export interface LockOptions {
  readonly waitMs?: number;
  readonly staleMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => void;
}

export type Locked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

const pause = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

const take = (path: string): boolean => {
  try { mkdirSync(path); return true; } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw cause;
  }
};

const ageOf = (path: string, now: number): number => { try { return now - statSync(path).mtimeMs; } catch { return 0; } };

/** Runs `work` while holding the lock at `path`; the lock is released however `work` ends. */
export const withLock = <T>(path: string, work: () => T, o: LockOptions = {}): Locked<T> => {
  const now = o.now ?? Date.now, sleep = o.sleep ?? pause, waitMs = o.waitMs ?? 10_000, staleMs = o.staleMs ?? 30_000;
  const until = now() + waitMs;
  while (!take(path)) {
    if (ageOf(path, now()) > staleMs) { rmSync(path, { recursive: true, force: true }); continue; }
    if (now() >= until) return { ok: false, error: `${path} is held by another plan command (waited ${waitMs} ms); if none is running, remove it` };
    sleep(25);
  }
  try { return { ok: true, value: work() }; } finally { rmSync(path, { recursive: true, force: true }); }
};
