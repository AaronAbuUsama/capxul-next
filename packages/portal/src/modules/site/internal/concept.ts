/**
 * A concept's page: what it is, its operations with their stands, its machines, tables, events and errors.
 * Each count links to the section that lists what it counts, so a number is never taken on trust.
 */
import { keyOf, type AnyRecord } from "@capxul/blueprint-engine";

import type { ConceptPage, MachineCard, Ref } from "../types.ts";
import { impactBlock } from "./impact.ts";
import { brief, head, membersOf, operationRow, sourceOf, titleOf, type Ctx } from "./context.ts";
import { evalRows, refOf } from "./locate.ts";
import { count, entries, field, list, records, text } from "./values.ts";

const COUNTS: readonly (readonly [string, string])[] = [
  ["operation", "operations"], ["table", "tables"], ["machine", "state machines"], ["rpc", "rpcs"],
  ["flow", "flows"], ["workflow", "workflows"], ["procedure", "procedures"], ["decision", "decisions"],
];
const MORE: readonly (readonly [string, string])[] = [
  ["rpc", "RPCs"], ["flow", "Flows"], ["workflow", "Workflows"], ["procedure", "Procedures"],
  ["invariant", "Invariants"], ["decision", "Decisions"],
];

const stateId = (s: unknown): string => text(s) || text(field(s, "id"));

/** A machine as a strip of states. A state no transition leaves is terminal. */
const machineCard = (m: AnyRecord): MachineCard => {
  const transitions = entries(m["transitions"]);
  const left = new Set(transitions.flatMap(([, t]) => list(field(t, "from")).map(stateId)));
  return {
    ref: refOf(m), title: titleOf(m), transitions: transitions.length,
    states: list(m["states"]).map(stateId).map((id) => ({ id, initial: id === stateId(m["initial"]), terminal: !left.has(id) })),
  };
};

/** Every error the concept's operations, rpcs and procedures can answer with, each once, by id. */
const errorsOf = (ctx: Ctx, id: string): readonly Ref[] => {
  const raising = ["operation", "rpc", "procedure"].flatMap((kind) => membersOf(ctx, id, kind));
  const all = new Map(raising.flatMap((r) => records(r["errors"])).map((e) => [e.id, e] as const));
  return [...all.keys()].toSorted().flatMap((k) => { const e = all.get(k); return e ? [refOf(e)] : []; });
};

export const concept = (ctx: Ctx, c: AnyRecord): ConceptPage => {
  const { direction, concepts, blueprint } = ctx.input;
  return {
    ...head(`concept/${c.id}`, titleOf(c), sourceOf(ctx, c), c), type: "concept", about: text(c["about"]), impact: impactBlock(ctx, keyOf(c)),
    verdict: direction.verdicts[c.id] ?? "none", verdictNote: direction.verdictNote,
    rail: concepts.flatMap((id) => {
      const other = blueprint.records.get(`concept:${id}`);
      return other ? [{ ref: refOf(other), title: titleOf(other), operations: membersOf(ctx, id, "operation").length, active: id === c.id }] : [];
    }),
    counts: COUNTS.map(([kind, name]) => {
      const n = membersOf(ctx, c.id, kind).length;
      return { big: count(n), name, to: n > 0 ? { label: name, page: `concept/${c.id}`, anchor: `${kind}s` } : null };
    }),
    dependsOn: records(c["dependsOn"]).map(refOf),
    operations: membersOf(ctx, c.id, "operation").map((op) => operationRow(ctx, op)),
    machines: membersOf(ctx, c.id, "machine").map(machineCard),
    tables: membersOf(ctx, c.id, "table").map(brief), events: membersOf(ctx, c.id, "event").map(brief),
    errors: errorsOf(ctx, c.id),
    more: MORE.flatMap(([kind, title]) => {
      const items = membersOf(ctx, c.id, kind).map(brief);
      return items.length > 0 ? [{ title, anchor: `${kind}s`, items }] : [];
    }),
    evals: evalRows(ctx.evals.get(keyOf(c)) ?? [], c.id, new Set(), ctx.input.status),
  };
};
