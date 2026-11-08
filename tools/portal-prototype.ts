// node --experimental-strip-types tools/portal-prototype.ts [docs/design/portal-prototype.html]
//
// A throwaway prototype of the portal (docs/design/portal.md), generated from the real records so the design can be
// seen: the overview, Review (the decisions waiting for review first), every concept and operation page, a record page
// for the payments concept's records and the errors, the scoreboard and the CLI surface, in one self-contained page
// with hash routing. It is not the portal's code: D0 builds that in packages/generate and packages/portal.
//
// Verdicts are MOCK until B2 (the eval harness). The stands' specify and decide steps are computed from the real
// records (gaps, and the decisions waiting for review); build, observe and done read mock verdicts. The page's
// "Verdicts: none yet" switch shows the stands as the real records give them today.

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { buildBook, type AnyRecord } from "../packages/book/src/index.ts";
import { recordsOf, sharedModules } from "../books/target/shared/index.ts";
import * as target from "../books/target/index.ts";
import { frozen, frozenFlags, frozenGlobalFlags, type FrozenId } from "../books/frozen/index.ts";

type R = AnyRecord & Record<string, any>;
const out = process.argv[2] ?? "docs/design/portal-prototype.html";
const FEATURED_CONCEPT = "payments";
const FEATURED_OP = "payment.send";

const book = buildBook({ name: target.name, stage: target.stage, records: target.records as unknown[] });
const REC = book.records as ReadonlyMap<string, R>;
const key = (r: { _kind: string; id: string }) => `${r._kind}:${r.id}`;
const all = (kind: string) => [...REC.values()].filter((r) => r._kind === kind);
const git = (cmd: string) => {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
};

// ── which concept each record belongs to: the concept folder whose module list exports it ───────────────────────
const conceptIds = all("concept").map((c) => c.id);
const conceptOf = new Map<string, string>();
for (const c of conceptIds) {
  const mod = (await import(`../books/target/${c}/index.ts`)) as { modules: readonly object[] };
  for (const r of recordsOf(mod.modules) as R[]) conceptOf.set(key(r), c);
}
for (const r of recordsOf(sharedModules) as R[]) if (!conceptOf.has(key(r))) conceptOf.set(key(r), "shared");
const parentOf = (r: R) =>
  r._kind === "transition" ? `machine:${r.machine}` : r._kind === "call" ? `integration:${r.integration}` :
  r._kind === "function" || r._kind === "chainEvent" ? `contract:${r.contract}` : r._kind === "machine" ? key(r.table) : null;
for (const r of REC.values())
  if (!conceptOf.has(key(r))) {
    const p = parentOf(r);
    conceptOf.set(key(r), (p && conceptOf.get(p)) ?? "shared");
  }

// ── build-order layers: the longest dependency path under each concept ─────────────────────────────────────────
const deps = new Map(all("concept").map((c) => [c.id, (c.dependsOn as R[]).map((d) => d.id)]));
const layerOf = new Map<string, number>();
const layer = (id: string): number => {
  if (!layerOf.has(id)) layerOf.set(id, Math.max(-1, ...(deps.get(id) ?? []).map(layer)) + 1);
  return layerOf.get(id)!;
};
conceptIds.forEach(layer);
const ORDER = [...conceptIds].sort((a, b) => layer(a) - layer(b) || conceptIds.indexOf(a) - conceptIds.indexOf(b));

// ── the records under an operation (portal.stand) ───────────────────────────────────────────────────────────────
const linksFrom = new Map<string, { field: string; to: string }[]>();
for (const l of book.links) {
  if (!linksFrom.has(l.from)) linksFrom.set(l.from, []);
  linksFrom.get(l.from)!.push(l);
}
const FOLLOW: Record<string, string[]> = {
  operation: ["implementedBy", "errors", "refusals"],
  flow: ["steps", "errors", "calls"],
  rpc: ["reads", "writes", "drives", "invokes", "calls", "chain", "errors"],
  procedure: ["reads", "writes", "drives", "invokes", "errors"],
  workflow: ["reads", "writes", "drives", "invokes", "calls", "chain"],
};
/** The durable processes an rpc or a transition starts (its trigger) or resumes (its signals). */
const startedBy = new Map<string, string[]>();
const addStart = (from: string, w: string) => {
  if (!startedBy.has(from)) startedBy.set(from, []);
  startedBy.get(from)!.push(w);
};
for (const w of all("workflow")) {
  const t = w.trigger as Record<string, R>;
  if (t.after) addStart(key(t.after), key(w));
  if (t.transition) addStart(key(t.transition), key(w));
  for (const s of (w.signals ?? []) as R[]) addStart(key(s), key(w));
}
const under = (start: string, withProcesses: boolean): Set<string> => {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const k = stack.pop()!;
    if (seen.has(k)) continue;
    seen.add(k);
    const r = REC.get(k);
    if (!r) continue;
    const p = parentOf(r);
    if (p) stack.push(p);
    for (const l of linksFrom.get(k) ?? []) if (FOLLOW[r._kind]?.includes(l.field)) stack.push(l.to);
  }
  // One hop: the processes the operation's own rpcs and transitions start or resume, with their own records.
  if (withProcesses) for (const k of [...seen]) for (const w of startedBy.get(k) ?? []) for (const x of under(w, false)) seen.add(x);
  return seen;
};
/** The operation's own records: itself, what implements it and, for a flow, its steps' rpcs. */
const ownOf = (o: R) => {
  const impl = o.implementedBy as R;
  const steps = impl._kind === "flow" ? ((REC.get(key(impl))?.steps ?? []) as { rpc?: R }[]).filter((s) => s.rpc).map((s) => key(s.rpc!)) : [];
  return [key(o), key(impl), ...steps];
};

// ── decisions waiting for review: the rule of tools/report-judgments.ts until portal.review-state lands ──────────
const FLAGGED = ["payroll.scope", "payments.birth-width", "parties.directory-tenancy", "procedures.accounts-admit", "documents.acceptance-rewrites", "agents.org-owned", "board.failed-proposal", "equity.acceptance", "contacts.members-write", "notices.claim-escrow", "system.size"];
const CARRIES_OUT = ["rules.frozen-flags-kept", "rules.frozen-flags-built-ins"];
const byAaron = (d: R) => /^Aaron\b/.test(String(d.source));
const waiting = (d: R) => !byAaron(d) && !CARRIES_OUT.includes(d.id) && (FLAGGED.includes(d.id) || /\baaron\b/i.test(`${d.title} ${d.question} ${d.why} ${d.chosen}`));
const decisions = all("decision");
const affectedBy = new Map<string, string[]>();
for (const d of decisions)
  for (const a of d.affects as R[]) {
    if (!affectedBy.has(key(a))) affectedBy.set(key(a), []);
    affectedBy.get(key(a))!.push(d.id);
  }
const isWaiting = new Map(decisions.map((d) => [d.id, waiting(d)]));
const homeOf = (id: string) => (conceptIds.includes(id.split(".")[0]!) ? id.split(".")[0]! : "shared");

// ── mock verdicts, deterministic: a record is "built" by its concept's build-order layer ─────────────────────────
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
};
const builtP = (L: number) => (L <= 4 ? 1 : L <= 7 ? 0.92 : L <= 10 ? 0.5 : 0.08);
const builtRec = (k: string) => {
  const c = conceptOf.get(k) ?? "shared";
  return hash(`built:${k}`) < builtP(c === "shared" ? 0 : layer(c));
};
type Mock = { result: "pass" | "fail" | "unknown"; measures?: Record<string, number> };
const mockOf = (e: { id: string; subject: string }, budgetP95?: number): Mock => {
  if (!builtRec(e.subject)) return { result: "unknown" };
  if (e.id.startsWith("bud:") && budgetP95) {
    const p95 = Math.round(budgetP95 * (0.35 + hash(`m:${e.id}`) * 0.75));
    return { result: p95 <= budgetP95 ? "pass" : "fail", measures: { p95_ms: p95, p50_ms: Math.round(p95 * 0.45), n: 40 } };
  }
  return { result: hash(`v:${e.id}`) < 0.006 ? "fail" : "pass" };
};

// ── schema values as readable types ─────────────────────────────────────────────────────────────────────────────
const typeOf = (ast: any, depth = 0): string => {
  if (!ast || depth > 3) return "…";
  switch (ast._tag) {
    case "String": return "string";
    case "Number": return "number";
    case "Boolean": return "boolean";
    case "BigInt": return "bigint";
    case "Unknown": case "Any": return "unknown";
    case "Null": return "null";
    case "Undefined": case "Void": return "undefined";
    case "Literal": return JSON.stringify(ast.literal);
    case "Union": {
      const ts = (ast.types ?? []).map((t: any) => typeOf(t, depth + 1));
      return ts.length > 6 ? `${ts.slice(0, 6).join(" | ")} | …` : ts.join(" | ");
    }
    case "Arrays": {
      const rest = ast.rest?.[0];
      if (rest) return `${typeOf(rest, depth + 1)}[]`;
      return `[${(ast.elements ?? []).map((e: any) => typeOf(e?.type ?? e, depth + 1)).join(", ")}]`;
    }
    case "Objects": {
      const ps = ast.propertySignatures ?? [];
      if (!ps.length) return "{}";
      return `{ ${ps.slice(0, 8).map((p: any) => `${String(p.name)}${p.type?.context?.isOptional ? "?" : ""}: ${typeOf(p.type, depth + 1)}`).join("; ")}${ps.length > 8 ? "; …" : ""} }`;
    }
    case "Suspend": return "recursive";
    case "Declaration": return "schema";
    default: return String(ast._tag ?? "?").toLowerCase();
  }
};
const shapeOf = (s: any) => (s?.ast ? typeOf(s.ast) : "");
const fieldsOf = (s: any) => {
  const ps = s?.ast?.propertySignatures;
  if (!Array.isArray(ps)) return s?.ast ? [["(value)", typeOf(s.ast), false]] : [];
  return ps.map((p: any) => [String(p.name), typeOf(p.type, 1), !!p.type?.context?.isOptional]);
};
const keys = (u: unknown) => (Array.isArray(u) ? u : []).filter(Boolean).map((x: any) => key(x));

// ── the record index: every record once, so pages cite records by number ────────────────────────────────────────
const KEYS = [...REC.keys()].sort();
const IDX = new Map(KEYS.map((k, i) => [k, i]));
const titleOf = (r: R) => String(r.title ?? r.sdk ?? r.command ?? r.id);
const recIndex = KEYS.map((k) => [titleOf(REC.get(k)!), conceptOf.get(k) ?? "shared"]);
const ix = (ks: Iterable<string>) => [...ks].map((k) => IDX.get(k)).filter((n): n is number => n !== undefined).sort((a, b) => a - b);

