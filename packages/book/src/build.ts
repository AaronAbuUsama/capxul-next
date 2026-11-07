// Build a book: register every record, check every link and rule, compute the reverse links,
// derive the gaps and the evals. Problems must be fixed; gaps are shown, never written by hand.

import { Schema } from "effect";
import { KINDS, type Kind } from "./records/base.ts";
import { deriveEvals, type EvalDef } from "./evals.ts";

export interface AnyRecord {
  readonly _kind: Kind;
  readonly id: string;
  readonly [field: string]: unknown;
}

/** A link from one record's field to another record. */
export interface Link {
  readonly from: string; // "operation:payment.send"
  readonly field: string; // "writes"
  readonly to: string; // "table:payments"
}

export interface Finding {
  readonly record: string;
  readonly rule: string;
  readonly detail: string;
}

export interface Book {
  readonly name: string;
  readonly stage: "as-is" | "target";
  readonly records: ReadonlyMap<string, AnyRecord>;
  readonly links: readonly Link[];
  /** Who links to a record: key → links that point at it. */
  readonly linkedBy: ReadonlyMap<string, readonly Link[]>;
  /** Must be fixed: the book is wrong. */
  readonly problems: readonly Finding[];
  /** Derived: the design is incomplete here. */
  readonly gaps: readonly Finding[];
  readonly evals: readonly EvalDef[];
}

export const keyOf = (r: { _kind: string; id: string }) => `${r._kind}:${r.id}`;

const isRef = (u: unknown): u is { _kind: Kind; id: string } =>
  typeof u === "object" && u !== null && KINDS.includes((u as { _kind?: Kind })._kind as Kind) &&
  typeof (u as { id?: unknown }).id === "string";

/** Child records a record carries: a machine's transitions, an integration's calls, a contract's functions and events. */
const children = (r: AnyRecord): AnyRecord[] =>
  (["t", "c", "f", "e"] as const).flatMap((k) =>
    r._kind !== "decision" && typeof r[k] === "object" && r[k] !== null ? (Object.values(r[k] as object) as AnyRecord[]) : [],
  );

/** Every link in a record, by top-level field. Schemas held as values are not walked. */
const linksOf = (r: AnyRecord, problems: Finding[]): Link[] => {
  const out: Link[] = [];
  const from = keyOf(r);
  const walk = (field: string, u: unknown): void => {
    if (u === undefined) {
      problems.push({ record: from, rule: "undefined-link", detail: `${field} holds undefined: an import cycle or a missing export` });
      return;
    }
    if (u === null || typeof u !== "object" || Schema.isSchema(u)) return;
    if (isRef(u)) {
      out.push({ from, field, to: keyOf(u) });
      return;
    }
    for (const v of Array.isArray(u) ? u : Object.values(u)) walk(field, v);
  };
  for (const [field, value] of Object.entries(r)) {
    if (field === "_kind" || ["t", "c", "f", "e"].includes(field)) continue;
    walk(field, value);
  }
  return out;
};

export const buildBook = (input: { name: string; stage: "as-is" | "target"; records: readonly unknown[] }): Book => {
  const problems: Finding[] = [];
  const records = new Map<string, AnyRecord>();
  const add = (r: AnyRecord) => {
    const key = keyOf(r);
    if (records.has(key)) problems.push({ record: key, rule: "duplicate", detail: "two records share this kind and id" });
    records.set(key, r);
  };
  input.records.forEach((u, i) => {
    if (!isRef(u)) {
      problems.push({ record: `#${i}`, rule: "not-a-record", detail: "the book lists something that is not a record" });
      return;
    }
    add(u as AnyRecord);
    children(u as AnyRecord).forEach(add);
  });

  const links = [...records.values()].filter((r) => !["transition", "call", "function", "chainEvent"].includes(r._kind))
    .flatMap((r) => linksOf(r, problems));
  for (const l of links) {
    if (!records.has(l.to)) problems.push({ record: l.from, rule: "dangling", detail: `${l.field} → ${l.to} is not in the book` });
  }
  const linkedBy = new Map<string, Link[]>();
  for (const l of links) linkedBy.set(l.to, [...(linkedBy.get(l.to) ?? []), l]);

  const book = { name: input.name, stage: input.stage, records, links, linkedBy, problems, gaps: [] as Finding[], evals: [] as EvalDef[] };
  checkRules(book, problems);
  const gaps = deriveGaps(book);
  return { ...book, gaps, evals: deriveEvals(book) };
};

// ── rules: the book is wrong if one fails ───────────────────────────────────────────────────

type Draft = Pick<Book, "records" | "links" | "linkedBy">;

const all = (b: Draft, kind: Kind) => [...b.records.values()].filter((r) => r._kind === kind);
const ids = (u: unknown) => ((u ?? []) as { _kind: string; id: string }[]).map(keyOf);
const get = (b: Draft, key: string) => b.records.get(key);

