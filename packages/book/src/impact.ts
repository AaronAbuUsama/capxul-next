// What depends on a record. A pure function over a built book; tools/impact.ts and the portal both call it.
//
// "A depends on B" means A names B: every link `{from: A, to: B}` in the book is one dependency, read backwards.
// An operation names the flow that implements it; a flow names its rpcs; an rpc names the tables, procedures, calls,
// errors and transitions it uses; a journey names its operations. Three additions make the child records of a
// parent (a machine's transitions, an integration's calls, a contract's functions) behave as records of their own:
//   - a child depends on its parent (a transition on its machine, a call on its integration);
//   - a child depends on what its own entry names (a transition on the events it emits, a call on the errors it
//     fails with);
//   - a parent that merely lists those entries does not pass a change on to its other children, so changing one
//     event does not reach every transition of the machine that sends it.
// Decisions are kept out of the graph. A decision affects what it names, so it is listed apart: those that name the
// subject, and those that name a record that depends on it. A decision subject's impact is what it names, and what
// depends on that.

import { Schema } from "effect";
import { KINDS, type Kind } from "./records/base.ts";
import type { AnyRecord, Book } from "./build.ts";

type Records = Pick<Book, "records" | "links" | "evals">;

/** One record that depends on the subject. `field` is the field of `via` that links it; `via` is the record one step
 * nearer the subject (the subject itself at distance 1). */
export interface Dependent {
  readonly key: string;
  readonly kind: string;
  readonly field: string;
  readonly via: string;
  readonly distance: number;
}

export interface Impact {
  readonly subject: string;
  /** The deepest distance followed, or null for no limit. */
  readonly depth: number | null;
  /** Nearest first, then by key. Decisions are never in it. */
  readonly dependents: readonly Dependent[];
  readonly byKind: Readonly<Record<string, number>>;
  /** Decisions that name the subject, and decisions that name something that depends on it. */
  readonly decisions: { readonly direct: readonly Dependent[]; readonly onDependents: readonly Dependent[] };
  /** The evals whose subject is the subject or any dependent. */
  readonly evals: readonly { readonly id: string; readonly subject: string }[];
}

interface Edge {
  readonly from: string;
  readonly field: string;
  /** A parent listing its children's references: the dependent is reported, the change goes no further through it. */
  readonly listed: boolean;
}
/** To-key to the edges that point at it. Build it once per book. */
export type ImpactIndex = ReadonlyMap<string, readonly Edge[]>;

const CHILDREN: Readonly<Record<string, readonly (readonly [details: string, held: string])[]>> = {
  machine: [["transitions", "t"]],
  integration: [["calls", "c"]],
  contract: [["functions", "f"], ["events", "e"]],
};

const refsIn = (u: unknown, found: { field: string; to: string }[] = [], field = ""): { field: string; to: string }[] => {
  if (u === null || typeof u !== "object" || Schema.isSchema(u)) return found;
  const r = u as { _kind?: unknown; id?: unknown };
  if (typeof r.id === "string" && KINDS.includes(r._kind as Kind)) {
    found.push({ field, to: `${String(r._kind)}:${r.id}` });
    return found;
  }
  for (const [k, v] of Array.isArray(u) ? u.map((x) => ["", x] as const) : Object.entries(u)) refsIn(v, found, field === "" ? k : field);
  return found;
};

/** The dependency edges of a book, once: its links, and the child records' own. */
export const impactIndex = (b: Pick<Book, "records" | "links">): ImpactIndex => {
  const index = new Map<string, Edge[]>();
  const add = (to: string, e: Edge) => index.set(to, [...(index.get(to) ?? []), e]);
  const listed = new Set<string>();
  for (const r of b.records.values())
    for (const [details] of CHILDREN[r._kind] ?? []) listed.add(`${r._kind}:${r.id}|${details}`);
  for (const l of b.links) add(l.to, { from: l.from, field: l.field, listed: listed.has(`${l.from}|${l.field}`) });
  for (const parent of b.records.values())
    for (const [details, held] of CHILDREN[parent._kind] ?? []) {
      const entries = (parent[details] ?? {}) as Record<string, unknown>;
      const children = (parent[held] ?? {}) as Record<string, AnyRecord>;
      for (const [name, child] of Object.entries(children)) {
        const from = `${child._kind}:${child.id}`;
        add(`${parent._kind}:${parent.id}`, { from, field: "of", listed: false });
        for (const ref of refsIn(entries[name])) add(ref.to, { from, field: ref.field, listed: false });
      }
    }
  return index;
};

const kindOf = (key: string): string => key.slice(0, key.indexOf(":"));

/**
 * Every record that depends on `subject`, directly and transitively, within `depth` steps when it is given; the
 * decisions that name any of them; the evals that belong to any of them. Null when the book has no such record.
 */
export const impactOf = (
  b: Records, subject: string, options: { readonly depth?: number; readonly index?: ImpactIndex } = {},
): Impact | null => {
  const subjectRecord = b.records.get(subject);
  if (!subjectRecord) return null;
  const index = options.index ?? impactIndex(b);
  const limit = options.depth ?? Number.POSITIVE_INFINITY;
  const found = new Map<string, Dependent>();
  const expanded = new Set<string>();
  let queue: { key: string; distance: number }[] = [];
  if (subjectRecord._kind === "decision") {
    for (const l of b.links.filter((x) => x.from === subject)) if (!found.has(l.to)) {
      found.set(l.to, { key: l.to, kind: kindOf(l.to), field: l.field, via: subject, distance: 1 });
      queue.push({ key: l.to, distance: 1 });
    }
  } else queue = [{ key: subject, distance: 0 }];

  while (queue.length > 0) {
    const next: typeof queue = [];
    for (const { key, distance } of queue) {
      if (expanded.has(key) || distance >= limit) continue;
      expanded.add(key);
      for (const edge of index.get(key) ?? []) {
        const kind = kindOf(edge.from);
        if (kind === "decision" || edge.from === subject) continue;
        if (!found.has(edge.from)) found.set(edge.from, { key: edge.from, kind, field: edge.field, via: key, distance: distance + 1 });
        if (!edge.listed) next.push({ key: edge.from, distance: distance + 1 });
      }
    }
    queue = next;
  }
  const dependents = [...found.values()].sort((a, c) => a.distance - c.distance || a.key.localeCompare(c.key));
  const distances = new Map([[subject, 0], ...dependents.map((d) => [d.key, d.distance] as const)]);
  const named = (keys: Iterable<string>): Dependent[] =>
    [...keys].flatMap((k) =>
      (index.get(k) ?? []).filter((e) => kindOf(e.from) === "decision").map((e) =>
        ({ key: e.from, kind: "decision", field: e.field, via: k, distance: (distances.get(k) ?? 0) + 1 })))
      .sort((a, c) => a.distance - c.distance || a.key.localeCompare(c.key));
  const members = new Set(distances.keys());
  const byKind: Record<string, number> = {};
  for (const d of dependents) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
  return {
    subject, depth: Number.isFinite(limit) ? limit : null, dependents, byKind,
    decisions: { direct: named([subject]), onDependents: named(dependents.map((d) => d.key)) },
    evals: b.evals.filter((e) => members.has(e.subject)).map((e) => ({ id: e.id, subject: e.subject })),
  };
};
