// The ripple of a change: what a change to the blueprint touches. Two built blueprints in (before and after), out:
// the records added, removed and changed (with the fields that changed), every record that depends on one of them
// (impact.ts's meaning of "depends"), the decisions that name any of them, and the evals the change adds, removes or
// re-words (a re-worded eval's old verdict goes stale: status.ts). A pull request that changes a record shows this.

import { Schema } from "effect";
import { KINDS, type Kind } from "./records/base.ts";
import type { AnyRecord, Blueprint } from "./build.ts";
import { impactIndex, impactOf, type Dependent } from "./impact.ts";

type Built = Pick<Blueprint, "records" | "links" | "evals">;

export interface Ripple {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly { readonly key: string; readonly fields: readonly string[] }[];
  /** Records that depend on a changed or removed record and did not change themselves, nearest first. */
  readonly reached: readonly Dependent[];
  readonly byKind: Readonly<Record<string, number>>;
  /** Decisions that name a changed, removed or reached record. */
  readonly decisions: readonly string[];
  readonly evals: { readonly added: readonly string[]; readonly removed: readonly string[]; readonly reworded: readonly string[] };
}

const isRef = (u: unknown): u is { _kind: Kind; id: string } =>
  typeof u === "object" && u !== null && KINDS.includes((u as { _kind?: Kind })._kind as Kind) && typeof (u as { id?: unknown }).id === "string";

/** A value as stable text: a linked record is its key, a schema is its JSON Schema, object keys are sorted. */
const stable = (u: unknown): unknown => {
  if (Schema.isSchema(u)) {
    try {
      return { schema: Schema.toJsonSchemaDocument(u as Schema.Top) };
    } catch {
      return { schema: String((u as { ast: unknown }).ast) };
    }
  }
  if (isRef(u)) return `→${u._kind}:${u.id}`;
  if (Array.isArray(u)) return u.map(stable);
  if (u !== null && typeof u === "object")
    return Object.fromEntries(Object.keys(u).sort().map((k) => [k, stable((u as Record<string, unknown>)[k])]));
  return u;
};

/** Each top-level field of a record as stable text. A field that holds a child record (`t`, `c`, …) is its keys. */
export const fingerprint = (r: AnyRecord): Readonly<Record<string, string>> =>
  Object.fromEntries(Object.keys(r).filter((k) => k !== "_kind").sort().map((k) => {
    const v = r[k];
    const top = v !== null && typeof v === "object" && !Array.isArray(v) && !isRef(v) && !Schema.isSchema(v)
      ? Object.fromEntries(Object.entries(v as object).map(([n, x]) => [n, stable(x)]))
      : stable(v);
    return [k, JSON.stringify(top)];
  }));

export const rippleOf = (before: Built, after: Built): Ripple => {
  const added = [...after.records.keys()].filter((k) => !before.records.has(k)).sort();
  const removed = [...before.records.keys()].filter((k) => !after.records.has(k)).sort();
  const changed: { key: string; fields: string[] }[] = [];
  for (const [key, r] of after.records) {
    const old = before.records.get(key);
    if (!old) continue;
    const a = fingerprint(old), b = fingerprint(r);
    const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((f) => a[f] !== b[f]).sort();
    if (fields.length > 0) changed.push({ key, fields });
  }
  changed.sort((x, y) => x.key.localeCompare(y.key));
  const touched = new Set([...added, ...removed, ...changed.map((c) => c.key)]);
  const found = new Map<string, Dependent>();
  const decisions = new Set<string>();
  const spread = (b: Built, keys: readonly string[]) => {
    const index = impactIndex(b);
    for (const key of keys) {
      const i = impactOf(b, key, { index });
      if (!i) continue;
      for (const d of i.dependents) {
        if (touched.has(d.key)) continue;
        const had = found.get(d.key);
        if (!had || d.distance < had.distance) found.set(d.key, d);
      }
      for (const d of [...i.decisions.direct, ...i.decisions.onDependents]) decisions.add(d.key);
    }
  };
  spread(after, changed.map((c) => c.key));
  spread(before, removed);
  for (const k of touched) if (k.startsWith("decision:")) decisions.add(k);
  const reached = [...found.values()].sort((a, c) => a.distance - c.distance || a.key.localeCompare(c.key));
  const byKind: Record<string, number> = {};
  for (const d of reached) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
  // An eval is re-worded when its contract changes: its claim, or how the claim is observed.
  const claims = (b: Built) => new Map(b.evals.map((e) => [e.id, `${e.claim}\u0000${e.observes ?? ""}`]));
  const was = claims(before), now = claims(after);
  return {
    added, removed, changed, reached, byKind, decisions: [...decisions].sort(),
    evals: {
      added: [...now.keys()].filter((id) => !was.has(id)).sort(),
      removed: [...was.keys()].filter((id) => !now.has(id)).sort(),
      reworded: [...now].filter(([id, c]) => was.has(id) && was.get(id) !== c).map(([id]) => id).sort(),
    },
  };
};
