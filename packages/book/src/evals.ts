// The evals a book implies. Each record kind yields its evals by rule, so a complete record is
// also a complete definition of done. Ids follow docs/spec/30-capxul-evals.md.

import type { AnyRecord, Book } from "./build.ts";

export type Level = "L1" | "L2" | "L3" | "L4";
export type Decider = "machine" | "agent" | "person";

export interface EvalDef {
  readonly id: string;
  readonly level: Level;
  readonly subject: string; // record key
  readonly claim: string;
  readonly decider: Decider;
}

const ofKind = (b: Pick<Book, "records">, kind: string) => [...b.records.values()].filter((r) => r._kind === kind);
const list = <T>(u: unknown) => (u ?? []) as T[];

export const deriveEvals = (b: Pick<Book, "records">): EvalDef[] => {
  const out: EvalDef[] = [];
  const e = (id: string, level: Level, subject: AnyRecord, claim: string, decider: Decider = "machine") =>
    out.push({ id, level, subject: `${subject._kind}:${subject.id}`, claim, decider });

  const machines = new Map(ofKind(b, "machine").map((m) => [m.id, m]));
  const get = (key: string) => b.records.get(key);
  /** Events an rpc, flow or procedure sends: its own, its transitions', its procedures' and its steps'. */
  const eventsOf = (key: string, seen = new Set<string>()): Set<string> => {
    const out = new Set<string>();
    const r = get(key);
    if (!r || seen.has(key)) return out;
    seen.add(key);
    for (const x of list<AnyRecord>(r.emits)) out.add(x.id);
    for (const t of list<{ machine: string; name: string }>(r.drives))
      for (const x of list<AnyRecord>((machines.get(t.machine)?.transitions as Record<string, { emits: AnyRecord[] }> | undefined)?.[t.name]?.emits)) out.add(x.id);
    for (const pr of list<AnyRecord>(r.invokes)) eventsOf(`procedure:${pr.id}`, seen).forEach((e) => out.add(e));
    for (const st of list<{ rpc?: AnyRecord }>(r.steps)) if (st.rpc) eventsOf(`rpc:${st.rpc.id}`, seen).forEach((e) => out.add(e));
    return out;
  };

  for (const o of ofKind(b, "operation")) {
    list<string | null>(o.acceptance).forEach((line, i) => {
      if (line !== null) e(`acc:${o.id}/${i + 1}`, "L1", o, line);
    });
    e(`ret:${o.id}`, "L1", o, "a success prints exactly the returns schema with --json");
    for (const r of list<{ error: AnyRecord; given: string }>(o.refusals))
      e(`ref:${o.id}/${r.error.id}`, "L1", o, `from ${r.given}, it refuses with ${r.error.id}, its exit code and shape, and changes nothing`);
    const impl = o.implementedBy as AnyRecord;
    for (const ev of eventsOf(`${impl._kind}:${impl.id}`)) e(`evt:${o.id}/${ev}`, "L1", o, `it sends ${ev}, valid against its schema, carrying trace_id`);
    e(`spn:${o.id}`, "L1", o, "one trace from the CLI command through the SDK to the server, with every declared span");
    const budget = o.budget as { p50Ms: number; p95Ms: number } | undefined;
    if (budget) e(`bud:${o.id}/p95`, "L1", o, `end to end, p95 ≤ ${budget.p95Ms} ms and p50 ≤ ${budget.p50Ms} ms over N warm runs`);
    e(`doc:${o.id}`, "L1", o, "its CLI help, reference page and record agree");
    e(`des:${o.id}`, "L1", o, "its record is complete and consistent with the old book and the old behaviour", "agent");
  }

  for (const r of ofKind(b, "rpc")) {
    const budget = r.budget as { p95Ms: number } | undefined;
    if (budget) e(`rpc:${r.id}/budget`, "L1", r, `server time p95 ≤ ${budget.p95Ms} ms`);
    e(`rpc:${r.id}/spans`, "L1", r, "its server span has the declared child spans and attributes");
    e(`rpc:${r.id}/errors`, "L1", r, "it fails only with its declared errors; anything else is a defect");
  }
  for (const f of ofKind(b, "flow")) {
    const budget = f.budget as { p95Ms: number } | undefined;
    if (budget) e(`flw:${f.id}/budget`, "L1", f, `client time p95 ≤ ${budget.p95Ms} ms, excluding wait steps`);
    e(`flw:${f.id}/spans`, "L1", f, "each step is a span, and wait steps are marked as waits");
  }
  for (const pr of ofKind(b, "procedure"))
    e(`prc:${pr.id}/atomic`, "L1", pr, "its writes commit with its invoker's transaction or not at all");

  for (const t of ofKind(b, "table")) {
    e(`tbl:${t.id}/schema`, "L1", t, "the migration creates exactly these fields, key and indexes");
    e(`tbl:${t.id}/writers`, "L1", t, "only the operations and workflows that list it in writes change it");
  }
  for (const t of ofKind(b, "transition")) e(`trn:${t.id}`, "L1", t, "an eval run observes this transition, with its events");

  for (const w of ofKind(b, "workflow")) {
    e(`wfl:${w.id}/idempotent`, "L1", w, `a second run with the same key (${String(w.idempotency)}) changes nothing`);
    e(`wfl:${w.id}/resume`, "L1", w, "killed mid-run, it resumes and finishes with the same result");
    const budget = w.budget as { p95Ms: number } | undefined;
    if (budget) e(`bud:${w.id}/p95`, "L1", w, `p95 ≤ ${budget.p95Ms} ms from trigger to done, excluding chain confirmation`);
  }

  for (const i of ofKind(b, "integration")) {
    e(`int:${i.id}/conformance`, "L1", i, "the devnet fake and the real service pass the same conformance suite");
    for (const [name, call] of Object.entries(i.calls as Record<string, { failures: { error: AnyRecord }[] }>))
      for (const f of call.failures) e(`int:${i.id}.${name}/${f.error.id}`, "L1", i, `when it fails this way, callers see ${f.error.id}`);
  }

  for (const j of ofKind(b, "journey")) {
    e(`jrn:${j.id}`, "L2", j, "the journey's scenario runs end to end on a devnet");
    e(`fun:${j.id}`, "L2", j, "every step's proving event is sent once, in order, so the funnel can be derived");
  }

  for (const c of ofKind(b, "concept")) {
    e(`sys:imports/${c.id}`, "L3", c, "it imports only the concepts it depends on, through their doors");
    if (typeof c.lines === "number") e(`sys:loc/${c.id}`, "L3", c, `it is within ${c.lines} lines`);
  }
  for (const i of ofKind(b, "invariant")) e(`inv:${i.id}`, "L3", i, String(i.statement));
  for (const v of ofKind(b, "environment")) {
    e(`env:${v.id}/boot`, "L3", v, typeof v.bootMs === "number" ? `it boots in ≤ ${v.bootMs} ms` : "it boots");
    e(`env:${v.id}/smoke`, "L3", v, "a smoke journey passes on it");
  }
  return out;
};
