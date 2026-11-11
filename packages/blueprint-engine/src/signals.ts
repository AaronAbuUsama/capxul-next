// The rules and evals for what the product says about itself (events beyond transitions, log rows, metrics) and what
// is asked of it (insights, alerts, dashboards).
// A signal with nothing sending it, or a field it names that it does not have, is a problem; a product event nothing
// reads and a failure nothing watches are gaps; in a target design, a kind of call no log row covers is a gap on the system.

import { Schema } from "effect";
import type { AnyRecord, Blueprint, Finding } from "./build.ts";
import type { EvalDef } from "./evals.ts";

type Records = Pick<Blueprint, "records">;
type Linked = Pick<Blueprint, "records" | "linkedBy">;
const key = (r: { _kind: string; id: string }) => `${r._kind}:${r.id}`;
const of = (b: Records, kind: string) => [...b.records.values()].filter((r) => r._kind === kind);
/** The property names of a Struct schema; null when it is not a Struct. */
const names = (u: unknown): Set<string> | null => {
  const fields = Schema.isSchema(u) ? (u as { fields?: Record<string, unknown> }).fields : undefined;
  return fields ? new Set(Object.keys(fields)) : null;
};
const purposeOf = (e: AnyRecord) => String(e.purpose ?? "transition");

export const signalProblems = (b: Records): Finding[] => {
  const out: Finding[] = [];
  const p = (r: AnyRecord, rule: string, detail: string) => out.push({ record: key(r), rule, detail });
  const named = (r: AnyRecord, schema: unknown, list: unknown, field: string) => {
    const has = names(schema);
    for (const n of (list ?? []) as string[]) if (has && !has.has(n)) p(r, `${r._kind}-${field}`, `${field} names ${n}, which it does not carry`);
  };
  for (const e of of(b, "event")) {
    const purpose = purposeOf(e);
    if (purpose !== "transition" && !e.producer) p(e, "event-producer", `a ${purpose} event names what sends it`);
    if (purpose === "transition" && e.producer) p(e, "event-producer", "a transition event is sent by its machine; it names no producer");
    named(e, e.props, e.pii, "pii");
  }
  for (const l of of(b, "log")) {
    if (l.per === "once" && !l.producer) p(l, "log-producer", "a row written once names what writes it");
    if (l.per !== "once" && l.producer) p(l, "log-producer", `every ${String(l.per)} writes it; it names no single producer`);
    named(l, l.attributes, l.redact, "redact");
  }
  const signals = [...of(b, "event"), ...of(b, "log"), ...of(b, "metric")];
  for (const i of of(b, "insight")) {
    if (typeof i.query !== "string") continue;
    const reads = new Set((i.reads as AnyRecord[]).map(key));
    for (const s of signals)
      if (!reads.has(key(s)) && new RegExp(`['"\`]${s.id.replace(/[.]/g, "\\.")}['"\`]`).test(i.query)) p(i, "insight-reads", `its query names ${key(s)}, which reads does not list`);
    for (const r of i.reads as AnyRecord[])
      if (!i.query.includes(r.id)) p(i, "insight-reads", `reads lists ${key(r)}, which its query never names`);
  }
  return out;
};

export const signalGaps = (b: Linked, stage: "as-is" | "target"): Finding[] => {
  const out: Finding[] = [];
  const readers = (r: AnyRecord) => (b.linkedBy.get(key(r)) ?? []).filter((l) => l.field !== "affects" && !l.from.startsWith("decision:"));
  const watched = new Set(of(b, "alert").flatMap((a) => ((b.records.get(key(a.insight as AnyRecord))?.reads ?? []) as AnyRecord[]).map(key)));
  for (const e of of(b, "event")) {
    if (purposeOf(e) === "product" && readers(e).length === 0) out.push({ record: key(e), rule: "unread-event", detail: "no journey, insight or alert reads it" });
    if (purposeOf(e) === "failure" && !watched.has(key(e))) out.push({ record: key(e), rule: "unwatched-failure", detail: "no alert watches it" });
  }
  for (const i of of(b, "insight"))
    if (readers(i).length === 0) out.push({ record: key(i), rule: "unused-insight", detail: "no dashboard shows it and no alert evaluates it" });
  const covered = new Set(of(b, "log").map((l) => String(l.per)));
  if (stage === "target")
  for (const s of of(b, "system"))
    for (const kind of ["rpc", "workflow"])
      if (of(b, kind).length > 0 && !covered.has(kind)) out.push({ record: key(s), rule: "unlogged-operation", detail: `no log row is written per ${kind}` });
  return out;
};

export const signalEvals = (b: Records): EvalDef[] => {
  const out: EvalDef[] = [];
  const e = (id: string, r: AnyRecord, claim: string) => out.push({ id, level: "L2", subject: key(r), claim, decider: "machine" });
  for (const ev of of(b, "event")) {
    if (purposeOf(ev) === "transition") continue;
    e(`ana:${ev.id}/schema`, ev, "it is sent with its properties and the envelope, valid against both");
    if (Array.isArray(ev.pii)) e(`ana:${ev.id}/pii`, ev, `no personal data outside ${(ev.pii as string[]).join(", ") || "nothing"}`);
  }
  for (const l of of(b, "log")) {
    e(`log:${l.id}/written`, l, l.per === "once" ? "its producer writes the row once per run, with every attribute" : `every ${String(l.per)} writes one row per call, with every attribute`);
    if (Array.isArray(l.redact) && l.redact.length) e(`log:${l.id}/redacted`, l, `no value of ${(l.redact as string[]).join(", ")} leaves the component`);
  }
  for (const m of of(b, "metric")) e(`met:${m.id}/emitted`, m, `its producer emits it as a ${String(m.instrument)} in ${String(m.unit)}, with its attributes`);
  for (const i of of(b, "insight")) {
    e(`ins:${i.id}/runs`, i, `on a seeded world it returns rows shaped for a ${String(i.display)}`);
    if (typeof i.answer === "string") e(`ins:${i.id}/answers`, i, `on the thin-line world it answers: ${i.answer}`);
  }
  for (const a of of(b, "alert")) {
    const to = (a.route as string[]).join(", ");
    e(`alr:${a.id}/fires`, a, `a world with the fault seeded fires it once, to ${to}, when ${String(a.condition)}`);
    e(`alr:${a.id}/quiet`, a, "a healthy world under load does not fire it");
    e(`alr:${a.id}/clears`, a, "when the fault is repaired, it clears");
  }
  for (const d of of(b, "dashboard")) {
    if (d.where !== "portal") e(`dsh:${d.id}/synced`, d, `the live ${String(d.where)} dashboard equals the record, tile for tile`);
    e(`dsh:${d.id}/shows`, d, "opened, every tile renders a value, and a screenshot is kept");
  }
  return out;
};