// ── operations ──────────────────────────────────────────────────────────────────────────────────────────────────
const evalsBy = new Map<string, typeof book.evals[number][]>();
for (const e of book.evals) {
  if (!evalsBy.has(e.subject)) evalsBy.set(e.subject, []);
  evalsBy.get(e.subject)!.push(e);
}
const gapsBy = new Map<string, typeof book.gaps[number][]>();
for (const g of book.gaps) {
  if (!gapsBy.has(g.record)) gapsBy.set(g.record, []);
  gapsBy.get(g.record)!.push(g);
}
const journeysOf = new Map<string, string[]>();
for (const j of all("journey"))
  for (const s of j.steps as { operation: R }[]) {
    const k = key(s.operation);
    if (!journeysOf.has(k)) journeysOf.set(k, []);
    if (!journeysOf.get(k)!.includes(j.id)) journeysOf.get(k)!.push(j.id);
  }
const CONST_CLAIMS: Record<string, string> = {};
for (const e of book.evals) {
  const kind = e.id.split(":")[0]!;
  if (["ret", "spn", "doc", "des"].includes(kind)) CONST_CLAIMS[kind] ??= e.claim;
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_");
const lbl = (s: string) => s.replace(/"/g, "'");
/** The implementation chain as a flowchart: the operation, what implements it, the steps, what each rpc touches. */
const chainDiagram = (o: R) => {
  const l = ["flowchart LR", `  op["capxul ${lbl(String(o.command))}"]`];
  const impl = REC.get(key(o.implementedBy))!;
  const node = (r: R) => {
    const id = safe(key(r));
    const t = r._kind === "table" ? `${id}[("${lbl(r.id)}")]` : r._kind === "procedure" ? `${id}(["${lbl(r.id)}"])` :
      r._kind === "transition" ? `${id}{{"${lbl(r.id)}"}}` : r._kind === "workflow" ? `${id}>"${lbl(r.id)}"]` : `${id}["${lbl(r.sdk ?? r.id)}"]`;
    l.push(`  ${t}`);
    return id;
  };
  const implId = node(impl);
  l.push(`  op --> ${implId}`);
  const rpcs: R[] = impl._kind === "flow" ? ((impl.steps ?? []) as { name: string; rpc?: R }[]).filter((s) => s.rpc).map((s) => {
    const r = REC.get(key(s.rpc!))!;
    l.push(`  ${implId} -->|${safe(s.name)}| ${node(r)}`);
    return r;
  }) : [impl];
  for (const r of rpcs) {
    const from = safe(key(r));
    for (const p of (r.invokes ?? []) as R[]) l.push(`  ${from} --> ${node(REC.get(key(p))!)}`);
    for (const t of (r.writes ?? []) as R[]) l.push(`  ${from} --> ${node(REC.get(key(t))!)}`);
    for (const t of (r.drives ?? []) as R[]) {
      const tr = REC.get(key(t))!;
      l.push(`  ${from} -.-> ${node(tr)}`);
      for (const w of startedBy.get(key(tr)) ?? []) l.push(`  ${safe(key(tr))} --> ${node(REC.get(w)!)}`);
    }
    for (const w of startedBy.get(key(r)) ?? []) l.push(`  ${from} ==> ${node(REC.get(w)!)}`);
  }
  return [...new Set(l)].join("\n");
};

const ops: Record<string, unknown>[] = [];
const standCount = { mock: {} as Record<string, number>, none: {} as Record<string, number> };
for (const o of all("operation")) {
  const k = key(o);
  const concept = conceptOf.get(k) ?? "shared";
  const below = under(k, true);
  below.delete(k);
  const gaps = [...below, k].flatMap((x) => (gapsBy.get(x) ?? []).map((g) => [g.record, g.rule, g.detail]));
  const own = ownOf(o);
  const waitOwn = [...new Set(own.flatMap((x) => affectedBy.get(x) ?? []))].filter((d) => isWaiting.get(d));
  const touch = [...new Set([...below].flatMap((x) => affectedBy.get(x) ?? []))].filter((d) => isWaiting.get(d) && !waitOwn.includes(d));
  const decAll = [...new Set(own.flatMap((x) => affectedBy.get(x) ?? []))];
  const p95 = (o.budget as { p95Ms?: number } | undefined)?.p95Ms;
  const ownEvals = (evalsBy.get(k) ?? []).map((e) => {
    const m = mockOf(e, p95);
    const kind = e.id.split(":")[0]!;
    const claim = kind in CONST_CLAIMS || kind === "acc" ? null : e.claim;
    return [e.id.replace(`:${o.id}`, ""), e.decider, m.result, claim, m.measures ?? null];
  });
  const underEvals: Record<string, [number, number, number]> = {};
  const featuredUnder: unknown[] = [];
  for (const x of below)
    for (const e of evalsBy.get(x) ?? []) {
      const kind = e.id.split(":")[0]!;
      const m = mockOf(e, (REC.get(x)?.budget as { p95Ms?: number } | undefined)?.p95Ms);
      const c = (underEvals[kind] ??= [0, 0, 0]);
      c[0]++;
      if (m.result === "pass") c[1]++;
      if (m.result === "fail") c[2]++;
      if (o.id === FEATURED_OP) featuredUnder.push([e.id, e.decider, m.result, e.claim, e.subject]);
    }
  const allPass = ownEvals.every((e) => e[2] === "pass") && Object.values(underEvals).every(([t, p]) => t === p);
  const live = allPass && layer(concept) <= 5 && hash(`live:${o.id}`) < 0.6 ? "pass" : "unknown";
  const none = gaps.length ? "specify" : waitOwn.length ? "decide" : "build";
  const mock = none !== "build" ? none : !allPass ? "build" : live !== "pass" ? "observe" : "done";
  standCount.mock[mock] = (standCount.mock[mock] ?? 0) + 1;
  standCount.none[none] = (standCount.none[none] ?? 0) + 1;
  const impl = REC.get(key(o.implementedBy))!;
  const ff = frozenFlags(o.id as FrozenId) as any;
  const kept = (frozen[o.id as FrozenId]?.acceptance ?? []).map((a: any) => String(a.claim));
  const b = o.budget as { class: string; p50Ms: number; p95Ms: number; why?: string } | undefined;
  ops.push({
    id: o.id, title: o.title, about: o.about, command: o.command, area: o.area, concept, priority: o.priority, who: o.who,
    changes: o.changes ?? null, notes: o.notes ?? [], mistakes: o.mistakes ?? [],
    impl: key(impl), sdk: impl.sdk ?? null,
    steps: impl._kind === "flow" ? (impl.steps as any[]).map((s) => [s.name, s.rpc ? key(s.rpc) : `local:${s.local}`]) : [],
    acceptance: (o.acceptance as any[]).map((a, i) => (a === null ? null : typeof a === "string" ? { c: a, o: "", k: kept[i] === a } : { c: a.claim, o: a.observes, k: kept[i] === a.claim })),
    refusals: (o.refusals as any[]).map((f) => [f.error.id, f.given, f.when]),
    errors: keys(o.errors).map((x) => x.split(":")[1]),
    budget: b ? [b.class, b.p50Ms, b.p95Ms, b.why ?? null] : null,
    returns: shapeOf(o.returns),
    flags: ff ? { inCli: ff.inCli, args: (ff.arguments ?? []).map((a: any) => [a.name, a.required, a.variadic, a.description]), flags: (ff.flags ?? []).map((f: any) => [f.flag, f.alias, f.takesValue ? (f.metavar ?? f.type) : null, f.default, f.required, f.description]) } : null,
    journeys: journeysOf.get(k) ?? [],
    under: ix(below), gaps, waitOwn, touch, decAll,
    evals: ownEvals, underEvals, live,
    stand: { mock, none },
    diagram: concept === FEATURED_CONCEPT ? chainDiagram(o) : null,
    featuredUnder: o.id === FEATURED_OP ? featuredUnder : undefined,
  });
}

// ── concepts ────────────────────────────────────────────────────────────────────────────────────────────────────
const KIND_ORDER = ["operation", "flow", "rpc", "procedure", "workflow", "table", "machine", "event", "decision"];
const concepts = ORDER.map((c) => {
  const cr = REC.get(`concept:${c}`)!;
  const mine = [...REC.keys()].filter((k) => conceptOf.get(k) === c && !k.startsWith("transition:"));
  const records: Record<string, number[]> = {};
  for (const kind of KIND_ORDER) records[kind] = ix(mine.filter((k) => k.startsWith(`${kind}:`)));
  return {
    id: c, title: cr.title, about: cr.about, component: key(cr.component), dependsOn: (cr.dependsOn as R[]).map((d) => d.id), layer: layer(c),
    records, gaps: mine.flatMap((k) => (gapsBy.get(k) ?? []).map((g) => [g.record, g.rule, g.detail])),
    evals: mine.reduce((n, k) => n + (evalsBy.get(k)?.length ?? 0), 0),
  };
});
const reach = (from: string, to: string, skip: string): boolean => {
  const seen = new Set<string>();
  const stack = (deps.get(from) ?? []).filter((d) => d !== skip);
  while (stack.length) {
    const n = stack.pop()!;
    if (n === to) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(deps.get(n) ?? []));
  }
  return false;
};
const conceptMap = ORDER.flatMap((c) => (deps.get(c) ?? []).filter((d) => !reach(c, d, d)).map((d) => [c, d]));

// ── decisions: every one slim; the full text for those waiting, the portal's, the featured concept's and those on
//    the featured operation's own records ──────────────────────────────────────────────────────────────────────────
const featuredOwn = new Set(ownOf(REC.get(`operation:${FEATURED_OP}`)!).flatMap((x) => affectedBy.get(x) ?? []));
const chosenText = (d: R) => (d.options as { label: string; text: string }[]).find((o) => o.label === d.chosen)?.text ?? String(d.chosen);
const heldOwn = new Map<string, string[]>();
const touches = new Map<string, number>();
for (const o of ops as any[]) {
  for (const d of o.waitOwn) heldOwn.set(d, [...(heldOwn.get(d) ?? []), o.id]);
  for (const d of o.touch) touches.set(d, (touches.get(d) ?? 0) + 1);
}
const decisionRows = decisions.map((d) => {
  const full = isWaiting.get(d.id) || d.id.startsWith("portal.") || homeOf(d.id) === FEATURED_CONCEPT || featuredOwn.has(d.id);
  const ct = chosenText(d);
  return {
    id: d.id, title: d.title, home: homeOf(d.id), chosen: d.chosen, chosenText: full || ct.length <= 240 ? ct : `${ct.slice(0, 237)}…`,
    waiting: !!isWaiting.get(d.id), byAaron: byAaron(d), affects: ix((d.affects as R[]).map(key)),
    held: heldOwn.get(d.id) ?? [], touches: (touches.get(d.id) ?? 0) + (heldOwn.get(d.id)?.length ?? 0),
    full: full ? { question: d.question, options: d.options, why: d.why, source: d.source } : null,
  };
});

// ── the featured concept's records, in full ─────────────────────────────────────────────────────────────────────
const view = (r: R): Record<string, unknown> => {
  const base = { kind: r._kind, id: r.id, title: titleOf(r), about: r.about ?? "" };
  switch (r._kind) {
    case "table":
      return { ...base, tenancy: r.tenancy, tenantField: r.tenantField, scope: r.scope, key: r.key, retention: r.retention, fields: fieldsOf(r.fields), indexes: (r.indexes ?? []).map((i: any) => [i.name, i.fields, !!i.unique, i.for ?? ""]), admits: (r.admits ?? []).length };
    case "machine":
      return { ...base, table: key(r.table), field: r.field, initial: r.initial, states: (r.states ?? []).map((s: any) => [s.id, !!s.terminal]),
        transitions: Object.entries(r.transitions ?? {}).map(([name, t]: [string, any]) => [name, t.from ?? [], t.to, keys(t.emits), t.guard ?? ""]) };
    case "workflow":
      return { ...base, trigger: Object.entries(r.trigger ?? {}).map(([k, v]: [string, any]) => `${k}: ${typeof v === "string" ? v : key(v)}`).join(", "),
        instance: r.instance === "singleton" ? "one for the system" : r.instance?.per ? `one per row of ${r.instance.per.id}` : "",
        signals: keys(r.signals), waits: (r.waits ?? []).map((w: any) => [w.name, w.for, w.timeoutMs ?? null, w.about]), steps: (r.steps ?? []).map((s: any) => [s.name, s.about]),
        idempotency: r.idempotency, writes: keys(r.writes), drives: keys(r.drives), invokes: keys(r.invokes), calls: keys(r.calls), budget: r.budget ?? null };
    case "rpc":
      return { ...base, rpcKind: r.kind, who: r.who, input: shapeOf(r.input), output: shapeOf(r.output), errors: keys(r.errors), reads: keys(r.reads), writes: keys(r.writes),
        drives: keys(r.drives), invokes: keys(r.invokes), calls: keys(r.calls), chain: keys(r.chain), budget: r.budget ?? null };
    case "procedure":
      return { ...base, input: shapeOf(r.input), output: shapeOf(r.output), errors: keys(r.errors), reads: keys(r.reads), writes: keys(r.writes), drives: keys(r.drives), invokes: keys(r.invokes) };
    case "flow":
      return { ...base, sdk: r.sdk, input: shapeOf(r.input), output: shapeOf(r.output), steps: (r.steps ?? []).map((s: any) => [s.name, s.rpc ? key(s.rpc) : `local:${s.local}`, s.about ?? ""]), errors: keys(r.errors), budget: r.budget ?? null };
    case "event":
      return { ...base, props: fieldsOf(r.props) };
    default:
      return base;
  }
};
const featuredRecords: Record<string, unknown> = {};
for (const k of KEYS) if (conceptOf.get(k) === FEATURED_CONCEPT && !k.startsWith("transition:") && !k.startsWith("operation:") && !k.startsWith("decision:")) featuredRecords[k] = view(REC.get(k)!);

// ── the shared records a page needs ─────────────────────────────────────────────────────────────────────────────
const system = all("system")[0]!;
const data = {
  meta: {
    commit: git("git rev-parse --short=12 HEAD"), branch: git("git rev-parse --abbrev-ref HEAD"), built: new Date().toISOString().slice(0, 10),
    records: REC.size, evals: book.evals.length, problems: book.problems.length, gaps: book.gaps.length,
    counts: Object.fromEntries(["concept", "operation", "flow", "rpc", "procedure", "workflow", "table", "machine", "event", "error", "integration", "contract", "journey", "decision"].map((k) => [k, all(k).length])),
    featured: { concept: FEATURED_CONCEPT, op: FEATURED_OP }, standCount,
  },
  claims: CONST_CLAIMS,
  keys: KEYS, rec: recIndex,
  system: { title: system.title, about: system.about, actors: (system.actors as any[]).map((a) => [a.id, a.kind, a.about]), surfaces: system.surfaces },
  components: all("component").map((c) => ({ id: c.id, title: c.title, runtime: c.runtime, exposes: c.exposes, dependsOn: (c.dependsOn as R[]).map((d) => d.id) })),
  environments: all("environment").map((e) => ({ id: e.id, title: e.title, about: e.about, runs: (e.runs as any[]).map((x) => [x.component.id, x.on]), config: e.config, secrets: e.secrets, deploy: e.deploy, bootMs: e.bootMs ?? null })),
  concepts, conceptMap, ops, decisions: decisionRows, featuredRecords,
  errors: all("error").map((e) => [e.id, e.title, e.class, e.actor, e.exit, e.retryable, e.message]),
  globalFlags: [...((frozenGlobalFlags as any).declared ?? []), ...((frozenGlobalFlags as any).builtIn ?? [])].map((f: any) => [f.flag, f.alias ?? null, f.description ?? ""]),
  journeys: all("journey").map((j) => [j.id, j.title, (j.steps as any[]).map((s) => s.operation.id)]),
  milestones: [
    ["D0", "The portal", "generated from the records, deployed privately; Review, every record page, the stand, the CLI surface", "designed"],
    ["B0", "Spike: durable execution", "Effect Workflow on Postgres: kill and resume, a signal, a timer, wake routing", "not started"],
    ["B1", "Generators", "flags designed book first; migrations, schemas, RpcGroup, SDK client, CLI wiring, catalogues", "not started"],
    ["B2", "Eval harness", "evals.json run end to end on a devnet; RunResult[]; real verdicts reach the portal", "not started"],
    ["B3", "Spine and pilots", "the devnet and the runtime; sign in, set up an Account, send a payment", "not started"],
    ["B4", "Concepts on the critical path", "every concept in dependency layers until the scoreboard is green", "not started"],
    ["B5", "New staging", "deploy, run the suite, watch the live evals for a week", "not started"],
  ],
};

// ── the page ────────────────────────────────────────────────────────────────────────────────────────────────────
const PAGE: string = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Capxul Portal Prototype</title>
<style>
:root{--bg:#f4f5f7;--surface:#fff;--sunk:#eef0f3;--fg:#151a21;--muted:#5b6574;--line:#d8dde4;--accent:#1f5fbf;--accent-soft:#e3ecfa;
--specify:#6b7280;--specify-soft:#eceef1;--decide:#a15c00;--decide-soft:#fbefdc;--build:#1f5fbf;--build-soft:#e3ecfa;--observe:#0b7f7a;--observe-soft:#dcf2f0;--done:#1e7a46;--done-soft:#dff1e6;--fail:#b42318;--fail-soft:#fde6e3;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--body:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0e1116;--surface:#161b22;--sunk:#11151b;--fg:#e6eaef;--muted:#97a2b0;--line:#2a313b;--accent:#7aa7ff;--accent-soft:#16243d;
--specify:#a3abb7;--specify-soft:#23272e;--decide:#f0b35a;--decide-soft:#33260f;--build:#7aa7ff;--build-soft:#16243d;--observe:#4fd1c5;--observe-soft:#0f2e2c;--done:#6fd39a;--done-soft:#123020;--fail:#ff8a7a;--fail-soft:#3a1714;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0e1116;--surface:#161b22;--sunk:#11151b;--fg:#e6eaef;--muted:#97a2b0;--line:#2a313b;--accent:#7aa7ff;--accent-soft:#16243d;
--specify:#a3abb7;--specify-soft:#23272e;--decide:#f0b35a;--decide-soft:#33260f;--build:#7aa7ff;--build-soft:#16243d;--observe:#4fd1c5;--observe-soft:#0f2e2c;--done:#6fd39a;--done-soft:#123020;--fail:#ff8a7a;--fail-soft:#3a1714;color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--fg);font:15px/1.55 var(--body)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
code,.mono{font-family:var(--mono);font-size:13px}
header.top{position:sticky;top:0;z-index:5;background:var(--surface);border-bottom:1px solid var(--line)}
.bar{max-width:1240px;margin:0 auto;padding:10px 16px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px}
.brand{font-weight:700;letter-spacing:-.01em;margin-right:6px;color:var(--fg)}
.brand span{color:var(--muted);font-weight:500}
nav.sections{display:flex;flex-wrap:wrap;gap:2px}
nav.sections a{padding:5px 10px;border-radius:6px;color:var(--fg);font-size:14px}
nav.sections a.on{background:var(--accent-soft);color:var(--accent);font-weight:600}
.mode{margin-left:auto;display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)}
.mode button{font:inherit;border:1px solid var(--line);background:var(--surface);color:var(--fg);padding:3px 9px;border-radius:6px;cursor:pointer}
.mode button.on{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.banner{max-width:1240px;margin:0 auto;padding:7px 16px;font-size:13px;color:var(--decide);background:var(--decide-soft);border-top:1px solid var(--line)}
main{max-width:1240px;margin:0 auto;padding:22px 16px 80px}
.cols{display:grid;grid-template-columns:220px minmax(0,1fr);gap:28px}
@media (max-width:900px){.cols{grid-template-columns:minmax(0,1fr)}.rail{display:none}}
.rail{position:sticky;top:110px;align-self:start;max-height:calc(100vh - 130px);overflow:auto;font-size:14px}
.rail h4{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:14px 0 6px}
.rail a{display:flex;justify-content:space-between;gap:8px;padding:3px 8px;border-radius:5px;color:var(--fg)}
.rail a.on{background:var(--accent-soft);color:var(--accent);font-weight:600}
.rail a small{color:var(--muted);font-family:var(--mono)}
h1{font-size:clamp(24px,3.4vw,34px);line-height:1.15;margin:0 0 6px;letter-spacing:-.015em;text-wrap:balance}
h1.cmd{font-family:var(--mono);font-size:clamp(20px,3vw,28px);font-weight:600}
h2{font-size:19px;margin:30px 0 10px;text-wrap:balance;scroll-margin-top:120px}
h3{font-size:15px;margin:0}
.crumb{font-size:13px;color:var(--muted);margin-bottom:6px}
.lede{color:var(--muted);max-width:78ch;margin:0 0 16px}
.muted{color:var(--muted)}.small{font-size:13px}
.chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.chip{display:inline-flex;align-items:center;gap:4px;font:12px var(--mono);padding:1px 8px;border-radius:999px;background:var(--sunk);color:var(--muted);border:1px solid var(--line);white-space:nowrap}
.chip.warn{background:var(--decide-soft);color:var(--decide);border-color:transparent}
.chip.bad{background:var(--fail-soft);color:var(--fail);border-color:transparent}
.chip.good{background:var(--done-soft);color:var(--done);border-color:transparent}
.stand{display:inline-flex;align-items:center;gap:6px;font:600 12px var(--body);padding:2px 9px;border-radius:999px;white-space:nowrap}
.stand::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.s-specify{color:var(--specify);background:var(--specify-soft)}.s-decide{color:var(--decide);background:var(--decide-soft)}.s-build{color:var(--build);background:var(--build-soft)}.s-observe{color:var(--observe);background:var(--observe-soft)}.s-done{color:var(--done);background:var(--done-soft)}
.r-pass{color:var(--done)}.r-fail{color:var(--fail);font-weight:600}.r-unknown{color:var(--muted)}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin:14px 0}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:11px 12px}
.tile b{display:block;font:600 22px/1.15 var(--mono);font-variant-numeric:tabular-nums}.tile span{color:var(--muted);font-size:12px}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin:10px 0;min-width:0}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.card{display:grid;gap:6px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px 14px;color:inherit;min-width:0}
a.card:hover{border-color:var(--accent);text-decoration:none}
.strip{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.strip button{font:inherit;display:flex;align-items:center;gap:8px;border:1px solid var(--line);background:var(--surface);color:var(--fg);border-radius:8px;padding:6px 10px;cursor:pointer}
.strip button.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
.strip b{font:600 16px var(--mono)}
.bar-stack{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--sunk);min-width:80px}
.bar-stack i{display:block;height:100%}
.ladder{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin:8px 0}
@media (max-width:640px){.ladder{grid-template-columns:minmax(0,1fr)}}
.rung{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--surface);font-size:13px;min-width:0}
.rung b{display:block;font-size:13px;margin-bottom:2px}
.rung.met{border-color:var(--done)}.rung.here{border-width:2px}
.rung.here.s-specify,.rung.here.s-decide,.rung.here.s-build,.rung.here.s-observe,.rung.here.s-done{border-color:currentColor}
.rung .why{color:var(--muted)}
table.t{width:100%;border-collapse:collapse;font-size:13px}
table.t th,table.t td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
table.t th{color:var(--muted);font-weight:500;font-size:12px;white-space:nowrap}
table.t tr.group td{background:var(--sunk);font-weight:600}
table.t td.num{font-family:var(--mono);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.scroll{overflow-x:auto}
details.rec{background:var(--surface);border:1px solid var(--line);border-radius:8px;margin:8px 0;min-width:0}
details.rec>summary{cursor:pointer;padding:10px 14px;display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;list-style:none}
details.rec>summary::-webkit-details-marker{display:none}
details.rec[open]>summary{border-bottom:1px solid var(--line)}
.body{padding:12px 14px;display:grid;gap:10px;min-width:0}
dl.kv{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:5px 16px;margin:0;font-size:14px}
dl.kv dt{color:var(--muted)}dl.kv dd{margin:0;min-width:0;overflow-wrap:anywhere}
ol.claims{margin:0;padding-left:22px}ol.claims li{margin:6px 0}
.obs{color:var(--muted);font-size:13px}
.diagram{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto}
.search{width:100%;max-width:520px;font:inherit;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--fg);margin:4px 0 12px}
.toc{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 4px}
.toc button,.btn{font:inherit;font-size:13px;border:1px solid var(--line);background:var(--surface);color:var(--fg);padding:4px 10px;border-radius:6px;cursor:pointer}
.btn.primary{border-color:var(--accent);background:var(--accent);color:#fff}
.btn.quiet{color:var(--accent)}
.actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
dialog{max-width:640px;width:calc(100% - 32px);border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--fg);padding:18px}
dialog::backdrop{background:rgba(0,0,0,.35)}
pre.payload{background:var(--sunk);border:1px solid var(--line);border-radius:6px;padding:10px;overflow:auto;font:12px var(--mono);white-space:pre-wrap}
textarea{width:100%;min-height:70px;font:inherit;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);padding:8px}
select{font:inherit;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);padding:4px 6px}
.note{font-size:13px;color:var(--muted)}
.callout{border-left:3px solid var(--decide);background:var(--decide-soft);padding:8px 12px;border-radius:0 6px 6px 0;font-size:14px;margin:10px 0}
.mstone{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.mstone>div{border:1px solid var(--line);border-radius:8px;padding:9px 10px;background:var(--surface);font-size:13px}
.mstone b{font-family:var(--mono)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
</style>
</head>
<body>
<header class="top">
  <div class="bar">
    <a class="brand" href="#/">Capxul <span>portal</span></a>
    <nav class="sections" id="sections"></nav>
    <div class="mode">Verdicts <button id="m-mock">Mock</button><button id="m-none">None yet</button></div>
  </div>
  <div class="banner" id="banner"></div>
</header>
<main id="main"></main>
<dialog id="dlg"></dialog>
<script src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js"></script>
<script>
var D=/*__DATA__*/null;
var MODE="mock";try{MODE=localStorage.getItem("portal-mode")||"mock"}catch(e){}
function $(t,a){var e=document.createElement(t);a=a||{};for(var x in a){var v=a[x];if(v==null||v===false)continue;if(x.slice(0,2)==="on")e.addEventListener(x.slice(2),v);else if(x==="class")e.className=v;else if(x==="html")e.innerHTML=v;else e.setAttribute(x,v===true?"":v)}for(var i=2;i<arguments.length;i++)add(e,arguments[i]);return e}
function add(e,c){if(c==null||c===false)return;if(Array.isArray(c)){c.forEach(function(x){add(e,x)});return}e.append(c.nodeType?c:document.createTextNode(String(c)))}
var OPS={};D.ops.forEach(function(o){OPS[o.id]=o});
var DEC={};D.decisions.forEach(function(d){d.affects=d.affects.map(function(i){return D.keys[i]});DEC[d.id]=d});
var CON={};D.concepts.forEach(function(c){CON[c.id]=c});
var ERR={};D.errors.forEach(function(e){ERR[e[0]]=e});
var STANDS=["specify","decide","build","observe","done"];
var LABEL={specify:"Not specified",decide:"Awaiting a judgment",build:"Specified, not proven",observe:"Proven, live unseen",done:"Done"};
var MEANS={specify:"the operation, or a record under it, has a gap (or a problem)",decide:"a judgment on the operation or its implementation waits for review",build:"its design is complete, but not every eval of it and of the records under it passes",observe:"every eval passes on the devnet; its live evals on staging do not hold yet",done:"its live evals hold"};
function standOf(o){return o.stand[MODE]}
function standChip(s){return $("span",{class:"stand s-"+s,title:MEANS[s]},s+" · "+LABEL[s])}
function res(r){return MODE==="none"?"unknown":r}
function rk(k){var i=D.keys.indexOf(k);return i<0?null:D.rec[i]}
function recHref(k){var kind=k.split(":")[0],id=k.slice(kind.length+1);if(kind==="operation")return "#/operation/"+id;if(kind==="decision")return "#/decision/"+id;if(kind==="concept")return "#/concept/"+id;return "#/record/"+kind+"/"+id}
function recLink(k){var r=rk(k);var id=k.slice(k.indexOf(":")+1);return $("a",{href:recHref(k),title:(r?r[0]:"")+(r?" · "+r[1]:"")},$("code",{},id))}
function links(ks){return ks&&ks.length?$("span",{class:"chips"},ks.map(function(k){return recLink(k)})):$("span",{class:"muted"},"none")}
function kv(pairs){var dl=$("dl",{class:"kv"});pairs.forEach(function(p){if(p[1]==null||p[1]===""||(Array.isArray(p[1])&&!p[1].length))return;dl.append($("dt",{},p[0]),$("dd",{},p[1]))});return dl}
function bud(b){if(!b)return $("span",{class:"chip warn"},"no budget");var c=Array.isArray(b)?{class:b[0],p50Ms:b[1],p95Ms:b[2],why:b[3]}:b;return $("span",{},$("span",{class:"chip"},c.class)," p50 "+c.p50Ms+" ms · p95 "+c.p95Ms+" ms",c.why?$("span",{class:"muted small"}," ("+c.why+")"):null)}
function safe(s){return String(s).replace(/[^A-Za-z0-9_]/g,"_")}
function q(s){return String(s).replace(/"/g,"'")}
function diagram(src){return $("div",{class:"diagram"},$("pre",{class:"mermaid"},src))}
var mermaidReady=false;
function draw(){if(!window.mermaid)return;if(!mermaidReady){var t=document.documentElement.dataset.theme;var dark=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);mermaid.initialize({startOnLoad:false,theme:dark?"dark":"neutral",securityLevel:"strict",flowchart:{htmlLabels:false}});mermaidReady=true}var n=[].slice.call(document.querySelectorAll("pre.mermaid:not([data-processed])")).filter(function(x){return x.offsetParent!==null});if(n.length)mermaid.run({nodes:n}).catch(function(){})}
function counts(list){var c={};STANDS.forEach(function(s){c[s]=0});list.forEach(function(o){c[standOf(o)]++});return c}
function stackBar(c,total){var b=$("div",{class:"bar-stack",title:STANDS.map(function(s){return s+" "+c[s]}).join(", ")});STANDS.forEach(function(s){if(c[s])b.append($("i",{style:"width:"+(100*c[s]/total)+"%;background:var(--"+s+")"}))});return b}
function evalTotals(o){var t=0,p=0,f=0;o.evals.forEach(function(e){t++;var r=res(e[2]);if(r==="pass")p++;if(r==="fail")f++});var ut=0,up=0,uf=0;for(var k in o.underEvals){var u=o.underEvals[k];ut+=u[0];if(MODE!=="none"){up+=u[1];uf+=u[2]}}return{t:t,p:p,f:f,ut:ut,up:up,uf:uf}}
function p95of(o){var b=o.evals.find(function(e){return e[0].indexOf("bud/")===0});return b&&MODE!=="none"&&b[4]?b[4].p95_ms:null}
function eid(o,s){var i=s.indexOf("/");return i<0?s+":"+o.id:s.slice(0,i)+":"+o.id+s.slice(i)}
function claimOf(o,e){if(e[3])return e[3];var kind=e[0].split("/")[0];if(kind==="acc"){var n=+e[0].split("/").pop();var a=o.acceptance[n-1];return a?a.c:""}return D.claims[kind]||""}

// ── routes ───────────────────────────────────────────────────────────────────────────────────────────────
var SECTIONS=[["#/","Overview","overview"],["#/review","Review","review"],["#/design","Design","design"],["#/build","Build","build"],["#/cli","Docs","cli"],["#/operate","Operate","operate"]];
function chrome(cur){var n=document.getElementById("sections");n.replaceChildren.apply(n,SECTIONS.map(function(s){return $("a",{href:s[0],class:s[2]===cur?"on":""},s[1])}));
document.getElementById("m-mock").className=MODE==="mock"?"on":"";document.getElementById("m-none").className=MODE==="none"?"on":"";
document.getElementById("banner").textContent=MODE==="mock"?"Prototype, generated from the real records at "+D.meta.commit+". Statuses are MOCK until B2 (the eval harness): every verdict here is invented. The stands specify and decide come from the real records; build, observe and done read the invented verdicts.":"Prototype at "+D.meta.commit+", with no verdicts: what the real records give today. Until B2 every operation stands at specify, decide or build."}
function setMode(m){MODE=m;try{localStorage.setItem("portal-mode",m)}catch(e){}route()}
document.getElementById("m-mock").onclick=function(){setMode("mock")};document.getElementById("m-none").onclick=function(){setMode("none")};

function overview(){var c=counts(D.ops);var m=D.meta.counts;
var tiles=[["operations",m.operation],["concepts",m.concept],["records",D.meta.records],["derived evals",D.meta.evals],["decisions",m.decision],["waiting for review",D.decisions.filter(function(d){return d.waiting}).length],["gaps",D.meta.gaps],["problems",D.meta.problems]];
var wait=D.decisions.filter(function(d){return d.waiting}).sort(function(a,b){return b.held.length-a.held.length||b.touches-a.touches}).slice(0,5);
var comp=["flowchart LR"];D.components.forEach(function(x){comp.push("  "+safe(x.id)+'["'+q(x.title)+'"]');x.dependsOn.forEach(function(d){comp.push("  "+safe(x.id)+" --> "+safe(d))})});
var cmap=["flowchart TB"];D.concepts.forEach(function(k){cmap.push("  "+safe(k.id)+'["'+q(k.title)+'"]')});D.conceptMap.forEach(function(e){cmap.push("  "+safe(e[0])+" --> "+safe(e[1]))});
var flow=["flowchart LR",'  book["Design book records"] -->|build time| gen["packages/generate: portal target"]','  prose["Hand-written prose"] --> site','  gen --> site["Static portal: every page, with md and json twins"]','  runs["Eval runs: RunResult[] from B2"] --> status["Status document at a commit"]','  ledger["swarmD ledger: verdicts, tasks, matters"] --> status','  gh["GitHub: lanes, pull requests, CI"] --> status','  ph["PostHog live evals"] -->|verdicts| ledger','  status -->|view time| site','  site -->|answers| ans["GitHub issue, then a ledger matter"]','  ans -->|book first| book'];
return [$("h1",{},"Capxul, from its design book"),$("p",{class:"lede"},D.system.about),
$("div",{class:"tiles"},tiles.map(function(t){return $("div",{class:"tile"},$("b",{},t[1]),$("span",{},t[0]))})),
$("h2",{},"Where the build stands"),$("div",{class:"mstone"},D.milestones.map(function(x){return $("div",{},$("b",{},x[0])," ",x[1],$("div",{class:"muted"},x[2]),$("span",{class:"chip"+(x[3]==="designed"?" warn":"")},x[3]))})),
$("h2",{},"The 215 operations by stand"),$("div",{class:"strip"},STANDS.map(function(s){return $("button",{onclick:function(){location.hash="#/build?stand="+s}},standChip(s),$("b",{},c[s]))})),
$("p",{class:"note"},"Each stand is computed, never typed: from the records (gaps, the decisions waiting for review) and the latest verdict of every eval of the operation and of the records under it. Click a stand to see its operations."),
$("h2",{},"Waiting for review"),$("div",{class:"panel"},wait.map(function(d){return $("div",{style:"padding:6px 0;border-bottom:1px solid var(--line)"},$("a",{href:"#/decision/"+d.id},d.title),$("div",{class:"note"},$("code",{},d.id)," · holds "+d.held.length+" operations at decide · touches "+d.touches))}),$("p",{},$("a",{href:"#/review"},"All "+D.decisions.filter(function(d){return d.waiting}).length+" waiting, then every decision →"))),
$("h2",{},"What reaches the portal"),diagram(flow.join("\n")),
$("h2",{},"Components"),diagram(comp.join("\n")),
$("h2",{},"Concepts"),$("p",{class:"note"},"Each arrow is a direct dependency (transitively reduced). A concept is built after everything it depends on."),diagram(cmap.join("\n"))]}

function reviewAnswer(d,answer){var dlg=document.getElementById("dlg");var opt=$("select",{},(d.full?d.full.options:[]).map(function(o){return $("option",{value:o.label,selected:o.label===d.chosen},o.label)}));var note=$("textarea",{placeholder:answer==="change"?"What you want instead, in your words":"A note (optional)"});var pre=$("pre",{class:"payload"});
function upd(){var p={decision:d.id,answer:answer,by:"aaron",at:new Date().toISOString().slice(0,19)+"Z",seenAt:D.meta.commit};if(answer==="choose")p.option=opt.value;if(note.value)p.text=note.value;pre.textContent=JSON.stringify(p,null,2)}
opt.addEventListener("change",upd);note.addEventListener("input",upd);upd();
dlg.replaceChildren($("h3",{},(answer==="accept"?"Accept":answer==="choose"?"Choose another option":"Change")+": "+d.id),$("p",{class:"note"},"The portal never edits a record. Your answer becomes this typed request: at D0 a prefilled GitHub issue labelled review; once the swarmD ledger runs, the resolution of the decision's matter. An agent then changes the record first (the decision, and any record the change ripples to), rebuilds the book to 0 problems and opens a pull request with a portal preview. When it merges, this page shows your answer, and the operations it held move on."),
answer==="choose"?$("p",{},"Option ",opt):null,$("p",{},note),pre,$("p",{class:"note"},"Prototype: nothing is sent."),$("div",{class:"actions"},$("button",{class:"btn primary",onclick:function(){dlg.close()}},"Close")));dlg.showModal()}
function decisionCard(d){return $("div",{class:"panel"},$("div",{class:"chips"},$("span",{class:"chip warn"},"waiting"),$("code",{class:"muted"},d.id),$("span",{class:"chip"},d.home)),$("h3",{style:"margin:6px 0"},$("a",{href:"#/decision/"+d.id},d.title)),
d.full?$("p",{class:"small",style:"margin:4px 0"},d.full.question.length>360?d.full.question.slice(0,357)+"…":d.full.question):null,
$("p",{class:"small",style:"margin:4px 0"},$("b",{},"Chosen: "),d.chosenText),
$("p",{class:"note",style:"margin:4px 0"},"Holds "+d.held.length+" operation"+(d.held.length===1?"":"s")+" at decide; touches "+d.touches+" through the records under them."),
$("div",{class:"actions"},$("button",{class:"btn primary",onclick:function(){reviewAnswer(d,"accept")}},"Accept"),$("button",{class:"btn",onclick:function(){reviewAnswer(d,"choose")}},"Choose another option"),$("button",{class:"btn",onclick:function(){reviewAnswer(d,"change")}},"Change")))}
function review(){var w=D.decisions.filter(function(d){return d.waiting}).sort(function(a,b){return b.held.length-a.held.length||b.touches-a.touches});var box=$("input",{class:"search",type:"search",placeholder:"Search "+D.decisions.length+" decisions by id, title or choice"});var list=$("div",{});
function drawList(){var s=box.value.toLowerCase();var rows=D.decisions.filter(function(d){return !s||(d.id+" "+d.title+" "+d.chosenText).toLowerCase().indexOf(s)>=0}).slice(0,250);list.replaceChildren($("div",{class:"scroll"},$("table",{class:"t"},$("tr",{},$("th",{},"Decision"),$("th",{},"Home"),$("th",{},"Chosen")),rows.map(function(d){return $("tr",{},$("td",{},$("a",{href:"#/decision/"+d.id},d.title),$("div",{},$("code",{class:"muted"},d.id),d.waiting?$("span",{class:"chip warn",style:"margin-left:6px"},"waiting"):null,d.byAaron?$("span",{class:"chip good",style:"margin-left:6px"},"his"):null)),$("td",{},d.home),$("td",{class:"small"},d.chosenText.length>220?d.chosenText.slice(0,217)+"…":d.chosenText))}))))}
box.addEventListener("input",drawList);drawList();
return [$("div",{class:"crumb"},"Review"),$("h1",{},"Review"),$("p",{class:"lede"},"What waits for a person: the judgments flagged for review, ordered by how many operations they hold at decide; then the open matters the managers raise, the milestone acceptances and the CLI surface. Each recorded choice stands, and the build follows it, until it is changed; a change goes into the record first."),
$("h2",{},"Waiting for review ("+w.length+")"),w.map(decisionCard),
$("h2",{},"Answered, waiting for the record (0)"),$("p",{class:"note"},"An answer shows here, with its pull request and preview, until the record changes and merges."),
$("h2",{},"Open matters"),$("p",{class:"note"},"From the swarmD ledger once it runs: decision packs a manager raises when no other action fits, each with 2 to 4 options and a recommendation. None yet."),
$("h2",{},"Milestone acceptances"),$("p",{class:"note"},"ok:D0 to ok:B5, person evals: the milestone is accepted. ",$("span",{class:"chip warn"},"ok:D0 pending")," "),
$("h2",{},"Every decision"),box,list]}

function decisionPage(id){var d=DEC[id];if(!d)return [$("h1",{},"No decision "+id)];
var held=d.held.map(function(o){return OPS[o]}).filter(Boolean);
return [$("div",{class:"crumb"},$("a",{href:"#/review"},"Review")," / decision"),$("h1",{},d.title),$("div",{class:"chips"},$("code",{},d.id),$("span",{class:"chip"},d.home),d.waiting?$("span",{class:"chip warn"},"waiting for review"):d.byAaron?$("span",{class:"chip good"},"decided by Aaron"):$("span",{class:"chip"},"recorded")),
d.full?[$("h2",{},"Question"),$("p",{},d.full.question),$("h2",{},"Options"),d.full.options.map(function(o){return $("div",{class:"panel",style:o.label===d.chosen?"border-color:var(--accent)":""},$("div",{class:"chips"},$("b",{},o.label),o.label===d.chosen?$("span",{class:"chip good"},"chosen"):null),$("p",{class:"small",style:"margin:6px 0 0"},o.text))}),$("h2",{},"Why"),$("p",{},d.full.why),kv([["Source",d.full.source]])]:[$("h2",{},"Chosen"),$("p",{},d.chosenText),$("p",{class:"note"},"The prototype carries the full question, options and reasons only for the decisions waiting for review, the portal's own, the payments concept's and those on payment send's records. The portal has every decision's page.")],
$("h2",{},"Affects ("+d.affects.length+")"),links(d.affects),
d.waiting?[$("h2",{},"Holds at decide ("+held.length+")"),held.length?$("div",{class:"chips"},held.map(function(o){return $("a",{href:"#/operation/"+o.id},$("code",{},o.command))})):$("p",{class:"note"},"No operation's own records; it touches "+d.touches+" through the records under them."),$("div",{class:"actions"},$("button",{class:"btn primary",onclick:function(){reviewAnswer(d,"accept")}},"Accept"),$("button",{class:"btn",onclick:function(){reviewAnswer(d,"choose")}},"Choose another option"),$("button",{class:"btn",onclick:function(){reviewAnswer(d,"change")}},"Change"))]:$("div",{class:"actions"},$("button",{class:"btn",onclick:function(){reviewAnswer(d,"change")}},"Change"))]}

function design(){return [$("div",{class:"crumb"},"Design"),$("h1",{},"The design book"),$("p",{class:"lede"},"Every concept, in build-order layers: each concept's door before anything that depends on it. A concept's page holds its operations with their stands, its data, its behaviour, its durable processes, its decisions and its gaps."),
D.concepts.reduce(function(acc,c){(acc[c.layer]=acc[c.layer]||[]).push(c);return acc},[]).map(function(cs,L){return [$("h2",{},"Layer "+(L+1)),$("div",{class:"cards"},cs.map(function(k){var os=D.ops.filter(function(o){return o.concept===k.id});var c=counts(os);return $("a",{href:"#/concept/"+k.id,class:"card"},$("h3",{},k.title),$("div",{class:"note"},(k.about||"").split(". ")[0]+"."),stackBar(c,Math.max(1,os.length)),$("div",{class:"note mono"},os.length+" ops · "+k.records.table.length+" tables · "+k.records.workflow.length+" processes · "+k.evals+" evals"))}))]})]}

function rail(cur){return $("nav",{class:"rail"},$("h4",{},"Concepts"),D.concepts.map(function(c){var n=D.ops.filter(function(o){return o.concept===c.id}).length;return $("a",{href:"#/concept/"+c.id,class:cur===c.id?"on":""},c.title,$("small",{},n))}))}

var KLABEL={operation:"Operations",flow:"Core SDK flows",rpc:"Server calls (rpcs)",procedure:"Procedures (its door)",workflow:"Durable processes",table:"Tables",machine:"State machines",event:"Events",decision:"Decisions"};
function opTable(os){return $("div",{class:"scroll"},$("table",{class:"t"},$("tr",{},$("th",{},"Command"),$("th",{},"Stand"),$("th",{},"Evals"),$("th",{},"Under it"),$("th",{},"p95 / budget"),$("th",{},"Priority")),os.map(function(o){var t=evalTotals(o);var p=p95of(o);return $("tr",{},$("td",{},$("a",{href:"#/operation/"+o.id},$("code",{},"capxul "+o.command)),$("div",{class:"note"},o.title)),$("td",{},standChip(standOf(o))),$("td",{class:"num"},t.p+"/"+t.t,t.f?$("span",{class:"r-fail"}," "+t.f+"✗"):null),$("td",{class:"num"},t.up+"/"+t.ut,t.uf?$("span",{class:"r-fail"}," "+t.uf+"✗"):null),$("td",{class:"num"},o.budget?[p==null?"–":$("span",{class:p>o.budget[2]?"r-fail":""},p)," / "+o.budget[2]+" ms"]:"–"),$("td",{},o.priority))}))) }
function machineSrc(m){var l=["stateDiagram-v2"];if(m.initial)l.push("  [*] --> "+safe(m.initial));m.transitions.forEach(function(t){var from=t[1]&&t[1].length?t[1]:["[*]"];from.forEach(function(f){l.push("  "+(f==="[*]"?"[*]":safe(f))+" --> "+safe(t[2])+" : "+t[0])})});m.states.forEach(function(s){if(s[1])l.push("  "+safe(s[0])+" --> [*]")});return l.join("\n")}
function recordBody(r){switch(r.kind){
case "table":return [kv([["Tenancy",r.tenancy+(r.tenantField?" · "+r.tenantField:"")],["Scope",r.scope],["Key",r.key?$("code",{},[].concat(r.key).join(", ")):null],["Retention",r.retention],["Admissions",r.admits?String(r.admits):null]]),$("div",{class:"scroll"},$("table",{class:"t"},$("tr",{},$("th",{},"Field"),$("th",{},"Type")),r.fields.map(function(f){return $("tr",{},$("td",{},$("code",{},f[0]+(f[2]?"?":""))),$("td",{},$("code",{},f[1])))}))),r.indexes.length?$("div",{class:"scroll"},$("table",{class:"t"},$("tr",{},$("th",{},"Index"),$("th",{},"Fields"),$("th",{},"For")),r.indexes.map(function(i){return $("tr",{},$("td",{},$("code",{},i[0]),i[2]?$("span",{class:"chip",style:"margin-left:6px"},"unique"):null),$("td",{},$("code",{},i[1].join(", "))),$("td",{class:"small"},i[3]))}))):null];
case "machine":return [kv([["Table",recLink(r.table)],["Column",$("code",{},r.field)]]),diagram(machineSrc(r)),$("div",{class:"scroll"},$("table",{class:"t"},$("tr",{},$("th",{},"Transition"),$("th",{},"From → to"),$("th",{},"Emits"),$("th",{},"Guard")),r.transitions.map(function(t){return $("tr",{},$("td",{},$("code",{},t[0])),$("td",{},(t[1].length?t[1].join(", "):"(birth)")+" → "+t[2]),$("td",{},links(t[3])),$("td",{class:"small"},t[4]))})))];
case "workflow":return [kv([["Trigger",r.trigger],["Instance",r.instance],["Signals",r.signals.length?links(r.signals):null],["Waits",r.waits.length?r.waits.map(function(w){return w[0]+" ("+w[1]+(w[2]?", "+Math.round(w[2]/1000)+" s":"")+")"}).join("; "):null],["Idempotency",r.idempotency],["Budget",bud(r.budget)],["Writes",r.writes.length?links(r.writes):null],["Drives",r.drives.length?links(r.drives):null],["Invokes",r.invokes.length?links(r.invokes):null],["Calls",r.calls.length?links(r.calls):null]]),r.steps.length?$("ol",{class:"claims"},r.steps.map(function(s){return $("li",{},$("b",{},s[0]),": ",s[1])})):null];
case "rpc":return [kv([["Kind",r.rpcKind],["Who",r.who],["Input",$("code",{},r.input)],["Output",$("code",{},r.output)],["Errors",links(r.errors)],["Reads",r.reads.length?links(r.reads):null],["Writes",r.writes.length?links(r.writes):null],["Drives",r.drives.length?links(r.drives):null],["Invokes",r.invokes.length?links(r.invokes):null],["Calls",r.calls.length?links(r.calls):null],["Chain",r.chain.length?links(r.chain):null],["Budget",bud(r.budget)]])];
case "procedure":return [kv([["Input",$("code",{},r.input)],["Output",$("code",{},r.output)],["Errors",links(r.errors)],["Reads",r.reads.length?links(r.reads):null],["Writes",links(r.writes)],["Drives",r.drives.length?links(r.drives):null],["Invokes",r.invokes.length?links(r.invokes):null]])];
case "flow":return [kv([["SDK method",$("code",{},r.sdk)],["Input",$("code",{},r.input)],["Output",$("code",{},r.output)],["Budget",bud(r.budget)],["Errors",r.errors.length?links(r.errors):null]]),$("ol",{class:"claims"},r.steps.map(function(s){return $("li",{},$("b",{},s[0])," ",s[1].indexOf("local:")===0?$("span",{class:"chip"},s[1].slice(6)):["→ ",recLink(s[1])],s[2]?$("span",{class:"note"}," "+s[2]):null)}))];
case "event":return [$("div",{class:"scroll"},$("table",{class:"t"},$("tr",{},$("th",{},"Property"),$("th",{},"Type")),r.props.map(function(f){return $("tr",{},$("td",{},$("code",{},f[0]+(f[2]?"?":""))),$("td",{},$("code",{},f[1])))})))];
default:return []}}
function concept(id){var k=CON[id];if(!k)return [$("h1",{},"No concept "+id)];var os=D.ops.filter(function(o){return o.concept===id});var c=counts(os);var full=id===D.meta.featured.concept;
var body=[$("div",{class:"crumb"},$("a",{href:"#/design"},"Design")," / concept · layer "+(k.layer+1)),$("h1",{},k.title),$("p",{class:"lede"},k.about),
kv([["Runs in",recLink(k.component)],["Depends on",k.dependsOn.length?$("span",{class:"chips"},k.dependsOn.map(function(d){return $("a",{href:"#/concept/"+d},$("code",{},d))})):"nothing"],["Depended on by",$("span",{class:"chips"},D.concepts.filter(function(x){return x.dependsOn.indexOf(id)>=0}).map(function(x){return $("a",{href:"#/concept/"+x.id},$("code",{},x.id))}))],["Derived evals",String(k.evals)],["Lane",$("span",{},$("code",{},"lane/"+id)," → integration/build ",$("span",{class:"muted small"},"(branch, pull requests and CI come from GitHub at B4)"))]]),
$("h2",{},"Operations ("+os.length+")"),$("div",{class:"strip"},STANDS.map(function(s){return $("span",{class:"chips"},standChip(s),$("b",{class:"mono"},c[s]))})),opTable(os)];
["flow","rpc","procedure","workflow","table","machine","event"].forEach(function(kind){var ks=k.records[kind].map(function(i){return D.keys[i]});if(!ks.length)return;body.push($("h2",{},KLABEL[kind]+" ("+ks.length+")"));
if(full)ks.forEach(function(x){var r=D.featuredRecords[x];if(!r)return;body.push($("details",{class:"rec",id:"r-"+safe(x)},$("summary",{},$("h3",{},r.title),$("code",{class:"muted"},r.id),$("a",{href:recHref(x),class:"small"},"page →")),$("div",{class:"body"},r.about?$("div",{},r.about):null,recordBody(r))))});
else body.push($("div",{class:"chips"},ks.map(function(x){return recLink(x)})))});
var ds=D.decisions.filter(function(d){return d.home===id}).sort(function(a,b){return (b.waiting?1:0)-(a.waiting?1:0)});
body.push($("h2",{},"Decisions ("+ds.length+")"),$("div",{class:"scroll"},$("table",{class:"t"},ds.map(function(d){return $("tr",{},$("td",{},$("a",{href:"#/decision/"+d.id},d.title),$("div",{},$("code",{class:"muted"},d.id),d.waiting?$("span",{class:"chip warn",style:"margin-left:6px"},"waiting"):null)),$("td",{class:"small"},d.chosenText.length>200?d.chosenText.slice(0,197)+"…":d.chosenText))}))));
body.push($("h2",{},"Gaps ("+k.gaps.length+")"),k.gaps.length?$("ul",{},k.gaps.map(function(g){return $("li",{},recLink(g[0])," ",$("span",{class:"chip warn"},g[1])," ",$("span",{class:"small"},g[2]))})):$("p",{class:"note"},"None."));
if(!full)body.push($("p",{class:"note"},"The prototype carries full record detail for the payments concept only; the portal has a page for every record."));
return $("div",{class:"cols"},rail(id),$("div",{},body))}

function ladder(o){var s=standOf(o);var i=STANDS.indexOf(s);var t=evalTotals(o);
var why={specify:o.gaps.length?o.gaps.length+" gap"+(o.gaps.length>1?"s":"")+": "+o.gaps.map(function(g){return g[1]}).join(", "):"no gap or problem under it",decide:o.waitOwn.length?"waiting: "+o.waitOwn.join(", "):"no judgment on it waits",build:(t.p+t.up)+" of "+(t.t+t.ut)+" evals pass"+((t.f+t.uf)?", "+(t.f+t.uf)+" fail":""),observe:MODE==="none"?"no live evals before B5":(o.live==="pass"?"live evals hold (mock)":"live evals not seen on staging yet"),done:s==="done"?"all hold":"–"};
return $("div",{class:"ladder"},STANDS.map(function(x,j){return $("div",{class:"rung"+(j<i?" met":"")+(j===i?" here s-"+x:"")},$("b",{},(j<i?"✓ ":j===i?"● ":"")+x),$("div",{class:"why"},why[x]))}))}
function operation(id){var o=OPS[id];if(!o)return [$("h1",{},"No operation "+id)];var t=evalTotals(o);
var sec=function(id,title){return $("h2",{id:"s-"+id},title)};
var toc=$("div",{class:"toc"},[["use","Use"],["acceptance","Acceptance"],["how","How it works"],["status","Status"],["decisions","Decisions"],["frozen","Frozen text"]].map(function(x){return $("button",{onclick:function(){var e=document.getElementById("s-"+x[0]);if(e)e.scrollIntoView({behavior:"smooth"})}},x[1])}));
var synopsis="capxul "+o.command+(o.flags?o.flags.args.map(function(a){return " "+(a[1]?"<":"[")+a[0]+(a[2]?"…":"")+(a[1]?">":"]")}).join("")+(o.flags.flags.length?" [flags]":""):"");
var ev=o.evals.map(function(e){return $("tr",{id:"e-"+safe(e[0])},$("td",{},$("code",{},eid(o,e[0]))),$("td",{class:"small"},claimOf(o,e)),$("td",{},e[1]),$("td",{class:"r-"+res(e[2])},res(e[2]),e[4]&&MODE!=="none"?$("div",{class:"note mono"},"p95 "+e[4].p95_ms+" · p50 "+e[4].p50_ms+" · n "+e[4].n):null))});
var under=[];for(var k in o.underEvals){var u=o.underEvals[k];under.push($("tr",{},$("td",{},$("code",{},k)),$("td",{class:"num"},u[0]),$("td",{class:"num r-pass"},MODE==="none"?0:u[1]),$("td",{class:"num r-fail"},MODE==="none"?0:u[2]),$("td",{class:"num"},u[0]-(MODE==="none"?0:u[1]+u[2]))))}
var byKind={};o.under.forEach(function(i){var key=D.keys[i];var kind=key.split(":")[0];(byKind[kind]=byKind[kind]||[]).push(key)});
var ds=o.decAll.map(function(x){return DEC[x]}).filter(Boolean).sort(function(a,b){return (b.waiting?1:0)-(a.waiting?1:0)});
return $("div",{class:"cols"},rail(o.concept),$("div",{},
$("div",{class:"crumb"},$("a",{href:"#/design"},"Design")," / ",$("a",{href:"#/concept/"+o.concept},o.concept)," / operation"),$("h1",{class:"cmd"},"capxul "+o.command),$("p",{class:"lede",style:"margin-bottom:8px"},o.title),
$("div",{class:"chips"},standChip(standOf(o)),$("code",{class:"muted"},o.id),$("span",{class:"chip"},"area "+o.area),$("span",{class:"chip"},o.priority),o.sdk?$("span",{class:"chip"},o.sdk):null,o.journeys.map(function(j){return $("span",{class:"chip"},"journey "+j)})),
toc,
sec("use","Use"),$("p",{},o.about),
$("div",{class:"panel"},$("code",{},synopsis),
o.flags?$("details",{style:"margin-top:8px"},$("summary",{class:"note"},"Flags are designed at B1, book first. Reference only: the old CLI's "+o.flags.args.length+" arguments and "+o.flags.flags.length+" flags"+(o.flags.inCli?"":" (designed, never in the old CLI)")),$("div",{class:"scroll"},$("table",{class:"t"},$("tr",{},$("th",{},"Old argument or flag"),$("th",{},"Value"),$("th",{},"Default"),$("th",{},"Description")),o.flags.args.map(function(a){return $("tr",{},$("td",{},$("code",{},"<"+a[0]+">")),$("td",{},a[1]?"required":"optional"),$("td",{},""),$("td",{class:"small"},a[3]))}),o.flags.flags.map(function(f){return $("tr",{},$("td",{},$("code",{},f[0]+(f[1]?", "+f[1]:""))),$("td",{},f[2]?$("code",{},f[2]):"switch"),$("td",{},f[3]==null||f[3]===false?"":$("code",{},String(f[3]))),$("td",{class:"small"},f[5]))})))):null),
kv([["Who can run it",o.who],["Implemented by",recLink(o.impl)],["Returns (--json)",$("code",{},o.returns)],["Budget",bud(o.budget)],["CLI's own errors",o.errors.length?$("span",{class:"chips"},o.errors.map(function(e){return recLink("error:"+e)})):null]]),
o.refusals.length?[$("h3",{style:"margin-top:16px"},"Refusals ("+o.refusals.length+")"),$("div",{class:"scroll"},$("table",{class:"t"},$("tr",{},$("th",{},"Code"),$("th",{},"Exit"),$("th",{},"When"),$("th",{},"World")),o.refusals.map(function(f){var e=ERR[f[0]];return $("tr",{},$("td",{},recLink("error:"+f[0]),e?$("div",{class:"note"},e[6]):null),$("td",{class:"num"},e?e[4]:""),$("td",{class:"small"},f[2]),$("td",{},f[1]==="?"?$("span",{class:"chip warn"},"no world yet"):$("code",{},f[1])))})))]:null,
o.mistakes.length?[$("h3",{style:"margin-top:16px"},"Common mistakes"),$("ul",{},o.mistakes.map(function(m){return $("li",{class:"small"},m.what," ",$("span",{class:"muted"},"→ "+m.fix))}))]:null,
sec("acceptance","Acceptance ("+o.acceptance.filter(Boolean).length+" claims)"),o.acceptance.length?$("ol",{class:"claims"},o.acceptance.map(function(a,i){return a===null?$("li",{class:"muted"},"(retired, with a decision)"):$("li",{id:"e-acc_"+(i+1)},a.c,$("span",{class:"chip",style:"margin-left:6px"},a.k?"kept":"rewritten"),a.o?$("div",{class:"obs"},"Observes: "+a.o):null)})):$("p",{class:"callout"},"No acceptance lines in the old book: a no-acceptance gap, so this operation stands at specify until new lines are accepted."),
sec("how","How it works"),o.diagram?diagram(o.diagram):$("p",{class:"note"},"The implementation diagram is drawn for the payments operations in the prototype."),
o.steps.length?$("ol",{class:"claims"},o.steps.map(function(s){return $("li",{},$("b",{},s[0])," ",s[1].indexOf("local:")===0?$("span",{class:"chip"},s[1].slice(6)):["→ ",recLink(s[1])])})):null,
$("details",{class:"rec"},$("summary",{},$("h3",{},"The "+o.under.length+" records under it"),$("span",{class:"note"},"what implements it, its steps, the procedures, tables, transitions, calls and contract functions they reach, and the processes it starts or resumes")),$("div",{class:"body"},Object.keys(byKind).sort().map(function(kind){return kv([[kind+" ("+byKind[kind].length+")",links(byKind[kind])]])}))),
sec("status","Status"),ladder(o),
$("p",{class:"note"},MODE==="mock"?"Mock verdicts at "+D.meta.commit+". The portal reads the status document for the head of integration/build; a verdict at an older commit shows greyed as last seen.":"No verdicts yet: every eval is unknown until B2."),
$("h3",{},"Its own evals ("+t.t+")"),$("div",{class:"scroll"},$("table",{class:"t"},$("tr",{},$("th",{},"Eval"),$("th",{},"Claim"),$("th",{},"Decider"),$("th",{},"Verdict")),ev)),
$("h3",{style:"margin-top:16px"},"Evals of the records under it ("+t.ut+")"),$("div",{class:"scroll"},$("table",{class:"t"},$("tr",{},$("th",{},"Kind"),$("th",{},"Total"),$("th",{},"Pass"),$("th",{},"Fail"),$("th",{},"Unknown")),under)),
o.featuredUnder?$("details",{class:"rec"},$("summary",{},$("h3",{},"Every one of them")),$("div",{class:"body scroll"},$("table",{class:"t"},o.featuredUnder.map(function(e){return $("tr",{},$("td",{},$("code",{},e[0])),$("td",{class:"small"},e[3]),$("td",{class:"r-"+res(e[2])},res(e[2])))})))):null,
$("div",{class:"panel"},$("b",{},"Work on it"),$("p",{class:"note",style:"margin:4px 0"},"Once the swarmD ledger runs: the task for this operation, its state, the maker and checker on it, its rounds and its pull request with CI, read from the ledger and GitHub, with a link to the build manager's live board. Until then, docs/mission/progress.md.")),
sec("decisions","Decisions ("+ds.length+")"),o.touch.length?$("p",{class:"note"},"Also touched by "+o.touch.length+" judgment"+(o.touch.length>1?"s":"")+" waiting for review, through the records under it: ",o.touch.map(function(x){return $("a",{href:"#/decision/"+x,style:"margin-right:6px"},$("code",{},x))})):null,
ds.length?$("div",{class:"scroll"},$("table",{class:"t"},ds.map(function(d){return $("tr",{},$("td",{},$("a",{href:"#/decision/"+d.id},d.title),$("div",{},$("code",{class:"muted"},d.id),d.waiting?$("span",{class:"chip warn",style:"margin-left:6px"},"waiting"):null)),$("td",{class:"small"},d.chosenText.length>220?d.chosenText.slice(0,217)+"…":d.chosenText))}))):$("p",{class:"note"},"No decision names its own records."),
sec("frozen","Frozen text"),kv([["Who (old book)",o.who],["Changes",o.changes],["Notes",o.notes.length?$("ul",{style:"margin:0;padding-left:18px"},o.notes.map(function(n){return $("li",{class:"small"},n)})):null]]),
$("p",{class:"note"},"The old book's words are the starting point (system.frozen-behaviour): behaviour is kept, spelling is the target's to design.")))}

function recordPage(kind,id){var k=kind+":"+id;var r=D.featuredRecords[k];var meta=rk(k);
if(kind==="error"){var e=ERR[id];if(!e)return [$("h1",{},"No error "+id)];var users=D.ops.filter(function(o){return o.refusals.some(function(f){return f[0]===id})||o.errors.indexOf(id)>=0});
return [$("div",{class:"crumb"},$("a",{href:"#/cli"},"Docs")," / error"),$("h1",{class:"cmd"},id),$("p",{class:"lede"},e[1]),kv([["Message",e[6]],["Class",e[2]],["Who acts next",e[3]],["Exit code",String(e[4])],["Retryable",e[5]?"yes":"no"]]),$("h2",{},"Operations that refuse with it ("+users.length+")"),$("div",{class:"chips"},users.map(function(o){return $("a",{href:"#/operation/"+o.id},$("code",{},o.command))}))]}
if(!meta)return [$("h1",{},"No record "+k)];
return $("div",{class:"cols"},rail(meta[1]),$("div",{},$("div",{class:"crumb"},$("a",{href:"#/concept/"+meta[1]},meta[1])," / "+kind),$("h1",{},meta[0]),$("div",{class:"chips"},$("code",{},k)),
r?[$("p",{class:"lede"},r.about),recordBody(r)]:$("p",{class:"note"},"The prototype carries full detail for the payments concept's records and the errors. In the portal every record has this page: its fields, the records it links to, the records that link to it, its evals with their verdicts, its gaps and the decisions that affect it."),
$("h2",{},"Decisions on it"),links(D.decisions.filter(function(d){return d.affects.indexOf(k)>=0}).map(function(d){return "decision:"+d.id}))))}

function build(params){var want=params.stand||"";var box=$("input",{class:"search",type:"search",placeholder:"Filter by command, title or concept"});var host=$("div",{});var c=counts(D.ops);
var tot={t:0,p:0,f:0};D.ops.forEach(function(o){var t=evalTotals(o);tot.t+=t.t;tot.p+=t.p;tot.f+=t.f});
function drawTable(){var s=box.value.toLowerCase();var rows=[];D.concepts.forEach(function(k){var os=D.ops.filter(function(o){return o.concept===k.id&&(!want||standOf(o)===want)&&(!s||(o.command+" "+o.title+" "+o.concept).toLowerCase().indexOf(s)>=0)});if(!os.length)return;var cc=counts(os);
rows.push($("tr",{class:"group"},$("td",{colspan:"2"},$("a",{href:"#/concept/"+k.id},k.title)," ",$("span",{class:"note"},"layer "+(k.layer+1))),$("td",{colspan:"4"},stackBar(cc,os.length))));
os.forEach(function(o){var t=evalTotals(o);var p=p95of(o);var tel=o.evals.filter(function(e){return /^(evt|spn)(\/|$)/.test(e[0])});var telp=tel.filter(function(e){return res(e[2])==="pass"}).length;
rows.push($("tr",{},$("td",{},$("a",{href:"#/operation/"+o.id},$("code",{},o.command))),$("td",{},standChip(standOf(o))),$("td",{class:"num"},t.p+"/"+t.t),$("td",{class:"num"},t.up+"/"+t.ut,t.uf?$("span",{class:"r-fail"}," "+t.uf+"✗"):null),$("td",{class:"num"},o.budget?[p==null?"–":$("span",{class:p>o.budget[2]?"r-fail":""},p)," / "+o.budget[2]]:"–"),$("td",{class:"num"},tel.length?Math.round(100*telp/tel.length)+"%":"–")))})});
host.replaceChildren($("div",{class:"scroll"},$("table",{class:"t"},$("tr",{},$("th",{},"Operation"),$("th",{},"Stand"),$("th",{},"Own evals"),$("th",{},"Under it"),$("th",{},"p95 / budget ms"),$("th",{},"Telemetry")),rows)))}
box.addEventListener("input",drawTable);drawTable();
return [$("div",{class:"crumb"},"Build"),$("h1",{},"Scoreboard"),$("p",{class:"lede"},"The hill: for each operation, its stand, the evals passing (its own, and those of the records under it), p95 against its budget and telemetry coverage, by concept in build-order layers. Lines of code join per concept at B3 (sys:loc)."),
$("div",{class:"strip"},[$("button",{class:want?"":"on",onclick:function(){location.hash="#/build"}},"All ",$("b",{},D.ops.length))].concat(STANDS.map(function(s){return $("button",{class:want===s?"on":"",onclick:function(){location.hash="#/build?stand="+s}},standChip(s),$("b",{},c[s]))}))),
$("p",{class:"note"},"Own evals: "+tot.p+" of "+tot.t+" pass"+(tot.f?", "+tot.f+" fail":"")+" at "+D.meta.commit+(MODE==="mock"?" (mock)":" (none yet)")+". The ledger's score query gives the same counts once it runs."),box,host]}

function cli(){var groups={};D.ops.forEach(function(o){var w=o.command.split(" ")[0];(groups[w]=groups[w]||[]).push(o)});
var used={};D.ops.forEach(function(o){o.refusals.forEach(function(f){used[f[0]]=(used[f[0]]||0)+1})});
var classes={},exits={};D.errors.forEach(function(e){classes[e[2]]=1;exits[e[4]]=1});var cl=Object.keys(classes),ex=Object.keys(exits).sort(function(a,b){return a-b});
var verbs={};D.ops.forEach(function(o){var v=o.command.split(" ").pop();verbs[v]=(verbs[v]||0)+1});
return [$("div",{class:"crumb"},"Docs"),$("h1",{},"The CLI surface"),$("p",{class:"lede"},"The surface as one system, reviewed before code (system.frozen-behaviour frees the spelling): every command, its --json shape, the error vocabulary and its exit codes. Flags join from B1, when the operation record gains its designed flags; until then each operation page shows the old CLI's flags as reference."),
$("h2",{},"Error vocabulary ("+D.errors.length+")"),$("div",{class:"scroll"},$("table",{class:"t"},$("tr",{},$("th",{},"Code"),$("th",{},"Class"),$("th",{},"Who acts"),$("th",{},"Exit"),$("th",{},"Retry"),$("th",{},"Message"),$("th",{},"Refused by")),D.errors.map(function(e){return $("tr",{},$("td",{},recLink("error:"+e[0])),$("td",{},e[2]),$("td",{},e[3]),$("td",{class:"num"},e[4]),$("td",{},e[5]?"yes":""),$("td",{class:"small"},e[6]),$("td",{class:"num"},used[e[0]]||0))}))),
$("h3",{style:"margin-top:16px"},"Exit codes by class"),$("p",{class:"note"},"A consistent vocabulary maps each class to one exit code. A row with two numbers is a spelling decision to make."),$("div",{class:"scroll"},$("table",{class:"t"},$("tr",{},$("th",{},"Class"),ex.map(function(x){return $("th",{},"exit "+x)})),cl.map(function(c){return $("tr",{},$("td",{},c),ex.map(function(x){var n=D.errors.filter(function(e){return e[2]===c&&String(e[4])===x}).length;return $("td",{class:"num"},n||"")}))}))),
$("h2",{},"Global flags (old CLI, reference)"),$("div",{class:"chips"},D.globalFlags.map(function(f){return $("span",{class:"chip",title:f[2]},f[0]+(f[1]?" "+f[1]:""))})),
$("h2",{},"Verbs ("+Object.keys(verbs).length+")"),$("div",{class:"chips"},Object.keys(verbs).sort(function(a,b){return verbs[b]-verbs[a]}).map(function(v){return $("span",{class:"chip"},v+" "+verbs[v])})),
$("h2",{},"Commands ("+D.ops.length+")"),Object.keys(groups).sort().map(function(w){return $("details",{class:"rec"},$("summary",{},$("h3",{},$("code",{},"capxul "+w)),$("span",{class:"note"},groups[w].length+" commands")),$("div",{class:"body scroll"},$("table",{class:"t"},groups[w].map(function(o){return $("tr",{},$("td",{},$("a",{href:"#/operation/"+o.id},$("code",{},o.command))),$("td",{class:"small"},o.title),$("td",{},standChip(standOf(o))),$("td",{class:"small mono"},o.returns.length>90?o.returns.slice(0,87)+"…":o.returns))}))))})]}

function operate(){return [$("div",{class:"crumb"},"Operate"),$("h1",{},"Environments"),$("p",{class:"lede"},"Where Capxul runs and what is deployed there. From B5, each operation's live evals (p95 against its budget, error rate) and each journey's funnel arrive here as verdicts, which the scout worker posts from PostHog; the portal never holds a PostHog key."),
D.environments.map(function(e){return $("div",{class:"panel"},$("h3",{},e.title," ",$("code",{class:"muted"},e.id)),$("p",{class:"small"},e.about),$("div",{class:"scroll"},$("table",{class:"t"},e.runs.map(function(x){return $("tr",{},$("td",{},recLink("component:"+x[0])),$("td",{class:"small"},x[1]))}))),kv([["Config",e.config.length+" names"],["Secrets",e.secrets.length+" names (values never reach the portal)"],["Boots within",e.bootMs?e.bootMs/1000+" s":null],["Deployed commit",$("span",{class:"muted"},"from the deploy entries, once it is deployed")]]))}),
$("h2",{},"Journeys ("+D.journeys.length+")"),$("div",{class:"scroll"},$("table",{class:"t"},D.journeys.map(function(j){return $("tr",{},$("td",{},j[1],$("div",{},$("code",{class:"muted"},j[0]))),$("td",{},$("span",{class:"chips"},j[2].map(function(o){return $("a",{href:"#/operation/"+o},$("code",{},OPS[o]?OPS[o].command:o))}))),$("td",{class:"small muted"},"funnel: from live:fun at B5"))})))]}

function route(){var h=(location.hash||"#/").slice(1);var qi=h.indexOf("?");var params={};if(qi>=0){h.slice(qi+1).split("&").forEach(function(p){var kv=p.split("=");params[kv[0]]=decodeURIComponent(kv[1]||"")});h=h.slice(0,qi)}
var parts=h.split("/").filter(Boolean);var v,cur="overview";
if(!parts.length)v=overview();
else if(parts[0]==="review"){v=review();cur="review"}
else if(parts[0]==="decision"){v=decisionPage(parts.slice(1).join("/"));cur="review"}
else if(parts[0]==="design"){v=design();cur="design"}
else if(parts[0]==="concept"){v=concept(parts[1]);cur="design"}
else if(parts[0]==="operation"){v=operation(parts.slice(1).join("/"));cur="design"}
else if(parts[0]==="record"){v=recordPage(parts[1],parts.slice(2).join("/"));cur=parts[1]==="error"?"cli":"design"}
else if(parts[0]==="build"){v=build(params);cur="build"}
else if(parts[0]==="cli"){v=cli();cur="cli"}
else if(parts[0]==="operate"){v=operate();cur="operate"}
else v=overview();
var m=document.getElementById("main");m.replaceChildren();add(m,v);chrome(cur);window.scrollTo(0,0);draw()}
document.addEventListener("toggle",function(){draw()},true);
addEventListener("hashchange",route);route();
</script>
</body>
</html>`;

// ── write it ───────────────────────────────────────────────────────────────────────────────────────────────────
const json = JSON.stringify(data).replace(/</g, "\\u003c");
const html = PAGE.replace("/*__DATA__*/null", () => json);
writeFileSync(out, html);
const mb = (Buffer.byteLength(html) / 1e6).toFixed(2);
console.log(`${out}: ${REC.size} records, ${ops.length} operations, ${decisions.length} decisions, ${mb} MB`);
console.log(`stands with mock verdicts: ${JSON.stringify(standCount.mock)}; with none yet: ${JSON.stringify(standCount.none)}`);
console.log(`waiting for review: ${decisionRows.filter((d) => d.waiting).length}`);
if (Buffer.byteLength(html) > 2e6) {
  console.error("over 2 MB");
  process.exitCode = 1;
}
