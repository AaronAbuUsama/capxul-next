// The evals a blueprint implies. Each record kind yields its evals by rule, so a complete record is
// also a complete definition of done. Ids follow docs/spec/30-capxul-evals.md.

import type { AnyRecord, Blueprint } from "./build.ts";
import { signalEvals } from "./signals.ts";
import { screenEvals } from "./screens.ts";

export type Level = "L1" | "L2" | "L3" | "L4";
export type Decider = "machine" | "agent" | "person";

export interface EvalDef {
  readonly id: string;
  readonly level: Level;
  readonly subject: string; // record key
  readonly claim: string;
  readonly decider: Decider;
}

const ofKind = (b: Pick<Blueprint, "records">, kind: string) => [...b.records.values()].filter((r) => r._kind === kind);
const list = <T>(u: unknown) => (u ?? []) as T[];

export const deriveEvals = (b: Pick<Blueprint, "records">): EvalDef[] => {
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
    list<string | null | { claim: string }>(o.acceptance).forEach((line, i) => {
      if (line !== null) e(`acc:${o.id}/${i + 1}`, "L1", o, typeof line === "string" ? line : line.claim);
    });
    e(`ret:${o.id}`, "L1", o, "a success prints exactly the returns schema with --json");
    const refusalCases = new Map<string, number>();
    for (const r of list<{ error: AnyRecord; given: string }>(o.refusals)) {
      const n = (refusalCases.get(r.error.id) ?? 0) + 1;
      refusalCases.set(r.error.id, n);
      e(`ref:${o.id}/${r.error.id}${n === 1 ? "" : `/${n}`}`, "L1", o, `from ${r.given}, it refuses with ${r.error.id}, its exit code and shape, and changes nothing`);
    }
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
    // P8: a tenant's row-level policy, proven by a second tenant who can neither read nor write the first's rows.
    const admits = list<{ match: string; field?: string; via?: { table: AnyRecord; field: string }; where?: object; reads: boolean; writes: boolean }>(t.admits);
    if (["organization", "person", "owner"].includes(String(t.tenancy)))
      e(
        `tbl:${t.id}/tenancy`,
        "L1",
        t,
        `a second ${String(t.tenancy)} reads and writes none of the first's rows${admits.length ? ", unless an admission names it" : ""}; only a cross-tenant index's named query reads across`,
      );
    // Each admission is one policy clause: the party it names gets exactly what it grants, on exactly its rows.
    admits.forEach((a, i) => {
      const who = a.match === "anyone" ? "any caller" : `a session matched by ${a.match} on ${a.via ? `${a.via.table.id}.${a.via.field} (joined by ${a.field})` : a.field}`;
      const can = [a.reads && "reads", a.writes && "writes"].filter(Boolean).join(" and ") || "touches";
      const rows = a.where ? `the rows where ${Object.entries(a.where).map(([k, v]) => `${k} = ${String(v)}`).join(" and ")}` : "the rows it names";
      // Another clause, or the row's own tenant, may admit a session this clause does not: only one that nothing admits sees none.
      const others = t.tenancy === "chain" ? "no admission" : "neither the row's tenant nor any admission";
      e(`tbl:${t.id}/admits/${i + 1}`, "L1", t, `${who} ${can} ${rows}${a.writes ? "" : ", and writes none"}; a session that ${others} matches sees none of them`);
    });
  }
  for (const t of ofKind(b, "transition")) e(`trn:${t.id}`, "L1", t, "an eval run observes this transition, with its events");

  for (const w of ofKind(b, "workflow")) {
    e(`wfl:${w.id}/idempotent`, "L1", w, `a second run with the same key (${String(w.idempotency)}) changes nothing`);
    e(`wfl:${w.id}/resume`, "L1", w, "killed mid-run, it resumes and finishes with the same result");
    // A budget is system time (P5): a durable process's declared waits (a person, a timer, the chain, a
    // signal, the indexer) are wait.* spans and never count toward it, however long they last.
    const budget = w.budget as { p95Ms: number; excludes?: readonly string[] } | undefined;
    const waits = list<{ name: string }>(w.waits).map((x) => `wait.${x.name}`);
    const excluded = [...new Set([...waits, ...(budget?.excludes ?? []), "chain.confirm"])];
    if (budget)
      e(`bud:${w.id}/p95`, "L1", w, `system time p95 ≤ ${budget.p95Ms} ms from trigger to done, excluding its waits (${excluded.join(", ")})`);
    // A wait's key is the routing the runtime must prove (rules.process-wakeups): the matching event wakes this
    // instance and no other waiting instance of the workflow.
    for (const wait of list<{ name: string; key?: { on: AnyRecord[]; props: string[]; reaches?: string }[] }>(w.waits))
      if (wait.key)
        e(
          `wfl:${w.id}/wake/${wait.name}`,
          "L1",
          w,
          `wait ${wait.name} is woken by ${wait.key.map((k) => `${k.on.map((o) => o.id).join(" or ")} by ${[...k.props, ...(k.reaches ? [`${k.reaches} reached`] : [])].join(", ")}`).join("; ")}, and one that differs wakes no other instance`,
        );
  }

  for (const i of ofKind(b, "integration")) {
    e(`int:${i.id}/conformance`, "L1", i, "the devnet fake and the real service pass the same conformance suite");
    for (const [name, call] of Object.entries(i.calls as Record<string, { failures: { error: AnyRecord; when: string }[] }>))
      {
        const cases = new Map<string, number>();
        for (const f of call.failures) {
          const n = (cases.get(f.error.id) ?? 0) + 1;
          cases.set(f.error.id, n);
          e(`int:${i.id}.${name}/${f.error.id}${n === 1 ? "" : `/${n}`}`, "L1", i, `when ${f.when}, callers see ${f.error.id}`);
        }
      }
  }

  for (const j of ofKind(b, "journey")) {
    e(`jrn:${j.id}`, "L2", j, "the journey's scenario runs end to end on a devnet");
    // A step is proven by its event, or by its operation's own success (P7): the claim says which, so a success-proven
    // step never demands an event the record does not ask for.
    const proofs = list<{ proves?: AnyRecord | "success" }>(j.steps).map((st) => st.proves);
    const byEvent = proofs.filter((p) => p !== undefined && p !== "success").length;
    const bySuccess = proofs.filter((p) => p === "success").length;
    const how =
      bySuccess === 0 ? "every step's proving event is sent once"
      : byEvent === 0 ? "every step's operation succeeds once"
      : "every step is proven once, by its proving event or by its operation's success";
    e(`fun:${j.id}`, "L2", j, `${how}, in order, so the funnel can be derived`);
  }

  for (const c of ofKind(b, "concept")) {
    e(`sys:imports/${c.id}`, "L3", c, "it imports only the concepts it depends on, through their doors");
    if (typeof c.lines === "number") e(`sys:loc/${c.id}`, "L3", c, `it is within ${c.lines} lines`);
  }
  // Generated code is never edited: regenerating from the records into a clean tree changes nothing.
  for (const s of ofKind(b, "system"))
    e(`sys:generated`, "L3", s, "regenerating every generated file from the records gives no diff, and the generated packages compile");
  for (const i of ofKind(b, "invariant")) e(`inv:${i.id}`, "L3", i, String(i.statement));
  for (const v of ofKind(b, "environment")) {
    e(`env:${v.id}/boot`, "L3", v, typeof v.bootMs === "number" ? `it boots in ≤ ${v.bootMs} ms` : "it boots");
    e(`env:${v.id}/smoke`, "L3", v, "a smoke journey passes on it");
  }
  return [...out, ...signalEvals(b), ...screenEvals(b)];
};
