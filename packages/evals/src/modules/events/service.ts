// evt:<operation>/<event> judged from this run's logged invocations and its outbox (system.eval-event-checks).
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

/** Every <run>/<module>/operations.jsonl line; a log that is a link, empty or older than the run is an error, not evidence. */
export const readInvocations = (run: string, since: number): { invocations: Invocation[]; errors: string[] } => {
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
      else invocations.push({ operation: row.operation, trace_id: row.trace_id, ok: row.ok, file: `${entry}/operations.jsonl` });
    }
  }
  return { invocations, errors };
};

// trace_id needs no check here: an envelope is matched to a call only through its trace.
const envelopeErrors = (e: Envelope): string[] => [
  ...(!e.id || !e.machine || !e.entity_id ? ["id, machine and entity_id are required"] : []),
  ...(!Number.isSafeInteger(e.at) || e.at < 0 ? ["at is not a non-negative integer"] : []),
  ...((e.owner_kind === null) !== (e.owner_id === null) ? ["owner_kind and owner_id must both be set or both be null"] : []),
];

/** Passes when a successful logged call of the operation sent the event under its own trace, and every such envelope is valid. */
export const judgeEvent = (b: Pick<Blueprint, "records">, check: EventCheck, logged: readonly Invocation[], outbox: readonly Envelope[]): EventJudgement => {
  const invocations = logged.filter((i) => i.operation === check.operation && i.ok);
  const traces = new Set(invocations.map((i) => i.trace_id));
  const envelopes = outbox.filter((e) => e.name === check.event && traces.has(e.trace_id));
  const invalid = envelopes.flatMap((e) => {
    const errors = [...envelopeErrors(e), ...eventPropsErrors(b, check.event, e.props)];
    return errors.length ? [{ id: e.id, errors }] : [];
  });
  const fail = (detail: string): EventJudgement => ({ pass: false, detail, invocations, envelopes, invalid });
  if (!invocations.length) return fail(`no successful ${check.operation} call was logged in this run`);
  if (!envelopes.length) return fail(`${invocations.length} logged ${check.operation} calls sent no ${check.event} under their traces`);
  if (invalid.length) return fail(`${invalid.length} of ${envelopes.length} ${check.event} envelopes are invalid: ${invalid[0]!.errors.join("; ").slice(0, 300)}`);
  return { pass: true, detail: `${envelopes.length} valid ${check.event} envelopes from ${traces.size} logged ${check.operation} traces`, invocations, envelopes, invalid };
};
