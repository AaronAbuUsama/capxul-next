import { createHash, randomBytes } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { basename, join } from "node:path";

/** The receipt's run directory, set by the eval harness for a run's nested commands; absent outside a run. */
const runDir = (): string | undefined => process.env.CAPXUL_EVAL_RUN_DIR || undefined;

/**
 * One trace per call, in the one format (plugs.trace-format): a W3C trace id, 32 lowercase hex digits. Inside an eval run its
 * first 16 digits are the run's prefix, the first 16 hex digits of sha256 of the receipt id (system.eval-event-checks'
 * runTracePrefix), so a row another run or a snapshot's parent left behind can never match this run's log.
 */
export function mintTrace(): string {
  const run = runDir();
  if (!run) return randomBytes(16).toString("hex");
  return createHash("sha256").update(basename(run)).digest("hex").slice(0, 16) + randomBytes(8).toString("hex");
}

/**
 * Appends `{operation, trace_id, ok}` to `<run>/preparation/operations.jsonl` for a public operation this run drove, with the
 * trace that call actually sent. One line per call; outside an eval run it logs nothing.
 */
export async function logOperation(operation: string, trace: string, ok: boolean): Promise<void> {
  const run = runDir();
  if (!run) return;
  await appendFile(join(run, "preparation", "operations.jsonl"), `${JSON.stringify({ operation, trace_id: trace, ok })}\n`, { mode: 0o600 });
}

/** Runs one public operation under a fresh trace and logs it once, ok or not. */
export async function traced<T>(operation: string, action: (trace: string) => Promise<T>): Promise<T> {
  const trace = mintTrace();
  try { const value = await action(trace); await logOperation(operation, trace, true); return value; }
  catch (error) { await logOperation(operation, trace, false); throw error; }
}
