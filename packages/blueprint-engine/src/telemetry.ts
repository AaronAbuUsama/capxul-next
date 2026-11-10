// Telemetry an operation carries, derived from the blueprint: which events it sends and through which transition,
// which spans it names. Nothing here is written by hand; a gap rule turns silence into a finding.

import type { AnyRecord, Blueprint, Finding } from "./build.ts";

type Records = Pick<Blueprint, "records">;
const key = (r: { _kind: string; id: string }) => `${r._kind}:${r.id}`;
const list = (u: unknown): AnyRecord[] => (Array.isArray(u) ? (u as AnyRecord[]) : []);

/** One event an operation sends: the transition that sends it (null for an event a record sends itself) and the
 * rpc or procedure that drives the transition. */
export interface EventSent {
  readonly event: string;
  readonly transition: string | null;
  readonly by: string;
}
/** One span an operation names, and the record that names it. */
export interface SpanNamed {
  readonly span: string;
  readonly by: string;
}

/** The implementing flow or rpc, a flow's step rpcs, and every procedure any of them invokes: the code an operation runs. */
export const implementationOf = (b: Records, op: AnyRecord): AnyRecord[] => {
  const out = new Map<string, AnyRecord>();
  const visit = (link: unknown): void => {
    if (typeof link !== "object" || link === null) return;
    const k = key(link as AnyRecord);
    const r = b.records.get(k);
    if (!r || out.has(k)) return;
    out.set(k, r);
    for (const s of list(r.steps)) visit((s as { rpc?: unknown }).rpc);
    for (const p of list(r.invokes)) visit(p);
  };
  visit(op.implementedBy);
  return [...out.values()];
};

/** The transitions an operation drives, through its implementation. */
export const transitionsDriven = (b: Records, op: AnyRecord): string[] => [
  ...new Set(implementationOf(b, op).flatMap((r) => list(r.drives).map(key))),
];

const emitsOf = (b: Records, transition: string): AnyRecord[] => {
  const t = b.records.get(transition);
  const machine = b.records.get(`machine:${String(t?.machine)}`);
  const entry = (machine?.transitions as Record<string, { emits?: AnyRecord[] }> | undefined)?.[String(t?.name)];
  return list(entry?.emits);
};

/** The events an operation sends and how: one row per event and transition, in the order the implementation lists them. */
export const eventsSent = (b: Records, op: AnyRecord): EventSent[] => {
  const rows = new Map<string, EventSent>();
  const add = (e: EventSent) => rows.set(`${e.event}|${e.transition ?? ""}|${e.by}`, e);
  for (const r of implementationOf(b, op)) {
    for (const e of list(r.emits)) add({ event: key(e), transition: null, by: key(r) });
    for (const t of list(r.drives)) for (const e of emitsOf(b, key(t))) add({ event: key(e), transition: key(t), by: key(r) });
  }
  return [...rows.values()];
};

/** The spans an operation names: its flow's, and every rpc's under it. */
export const spansNamed = (b: Records, op: AnyRecord): SpanNamed[] =>
  implementationOf(b, op).flatMap((r) => ((r.spans as string[] | undefined) ?? []).map((span) => ({ span, by: key(r) })));

/** The ids of the gap rules that count telemetry, so a view can total them apart from the others. */
export const TELEMETRY_RULES = ["no-span", "state-change-without-event"] as const;

/** An operation names no span, and one that changes state sends no event. Gaps, never problems. */
export const telemetryGaps = (b: Records, operations: readonly AnyRecord[]): Finding[] =>
  operations.flatMap((op) => {
    const found: Finding[] = [];
    const at = key(op);
    if (spansNamed(b, op).length === 0)
      found.push({ record: at, rule: "no-span", detail: "neither its flow nor any rpc it runs names a span, so its trace has nothing declared to check" });
    const driven = transitionsDriven(b, op);
    if (driven.length > 0 && eventsSent(b, op).length === 0)
      found.push({ record: at, rule: "state-change-without-event", detail: `it drives ${driven.join(", ")} but no event is sent` });
    return found;
  });
