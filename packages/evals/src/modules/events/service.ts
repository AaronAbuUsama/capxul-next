// evt:<operation>/<event> judged from this run's logged invocations and its outbox (system.eval-event-checks).
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { eventPropsErrors, type Blueprint } from "@capxul/blueprint-engine";

export interface EventCheck { readonly id: string; readonly name: string; readonly operation: string; readonly event: string }
export interface Invocation { readonly operation: string; readonly trace_id: string; readonly ok: boolean; readonly file: string }
/** An app.transition_outbox envelope (packages/backend/src/platform/outbox.ts TransitionEvent). */
export interface Envelope {
  readonly id: string; readonly name: string; readonly machine: string; readonly entity_id: string;
  readonly owner_kind: string | null; readonly owner_id: string | null; readonly actor: string | null;
  readonly trace_id: string; readonly at: number; readonly props: unknown;
}
export interface EventJudgement {
  readonly pass: boolean; readonly detail: string;
  readonly invocations: readonly Invocation[]; readonly envelopes: readonly Envelope[]; readonly invalid: readonly { id: string; errors: readonly string[] }[];
}

/** One check per requested evt eval, named from the blueprint, never from an implementation. */
export const eventChecks = (b: Pick<Blueprint, "evals">, ids: readonly string[]): EventCheck[] =>
  ids.flatMap((id) => {
    const m = /^evt:([^/]+)\/([^/]+)$/.exec(id);
    return m && b.evals.some((e) => e.id === id) ? [{ id, name: `EVENTS.${m[1]}.${m[2]}`, operation: m[1]!, event: m[2]! }] : [];
  });

/** A run's W3C trace ids begin with these 16 hex digits, the start of sha256(run id); the other 16 are random per call. */
export const runTracePrefix = (runId: string): string => createHash("sha256").update(runId).digest("hex").slice(0, 16);

/** Every <run>/<module>/operations.jsonl line; a log that is a link, empty or older than the run, a malformed line or a trace
 * not minted for the run (runTracePrefix) is an error, not evidence. */
export const readInvocations = (run: string, since: number, runId: string): { invocations: Invocation[]; errors: string[] } => {
  const invocations: Invocation[] = [], errors: string[] = [];
  for (const entry of readdirSync(run, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const file = join(run, entry, "operations.jsonl");
    if (!existsSync(file)) continue;
    const stat = statSync(file);
    if (lstatSync(file).isSymbolicLink() || !stat.isFile() || stat.size === 0 || stat.mtimeMs < since) { errors.push(`${entry}/operations.jsonl is a link, empty or older than this run`); continue; }
    for (const [i, line] of readFileSync(file, "utf8").split("\n").entries()) {
      if (!line.trim()) continue;
      let row: { operation?: unknown; trace_id?: unknown; ok?: unknown };
      try { row = JSON.parse(line) as typeof row; } catch { errors.push(`${entry}/operations.jsonl:${i + 1} is not JSON`); continue; }
      if (typeof row.operation !== "string" || !row.operation || typeof row.trace_id !== "string" || !row.trace_id || typeof row.ok !== "boolean")
        errors.push(`${entry}/operations.jsonl:${i + 1} needs {operation, trace_id, ok}`);
      // A trace not minted for this run could match a row an earlier run, or a snapshot's parent world, left in the outbox.
      else if (!row.trace_id.startsWith(runTracePrefix(runId)) || !/^[0-9a-f]{32}$/.test(row.trace_id))
        errors.push(`${entry}/operations.jsonl:${i + 1} trace ${row.trace_id} is not a W3C trace id of run ${runId}`);
      else invocations.push({ operation: row.operation, trace_id: row.trace_id, ok: row.ok, file: `${entry}/operations.jsonl` });
    }
  }
  return { invocations, errors };
};

/** The machines whose transitions emit the event, by id, as the envelope's `machine` names them. */
const machinesOf = (b: Pick<Blueprint, "records">, event: string): string[] =>
  [...b.records].flatMap(([key, r]) => key.startsWith("machine:") &&
    Object.values((r as { transitions?: Record<string, { emits?: readonly { id: string }[] }> }).transitions ?? {}).some((t) => t.emits?.some((e) => e.id === event))
    ? [key.slice("machine:".length)] : []);

// trace_id needs no check here: an envelope is matched to a call only through its trace.
const envelopeErrors = (e: Envelope, machines: readonly string[]): string[] => [
  ...(!e.id || !e.machine || !e.entity_id ? ["id, machine and entity_id are required"] : []),
  ...(e.machine && !machines.includes(e.machine) ? [`machine ${e.machine} does not emit it (${machines.join(", ") || "no machine"})`] : []),
  ...(!Number.isSafeInteger(e.at) || e.at < 0 ? ["at is not a non-negative integer"] : []),
  ...((e.owner_kind === null) !== (e.owner_id === null) ? ["owner_kind and owner_id must both be set or both be null"] : []),
];

/** Passes when a successful logged call of the operation sent the event under a trace no other call shares, the logs had
 * no errors, and every such envelope is valid. */
export const judgeEvent = (b: Pick<Blueprint, "records">, check: EventCheck, logged: readonly Invocation[], outbox: readonly Envelope[],
  logErrors: readonly string[] = []): EventJudgement => {
  const invocations = logged.filter((i) => i.operation === check.operation && i.ok);
  const shared = [...new Set(invocations.map((i) => i.trace_id))].filter((t) => logged.filter((i) => i.trace_id === t).length > 1);
  const machines = machinesOf(b, check.event);
  const traces = new Set(invocations.map((i) => i.trace_id));
  const envelopes = outbox.filter((e) => e.name === check.event && traces.has(e.trace_id));
  const invalid = envelopes.flatMap((e) => {
    const errors = [...envelopeErrors(e, machines), ...eventPropsErrors(b, check.event, e.props)];
    return errors.length ? [{ id: e.id, errors }] : [];
  });
  const fail = (detail: string): EventJudgement => ({ pass: false, detail, invocations, envelopes, invalid });
  if (logErrors.length) return fail(`the run's operation logs have errors: ${logErrors.join("; ").slice(0, 300)}`);
  if (!invocations.length) return fail(`no successful ${check.operation} call was logged in this run`);
  if (shared.length) return fail(`${shared.length} ${check.operation} traces are logged by more than one call: ${shared.join(", ").slice(0, 200)}`);
  if (!envelopes.length) return fail(`${invocations.length} logged ${check.operation} calls sent no ${check.event} under their traces`);
  if (invalid.length) return fail(`${invalid.length} of ${envelopes.length} ${check.event} envelopes are invalid: ${invalid[0]!.errors.join("; ").slice(0, 300)}`);
  return { pass: true, detail: `${envelopes.length} valid ${check.event} envelopes from ${traces.size} logged ${check.operation} traces`, invocations, envelopes, invalid };
};
