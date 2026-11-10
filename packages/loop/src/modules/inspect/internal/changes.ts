/**
 * What changed between two looks at the runs, as one line per event: what `loop watch` prints so the coordinator is
 * woken by runs instead of reading statuses. Pure: two lists of views in, lines out.
 */
import type { RunView } from "../types.ts";

/** A rate the post-mortem of 10 November set as the bar for a healthy run: more than one refused call in twenty. */
const UNHEALTHY = (v: RunView): boolean => v.toolCalls.total >= 20 && v.refused * 20 > v.toolCalls.total;

export const changesOf = (before: readonly RunView[], after: readonly RunView[]): string[] => {
  const was = new Map(before.map((v) => [v.id, v] as const));
  return after.flatMap((v) => {
    const seen = was.get(v.id), out: string[] = [];
    if (!seen) out.push(`${v.id}: started (${v.task})`);
    // a run seen for the first time is compared with a run that has done nothing yet, so what it did before is still said
    const b = seen ?? { ...v, status: "running" as const, refused: 0, failures: 0, superseded: null, toolCalls: { total: 0, byName: {} } };
    if (v.refused > b.refused) out.push(`${v.id}: ${v.refused - b.refused} call${v.refused - b.refused === 1 ? "" : "s"} refused (${v.refused} of ${v.toolCalls.total})`);
    if (UNHEALTHY(v) && !UNHEALTHY(b)) out.push(`${v.id}: unhealthy: more than one call in twenty refused`);
    if (v.failures > b.failures) out.push(`${v.id}: ${v.failures - b.failures} model failure${v.failures - b.failures === 1 ? "" : "s"} (${v.failures} in all)`);
    if (v.status !== b.status) out.push(v.status === "dead" ? `${v.id}: its process is gone (dead)` : b.status === "running" ? `${v.id}: ended ${v.status}${v.why[0] ? `: ${v.why[0]}` : ""}` : `${v.id}: ${b.status} -> ${v.status}`);
    if (v.superseded && !b.superseded) out.push(`${v.id}: superseded: ${v.superseded}`);
    return out;
  });
};
