// What the product is and where it stands, derived from the blueprint, the status document and git. Pure: the
// caller passes them in. Nothing here is written by hand; every number is counted from them.

import { freshStatus, staleEvals, standOf, STANDS, type AnyRecord, type Blueprint, type Stand, type StatusDocument } from "../../blueprint-engine/src/index.ts";
import { areaOf, type Commit } from "./history.ts";

export interface OpRow { readonly id: string; readonly title: string; readonly command: string; readonly stand: Stand; readonly why: string }
export interface Finding { readonly record: string; readonly rule: string; readonly detail: string }
export interface Work { readonly who: string; readonly commits: number; readonly last: string }
export interface ConceptView {
  readonly id: string; readonly title: string; readonly about: string; readonly dependsOn: readonly string[];
  readonly operations: readonly OpRow[]; readonly stands: Readonly<Record<Stand, number>>;
  readonly records: Readonly<Record<string, readonly { id: string; title: string }[]>>;
  readonly gaps: readonly Finding[]; readonly owed: readonly Finding[]; readonly work: readonly Work[]; readonly recent: readonly Commit[];
}
export interface JourneyView {
  readonly id: string; readonly title: string; readonly finish: string;
  readonly steps: readonly { readonly operation: string; readonly title: string; readonly stand: Stand; readonly concept: string }[];
}
export interface Day { readonly date: string; readonly commits: number; readonly who: Readonly<Record<string, number>>; readonly areas: readonly string[]; readonly verdicts: Readonly<Record<string, number>> }
export interface Model {
  readonly title: string; readonly about: string; readonly built: string;
  readonly actors: readonly { id: string; kind: string; about: string }[]; readonly surfaces: readonly string[];
  readonly counts: { readonly records: number; readonly evals: number; readonly pass: number; readonly fail: number; readonly stale: number; readonly problems: number; readonly gaps: number; readonly owed: number };
  readonly stands: Readonly<Record<Stand, number>>;
  readonly concepts: readonly ConceptView[]; readonly journeys: readonly JourneyView[];
  readonly problems: readonly Finding[]; readonly days: readonly Day[];
  readonly people: readonly { readonly who: string; readonly areas: Readonly<Record<string, number>> }[];
}

/** The kinds a concept page lists, in this order. */
export const LISTED = ["table", "doctype", "machine", "event", "screen", "role", "feature", "rpc", "flow", "workflow", "insight", "alert", "dashboard"] as const;

const ref = (u: unknown) => (u as { id?: string } | undefined)?.id;
const zero = (): Record<Stand, number> => Object.fromEntries(STANDS.map((s) => [s, 0])) as Record<Stand, number>;

