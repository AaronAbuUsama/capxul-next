// Build a book: register every record, check every link and rule, compute the reverse links,
// derive the gaps and the evals. Problems must be fixed; gaps are shown, never written by hand.

import { Schema } from "effect";
import { KINDS, type Kind } from "./records/base.ts";
import { deriveEvals, type EvalDef } from "./evals.ts";
import { BUDGET_DEFAULTS } from "./budgets.ts";

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
  if (input.stage === "target") checkTargetRules(book, problems);
  const gaps = deriveGaps(book);
  return { ...book, gaps, evals: deriveEvals(book) };
};

/** Every error an rpc, flow or procedure can produce: its own, its procedures', its steps' and its calls' failures. */
export const errorsOf = (b: Draft, key: string, seen = new Set<string>()): Set<string> => {
  const out = new Set<string>();
  if (seen.has(key)) return out;
  seen.add(key);
  const r = get(b, key);
  if (!r) return out;
  for (const e of ids(r.errors)) out.add(e);
  for (const pr of ids(r.invokes)) errorsOf(b, pr, seen).forEach((e) => out.add(e));
  for (const s of (r.steps ?? []) as { rpc?: AnyRecord }[]) if (s.rpc) errorsOf(b, keyOf(s.rpc), seen).forEach((e) => out.add(e));
  for (const c of (r.calls ?? []) as { integration?: string; name?: string }[]) {
    const i = c.integration ? get(b, `integration:${c.integration}`) : undefined;
    for (const f of ((i?.calls as Record<string, { failures: { error: AnyRecord }[] }> | undefined)?.[c.name ?? ""]?.failures ?? []))
      out.add(keyOf(f.error));
  }
  return out;
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

  // server-side behaviour: the concept boundary
  for (const r of [...all(b, "rpc"), ...all(b, "workflow"), ...all(b, "procedure")]) {
    const own = keyOf(r.concept as AnyRecord);
    const allowed = new Set([own, ...ids(get(b, own)?.dependsOn)]);
    const writes = new Set(ids(r.writes));
    for (const key of writes) {
      const t = get(b, key);
      if (t && keyOf(t.concept as AnyRecord) !== own)
        p(r, "write-boundary", `writes ${key}, which belongs to ${keyOf(t.concept as AnyRecord)}; invoke one of its procedures instead`);
    }
    for (const key of ids(r.reads)) {
      const t = get(b, key);
      if (t && !allowed.has(keyOf(t.concept as AnyRecord)))
        p(r, "read-boundary", `reads ${key} from ${keyOf(t.concept as AnyRecord)}, which its concept does not depend on`);
    }
    for (const key of ids(r.invokes)) {
      const pr = get(b, key);
      if (pr && !allowed.has(keyOf(pr.concept as AnyRecord)))
        p(r, "invoke-boundary", `invokes ${key} from ${keyOf(pr.concept as AnyRecord)}, which its concept does not depend on`);
    }
    for (const tr of (r.drives ?? []) as { machine: string }[]) {
      const m = get(b, `machine:${tr.machine}`);
      if (m && !writes.has(keyOf(m.table as AnyRecord))) p(r, "drives-without-write", `drives ${keyOf(tr as never)} but does not write ${keyOf(m.table as AnyRecord)}`);
    }
    // every way an outside call fails must surface as an error the caller can see
    if (r._kind !== "procedure") {
      const declared = new Set(ids(r.errors ?? []));
      for (const c of (r.calls ?? []) as { integration: string; name: string }[]) {
        const i = get(b, `integration:${c.integration}`);
        const failures = ((i?.calls as Record<string, { failures: { error: AnyRecord }[] }> | undefined)?.[c.name]?.failures ?? []);
        if (r._kind === "rpc")
          for (const f of failures)
            if (!declared.has(keyOf(f.error))) p(r, "call-error-not-declared", `calls ${c.integration}.${c.name}, which fails with ${f.error.id}, not in errors`);
      }
    }
  }

  // an operation's refusals must be errors its implementation can produce
  for (const o of all(b, "operation")) {
    const produced = errorsOf(b, keyOf(o.implementedBy as AnyRecord));
    for (const e of ids(o.errors)) produced.add(e);
    for (const f of o.refusals as { error: AnyRecord }[])
      if (!produced.has(keyOf(f.error))) p(o, "refusal-not-produced", `refusal ${f.error.id} is not an error its implementation produces`);
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

// ── target rules: what a rebuilt design must satisfy (the accepted policies) ────────────────

const checkTargetRules = (b: Draft, problems: Finding[]) => {
  const p = (record: AnyRecord, rule: string, detail: string) => problems.push({ record: keyOf(record), rule, detail });
  const by = (r: AnyRecord, field?: string) => (b.linkedBy.get(keyOf(r)) ?? []).filter((l) => !field || l.field === field);

  // P7: product events come only from transitions, one per state machine.
  for (const r of [...all(b, "rpc"), ...all(b, "workflow"), ...all(b, "procedure")])
    if (((r.emits ?? []) as unknown[]).length) p(r, "event-not-on-transition", "a target event is sent by a transition, not by an rpc, workflow or procedure");
  for (const m of all(b, "machine")) {
    const expected = `${m.id.replace(/-/g, "_")}_transitioned`;
    const sent = new Set(Object.values(m.transitions as Record<string, { emits: AnyRecord[] }>).flatMap((t) => t.emits.map((e) => e.id)));
    for (const e of sent) if (e !== expected) p(m, "one-event-per-machine", `sends ${e}; a target machine sends only ${expected}`);
  }

  // P2: nothing unreached survives.
  for (const r of all(b, "rpc")) if (by(r, "implementedBy").length + by(r, "steps").length + by(r, "signals").length + by(r, "trigger").length === 0)
    p(r, "unreached-rpc", "no operation, flow or workflow reaches it");

  // P5: every piece of behaviour has a budget; one that leaves its class default says why.
  for (const r of [...all(b, "operation"), ...all(b, "rpc"), ...all(b, "flow"), ...all(b, "workflow")]) {
    const bud = r.budget as { class: keyof typeof BUDGET_DEFAULTS; p50Ms: number; p95Ms: number; why?: string } | undefined;
    if (!bud) { p(r, "no-budget", "a target record says how fast it must be"); continue; }
    const d = BUDGET_DEFAULTS[bud.class];
    if (d && (bud.p50Ms !== d.p50Ms || bud.p95Ms !== d.p95Ms) && !bud.why)
      p(r, "budget-override-why", `${bud.p50Ms}/${bud.p95Ms} ms differs from the ${bud.class} default ${d.p50Ms}/${d.p95Ms} ms with no why`);
  }

  // P8: a tenant table names its tenant column and leads every key and index with it.
  for (const t of all(b, "table")) {
    if (["global", "chain"].includes(t.tenancy as string)) continue;
    const field = t.tenantField as string | undefined;
    if (!field) { if (!t.scope) p(t, "tenant-key", "a tenant table names its tenantField, or its scope when tenancy is by join"); continue; }
    if ((t.key as string[])[0] !== field) p(t, "tenant-key", `its key starts with ${(t.key as string[])[0]}, not the tenant column ${field}`);
    for (const i of t.indexes as { name: string; fields: string[]; crossTenant?: boolean }[])
      if (!i.crossTenant && i.fields[0] !== field) p(t, "tenant-key", `index ${i.name} does not start with ${field}`);
  }

  // P1: a target acceptance line is a claim with what it observes.
  for (const o of all(b, "operation"))
    (o.acceptance as unknown[]).forEach((a, i) => {
      if (typeof a === "string") p(o, "acceptance-claim", `line ${i + 1} is plain text; a target line is {claim, observes, was}`);
    });
};

// ── gaps: derived, never written ────────────────────────────────────────────────────────────

const deriveGaps = (b: Draft): Finding[] => {
  const gaps: Finding[] = [];
  const g = (record: AnyRecord, rule: string, detail: string) => gaps.push({ record: keyOf(record), rule, detail });
  const by = (r: AnyRecord, field?: string) => (b.linkedBy.get(keyOf(r)) ?? []).filter((l) => !field || l.field === field);

  // A chain table is written by the indexer (Ponder), which the book does not model as a writer.
  for (const t of all(b, "table")) if (t.tenancy !== "chain" && by(t, "writes").length === 0) g(t, "unwritten-table", "no operation or workflow writes it");
  for (const t of all(b, "transition")) if (by(t, "drives").length === 0) g(t, "undriven-transition", "no operation or workflow drives it");
  for (const m of all(b, "machine")) {
    const reached = new Set([m.initial as string, ...Object.values(m.transitions as Record<string, { to: string }>).map((t) => t.to)]);
    for (const s of m.states as { id: string }[]) if (!reached.has(s.id)) g(m, "unreachable-state", `no transition reaches ${s.id}`);
  }
  for (const e of all(b, "event")) if (by(e).length === 0) g(e, "unsent-event", "no transition, operation or workflow sends it");
  for (const e of all(b, "error")) if (by(e).length === 0) g(e, "unproduced-error", "nothing produces it");
  for (const c of all(b, "call")) if (by(c, "calls").length === 0) g(c, "unused-call", "nothing calls it");
  for (const f of all(b, "function")) if (by(f, "chain").length === 0) g(f, "uncalled-function", "nothing calls it");
  for (const e of all(b, "chainEvent")) if (by(e).length === 0) g(e, "unconsumed-chain-event", "no workflow is triggered by it");
  for (const c of all(b, "concept")) if (by(c, "concept").length === 0) g(c, "empty-concept", "it owns no tables, rpcs, procedures or workflows");
  for (const r of all(b, "rpc")) if (by(r, "implementedBy").length + by(r, "steps").length + by(r, "signals").length + by(r, "trigger").length === 0) g(r, "unused-rpc", "no operation or flow uses it");
  for (const f of all(b, "flow")) if (by(f, "implementedBy").length === 0) g(f, "unused-flow", "no operation is implemented by it");
  for (const pr of all(b, "procedure")) if (by(pr, "invokes").length === 0) g(pr, "uninvoked-procedure", "nothing invokes it");
  for (const c of all(b, "component")) if (by(c, "runs").length === 0) g(c, "unhosted-component", "no environment runs it");
  for (const o of all(b, "operation"))
    if (!(o.acceptance as (string | null)[]).some((a) => a !== null)) g(o, "no-acceptance", "it has no acceptance lines");
  for (const j of all(b, "journey"))
    (j.steps as { operation: AnyRecord; proves?: unknown }[]).forEach((s, i) => {
      if (!s.proves) g(j, "unproven-step", `step ${i + 1} (${s.operation.id}) has no proving event`);
    });
  for (const r of [...all(b, "operation"), ...all(b, "rpc"), ...all(b, "flow"), ...all(b, "workflow")])
    if (!r.budget) g(r, "no-budget", "nothing says how fast it must be");
  for (const o of all(b, "operation"))
    for (const f of o.refusals as { error: AnyRecord; given: string }[])
      if (f.given === "?") g(o, "refusal-without-world", `no world reaches ${f.error.id}`);
  for (const i of all(b, "invariant")) if (i.check === "reconcile" && !i.by) g(i, "unchecked-invariant", "a reconcile check names no workflow");
  return gaps;
};
