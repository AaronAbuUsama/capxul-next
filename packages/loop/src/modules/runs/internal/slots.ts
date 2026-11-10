/**
 * At most `max` holders at a time, across every process that shares a folder. A holder is a file named for its slot
 * that holds the holder's process id; a holder whose process is gone gives its slot back. Used to keep the number of
 * agents working at once within what the model gateway can carry, however many runs and processes there are.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return pid > 0; } catch { return false; } };

/** Takes a slot now, or returns undefined when all are held. The result gives the slot back. */
export const tryAcquire = (dir: string, max: number): (() => void) | undefined => {
  mkdirSync(dir, { recursive: true });
  for (let n = 0; n < max; n++) {
    const file = join(dir, `slot-${n}`);
    for (let again = 0; again < 2; again++) {
      try { writeFileSync(file, String(process.pid), { flag: "wx" }); return () => rmSync(file, { force: true }); }
      catch {
        let pid = 0;
        try { pid = Number(readFileSync(file, "utf8")); } catch { /* it went away: take it on the second pass */ }
        if (alive(pid)) break;
        rmSync(file, { force: true });                                    // its holder died: the slot is free
      }
    }
  }
  return undefined;
};

/** Waits for a slot. `waiting` is called once if there is none at first; `stopped` ends the wait with an error. */
export const acquire = async (dir: string, max: number, o: { stopped?: () => boolean; waiting?: () => void; pollMs?: number } = {}): Promise<() => void> => {
  for (let first = true; ; first = false) {
    const release = tryAcquire(dir, max);
    if (release) return release;
    if (first) o.waiting?.();
    if (o.stopped?.()) throw new Error("stopped");
    await new Promise((r) => setTimeout(r, o.pollMs ?? 1000));
  }
};