const checkRules = (b: Draft, problems: Finding[]) => {
  const p = (record: AnyRecord, rule: string, detail: string) => problems.push({ record: keyOf(record), rule, detail });

  for (const m of all(b, "machine")) {
    const states = new Set((m.states as { id: string }[]).map((s) => s.id));
    if (!states.has(m.initial as string)) p(m, "machine-initial", `initial state ${String(m.initial)} is not a state`);
    for (const [name, t] of Object.entries(m.transitions as Record<string, { from: string[]; to: string }>)) {
      for (const s of [...t.from, t.to]) if (!states.has(s)) p(m, "machine-state", `transition ${name} names unknown state ${s}`);
    }
  }

  for (const r of [...all(b, "operation"), ...all(b, "workflow")]) {
    const concept = get(b, ids([r.concept])[0] ?? "");
    const allowed = new Set([keyOf(r.concept as AnyRecord), ...ids(concept?.dependsOn)]);
    const writes = new Set(ids(r.writes));
    for (const key of writes) {
      const t = get(b, key);
      if (t && keyOf(t.concept as AnyRecord) !== keyOf(r.concept as AnyRecord))
        p(r, "write-boundary", `writes ${key}, which belongs to ${keyOf(t.concept as AnyRecord)}; a concept writes only its own tables`);
    }
    for (const key of ids(r.reads)) {
      const t = get(b, key);
      if (t && !allowed.has(keyOf(t.concept as AnyRecord)))
        p(r, "read-boundary", `reads ${key} from ${keyOf(t.concept as AnyRecord)}, which its concept does not depend on`);
    }
    for (const tr of (r.drives ?? []) as { machine: string }[]) {
      const m = get(b, `machine:${tr.machine}`);
      if (m && !writes.has(keyOf(m.table as AnyRecord))) p(r, "drives-without-write", `drives ${keyOf(tr as never)} but does not write ${keyOf(m.table as AnyRecord)}`);
    }
    if (r._kind === "operation") {
      const errors = new Set(ids(r.errors));
      for (const f of r.refusals as { error: AnyRecord }[])
        if (!errors.has(keyOf(f.error))) p(r, "refusal-not-declared", `refusal ${f.error.id} is not in errors`);
    }
  }

  for (const kind of ["concept", "component"] as const) {
    for (const r of all(b, kind)) {
      const seen = new Set<string>();
      const visit = (key: string): boolean => {
        if (key === keyOf(r) && seen.size > 0) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return ids(get(b, key)?.dependsOn).some(visit);
      };
      if (ids(r.dependsOn).some(visit)) p(r, "cycle", `${kind} dependencies form a cycle through ${keyOf(r)}`);
    }
  }

  const actors = new Set(all(b, "system").flatMap((s) => (s.actors as { id: string }[]).map((a) => a.id)));
  for (const j of all(b, "journey"))
    for (const s of j.steps as { as: string }[]) if (!actors.has(s.as)) p(j, "unknown-actor", `step taken as ${s.as}, who is not a system actor`);
};

// ── gaps: derived, never written ────────────────────────────────────────────────────────────

const deriveGaps = (b: Draft): Finding[] => {
  const gaps: Finding[] = [];
  const g = (record: AnyRecord, rule: string, detail: string) => gaps.push({ record: keyOf(record), rule, detail });
  const by = (r: AnyRecord, field?: string) => (b.linkedBy.get(keyOf(r)) ?? []).filter((l) => !field || l.field === field);

  for (const t of all(b, "table")) if (by(t, "writes").length === 0) g(t, "unwritten-table", "no operation or workflow writes it");
  for (const t of all(b, "transition")) if (by(t, "drives").length === 0) g(t, "undriven-transition", "no operation or workflow drives it");
  for (const m of all(b, "machine")) {
    const reached = new Set([m.initial as string, ...Object.values(m.transitions as Record<string, { to: string }>).map((t) => t.to)]);
    for (const s of m.states as { id: string }[]) if (!reached.has(s.id)) g(m, "unreachable-state", `no transition reaches ${s.id}`);
  }
  for (const e of all(b, "event")) if (by(e).length === 0) g(e, "unsent-event", "no transition, operation or workflow sends it");
  for (const e of all(b, "error")) if (by(e).length === 0) g(e, "unproduced-error", "no operation or integration produces it");
  for (const c of all(b, "call")) if (by(c, "calls").length === 0) g(c, "unused-call", "nothing calls it");
  for (const f of all(b, "function")) if (by(f, "chain").length === 0) g(f, "uncalled-function", "nothing calls it");
  for (const e of all(b, "chainEvent")) if (by(e).length === 0) g(e, "unconsumed-chain-event", "no workflow is triggered by it");
  for (const c of all(b, "concept")) if (by(c, "concept").length === 0) g(c, "empty-concept", "it owns no tables, operations or workflows");
  for (const c of all(b, "component")) if (by(c, "runs").length === 0) g(c, "unhosted-component", "no environment runs it");
  for (const o of all(b, "operation"))
    if (!(o.acceptance as (string | null)[]).some((a) => a !== null)) g(o, "no-acceptance", "it has no acceptance lines");
  for (const j of all(b, "journey"))
    (j.steps as { operation: AnyRecord; proves?: unknown }[]).forEach((s, i) => {
      if (!s.proves) g(j, "unproven-step", `step ${i + 1} (${s.operation.id}) has no proving event`);
    });
  for (const i of all(b, "invariant")) if (i.check === "reconcile" && !i.by) g(i, "unchecked-invariant", "a reconcile check names no workflow");
  return gaps;
};
