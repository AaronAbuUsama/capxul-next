// Where an operation stands (docs/design/portal.md, "The stand"): what is missing for it, not whether code exists.
// `underOf` finds the records under an operation; `standOf` places it on the climb: specify, decide, build, observe, done.

import type { AnyRecord, Book, Link } from "./build.ts";
import type { EvalDef } from "./evals.ts";
import { passing, verdictOf, type StatusDocument } from "./status.ts";

export type Stand = "specify" | "decide" | "build" | "observe" | "done";
export const STANDS: readonly Stand[] = ["specify", "decide", "build", "observe", "done"];
/** A stand and the rule that placed it, in words. */
export interface StandOf {
  readonly stand: Stand;
  readonly why: string;
}

type Records = Pick<Book, "records" | "links" | "evals" | "problems" | "gaps">;

/** Gap rules that say what an operation could show beyond its design (an example, telemetry). They are counted beside
 * the stand, never in it: a missing example must not move an operation back from build. */
export const STAND_IGNORES: readonly string[] = ["no-example", "no-span", "state-change-without-event"];

/** The fields followed from each kind of record. Concepts, components, the system, environments, decisions,
 * admissions and waits are not followed. */
const FOLLOW: Readonly<Record<string, ReadonlySet<string>>> = {
  operation: new Set(["implementedBy", "errors", "refusals"]),
  flow: new Set(["steps", "errors", "calls"]),
  rpc: new Set(["reads", "writes", "drives", "invokes", "calls", "chain", "errors"]),
  procedure: new Set(["reads", "writes", "drives", "invokes", "calls", "chain", "errors"]),
  workflow: new Set(["reads", "writes", "drives", "invokes", "calls", "chain", "errors"]),
};

export interface Under {
  /** The operation itself, what implements it and, for a flow, its step rpcs. */
  readonly own: readonly string[];
  /** Everything reached by the rules, the own records included, the operation too. */
  readonly under: readonly string[];
}

const index = new WeakMap<object, ReadonlyMap<string, readonly Link[]>>();
const fromOf = (b: Pick<Book, "links">): ReadonlyMap<string, readonly Link[]> => {
  const known = index.get(b.links);
  if (known) return known;
  const made = new Map<string, Link[]>();
  for (const l of b.links) made.set(l.from, [...(made.get(l.from) ?? []), l]);
  index.set(b.links, made);
  return made;
};

/** The records a record leads to by the rules: its followed fields; a transition's machine and that machine's table;
 * a call's integration; a function's contract. */
const nextOf = (b: Records, key: string): string[] => {
  const r = b.records.get(key);
  if (!r) return [];
  if (r._kind === "transition") {
    const machine = `machine:${String(r.machine)}`;
    const table = b.records.get(machine)?.table as AnyRecord | undefined;
    return [machine, ...(table ? [`table:${table.id}`] : [])];
  }
  if (r._kind === "call") return [`integration:${String(r.integration)}`];
  if (r._kind === "function") return [`contract:${String(r.contract)}`];
  const fields = FOLLOW[r._kind];
  return fields ? (fromOf(b).get(key) ?? []).filter((l) => fields.has(l.field)).map((l) => l.to) : [];
};

const reach = (b: Records, starts: readonly string[], seen: Set<string>): void => {
  const todo = [...starts];
  for (let k = todo.pop(); k !== undefined; k = todo.pop()) {
    if (seen.has(k)) continue;
    seen.add(k);
    todo.push(...nextOf(b, k));
  }
};

/**
 * The records under an operation, reached from it by the rules, then one hop further: the durable processes its
 * records start (`trigger`) or resume (`signals`), with their own records followed by the same rules.
 */
export const underOf = (b: Records, op: AnyRecord): Under => {
  const key = `${op._kind}:${op.id}`;
  const seen = new Set<string>();
  reach(b, [key], seen);
  const impl = op.implementedBy as AnyRecord | undefined;
  const implKey = impl ? `${impl._kind}:${impl.id}` : "";
  const own = [key, ...(implKey ? [implKey] : []),
    ...(implKey ? (fromOf(b).get(implKey) ?? []).filter((l) => l.field === "steps" && l.to.startsWith("rpc:")).map((l) => l.to) : [])];
  const processes = b.links.filter((l) => (l.field === "trigger" || l.field === "signals") && l.from.startsWith("workflow:") && seen.has(l.to)).map((l) => l.from);
  reach(b, processes, seen);
  return { own: [...new Set(own)], under: [...seen] };
};

export interface StandOptions {
  /** True when a decision waits for an answer (the book's one predicate; `review.state` does not exist yet). */
  readonly waits: (decision: AnyRecord) => boolean;
  /** The status document; null when nothing has run. */
  readonly status?: StatusDocument | null;
}

/** The evals of an operation: those on the operation itself, and those on the records under it. */
export const evalsUnder = (b: Records, op: AnyRecord): { readonly own: readonly EvalDef[]; readonly under: readonly EvalDef[] } => {
  const { own, under } = underOf(b, op);
  const ownSet = new Set(own.slice(0, 1));
  const underSet = new Set(under);
  return { own: b.evals.filter((e) => ownSet.has(e.subject)), under: b.evals.filter((e) => underSet.has(e.subject) && !ownSet.has(e.subject)) };
};

const isLive = (id: string, op: AnyRecord): boolean => id.startsWith("live:") && id.endsWith(`:${op.id}`);

/** The first row that matches. A waiting judgment further under the operation is shown on its page, not as its stand. */
export const standOf = (b: Records, op: AnyRecord, options: StandOptions): StandOf => {
  const status = options.status ?? null;
  const { own, under } = underOf(b, op);
  for (const key of under) {
    const found = [...b.problems.filter((p) => p.record === key), ...b.gaps.filter((g) => g.record === key && !STAND_IGNORES.includes(g.rule))][0];
    if (found) return { stand: "specify", why: `${key}: ${found.rule}, ${String(found.detail)}` };
  }
  const ownSet = new Set(own);
  for (const l of b.links) {
    if (l.field !== "affects" || !l.from.startsWith("decision:") || !ownSet.has(l.to)) continue;
    const decision = b.records.get(l.from);
    if (decision && options.waits(decision)) return { stand: "decide", why: `decision ${decision.id} waits for an answer` };
  }
  const underSet = new Set(under);
  const l1 = b.evals.filter((e) => e.level === "L1" && underSet.has(e.subject)).map((e) => e.id);
  const missing = l1.filter((id) => verdictOf(status, id) !== "pass");
  if (missing.length > 0)
    return {
      stand: "build",
      why: status === null
        ? "specified and decided; no eval has run against real code yet"
        : `specified and decided; ${passing(status, l1)} of ${l1.length} L1 evals pass, ${missing.length} do not (first: ${missing[0]})`,
    };
  const live = b.evals.filter((e) => isLive(e.id, op)).map((e) => e.id);
  if (live.length > 0 && passing(status, live) === live.length) return { stand: "done", why: `every L1 eval passes and its ${live.length} live evals hold` };
  return {
    stand: "observe",
    why: live.length === 0 ? "every L1 eval passes; no live eval is defined for it yet" : `every L1 eval passes; ${passing(status, live)} of ${live.length} live evals hold`,
  };
};