export const buildModel = (input: { blueprint: Blueprint; status: StatusDocument | null; history: readonly Commit[]; built: string }): Model => {
  const { blueprint: b, history } = input;
  const all = [...b.records.values()];
  const of = (kind: string) => all.filter((r) => r._kind === kind);
  const system = of("system")[0];
  const concepts = of("concept");
  const ids = new Set(concepts.map((c) => c.id));
  const conceptOfOp = (op: AnyRecord): string => {
    const impl = b.records.get(`${(op.implementedBy as AnyRecord | undefined)?._kind}:${ref(op.implementedBy)}`);
    return ref(impl?.concept) ?? (ids.has(String(op.area)) ? String(op.area) : "");
  };
  const waits = (d: AnyRecord) => d.chosen === undefined || d.chosen === null;
  const ops = new Map(of("operation").map((op) => {
    const s = standOf(b, op, { waits, status: input.status });
    return [op.id, { id: op.id, title: String(op.title), command: String(op.command ?? ""), stand: s.stand, why: s.why, concept: conceptOfOp(op) }] as const;
  }));
  const owed = b.gaps.filter((g) => g.rule === "owed-change");
  const conceptOfKey = (key: string): string => {
    const r = b.records.get(key);
    return r?._kind === "operation" ? (ops.get(r.id)?.concept ?? "") : (ref(r?.concept) ?? (r?._kind === "concept" ? r.id : ""));
  };
  const fresh = freshStatus(b, input.status);
  const verdicts = Object.values(fresh?.evals ?? {});
  const stale = staleEvals(b, input.status).length;
  const stands = zero();
  for (const o of ops.values()) stands[o.stand]++;

  const conceptViews: ConceptView[] = concepts.map((c) => {
    const mine = [...ops.values()].filter((o) => o.concept === c.id).sort((a, z) => STANDS.indexOf(z.stand) - STANDS.indexOf(a.stand) || a.id.localeCompare(z.id));
    const st = zero();
    for (const o of mine) st[o.stand]++;
    const records = Object.fromEntries(LISTED.map((k) => [k, of(k).filter((r) => ref(r.concept) === c.id).map((r) => ({ id: r.id, title: String(r.title ?? r.id) }))]).filter(([, v]) => (v?.length ?? 0) > 0));
    const touching = history.filter((h) => h.files.some((f) => areaOf(f, ids) === c.id));
    const by = new Map<string, Work>();
    for (const h of touching) {
      const w = by.get(h.who);
      by.set(h.who, { who: h.who, commits: (w?.commits ?? 0) + 1, last: w && w.last > h.at ? w.last : h.at });
    }
    return {
      id: c.id, title: String(c.title), about: String(c.about), dependsOn: ((c.dependsOn ?? []) as AnyRecord[]).map((d) => d.id),
      operations: mine, stands: st, records,
      gaps: b.gaps.filter((g) => g.rule !== "owed-change" && conceptOfKey(g.record) === c.id),
      owed: owed.filter((g) => conceptOfKey(g.record) === c.id),
      work: [...by.values()].sort((a, z) => z.commits - a.commits), recent: touching.slice(0, 8),
    };
  });

  const journeys: JourneyView[] = of("journey").map((j) => ({
    id: j.id, title: String(j.title ?? j.id), finish: String(j.finish ?? ""),
    steps: (j.steps as { operation: AnyRecord }[]).map((s) => {
      const o = ops.get(s.operation.id);
      return { operation: s.operation.id, title: o?.title ?? s.operation.id, stand: o?.stand ?? "specify", concept: o?.concept ?? "" };
    }),
  }));

  const days = new Map<string, { commits: number; who: Record<string, number>; areas: Set<string>; verdicts: Record<string, number> }>();
  const day = (d: string) => days.get(d) ?? (days.set(d, { commits: 0, who: {}, areas: new Set(), verdicts: {} }), days.get(d)!);
  for (const h of history) {
    const d = day(h.at.slice(0, 10));
    d.commits++;
    d.who[h.who] = (d.who[h.who] ?? 0) + 1;
    for (const f of h.files) d.areas.add(areaOf(f, ids));
  }
  for (const v of Object.values(input.status?.evals ?? {})) if (v?.at) { const d = day(v.at.slice(0, 10)); d.verdicts[v.verdict] = (d.verdicts[v.verdict] ?? 0) + 1; }
  const people = new Map<string, Record<string, number>>();
  for (const h of history) {
    const p = people.get(h.who) ?? (people.set(h.who, {}), people.get(h.who)!);
    for (const a of new Set(h.files.map((f) => areaOf(f, ids)))) p[a] = (p[a] ?? 0) + 1;
  }

  return {
    title: String(system?.title ?? b.name), about: String(system?.about ?? ""), built: input.built,
    actors: ((system?.actors ?? []) as { id: string; kind: string; about: string }[]), surfaces: (system?.surfaces ?? []) as string[],
    counts: {
      records: b.records.size, evals: b.evals.length, pass: verdicts.filter((v) => v.verdict === "pass").length,
      fail: verdicts.filter((v) => v.verdict === "fail").length, stale, problems: b.problems.length,
      gaps: b.gaps.length - owed.length, owed: owed.length,
    },
    stands, concepts: conceptViews, journeys, problems: b.problems,
    days: [...days.entries()].sort(([a], [z]) => z.localeCompare(a)).map(([date, d]) => ({ date, commits: d.commits, who: d.who, areas: [...d.areas].sort(), verdicts: d.verdicts })),
    people: [...people.entries()].map(([who, areas]) => ({ who, areas })).sort((a, z) => a.who.localeCompare(z.who)),
  };
};
