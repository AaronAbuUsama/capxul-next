// node --experimental-strip-types tools/export-explorer.ts <out.json> [stamp]
// A read-only view of the target book for the book explorer page: concepts, operations, decisions (with which wait for
// Aaron), the command packs, gaps and eval counts. It is derived from books/target on every run and is never a source
// of truth: the book is. The decision logic matches tools/report-judgments.ts.

import { writeFileSync } from "node:fs";
import { name, records, stage } from "../books/target/index.ts";
import { CONCEPTS } from "../books/target/shared/foundation.ts";
import { recordsOf } from "../books/target/shared/index.ts";
import { ACCEPTED, CARRIES_OUT as CARRIES_OUT_RULINGS, REOPENED, SUPERSEDED } from "../books/target/shared/rulings.ts";
import { buildBook, keyOf, type AnyRecord } from "../packages/book/src/index.ts";
import { frozen } from "../books/frozen/operations.ts";

const [out = "explorer.json", stamp = ""] = process.argv.slice(2);
const book = buildBook({ name, stage, records });
const all = [...book.records.values()];
const ofKind = (k: string) => all.filter((r) => r._kind === k);

const conceptOf = new Map<string, string>();
for (const c of CONCEPTS) {
  const m = (await import(`../books/target/${c.id}/index.ts`)) as { modules: readonly object[] };
  for (const r of recordsOf(m.modules) as AnyRecord[]) conceptOf.set(keyOf(r), c.id);
}
const where = (r: AnyRecord) => conceptOf.get(keyOf(r)) ?? "shared";
const ref = (x: unknown) => (x && typeof x === "object" && "id" in x ? String((x as { id: string }).id) : String(x ?? ""));
const one = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

// As tools/report-judgments.ts decides it.
const FLAGGED = [
  "payroll.scope", "payments.birth-width", "parties.directory-tenancy", "procedures.accounts-admit",
  "agents.org-owned", "board.failed-proposal", "equity.acceptance", "contacts.members-write", "notices.claim-escrow", "system.size",
];
const CARRIES_OUT = ["rules.frozen-flags-kept", "rules.frozen-flags-built-ins", ...CARRIES_OUT_RULINGS];
const PACKS = ["projects.commands", "organizations.commands", "contacts.crm-capabilities", "payroll.hr-surface"];
const byAaron = (d: AnyRecord) => /^Aaron\b/.test(String(d.source ?? ""));
const forAaron = (d: AnyRecord) =>
  !byAaron(d) && !CARRIES_OUT.includes(d.id) && !ACCEPTED.includes(d.id) && !(d.id in SUPERSEDED) &&
  (REOPENED.includes(d.id) || FLAGGED.includes(d.id) || /\baaron\b/i.test(`${d.title} ${d.question} ${d.why} ${d.chosen}`));

const count = (c: string, k: string) => all.filter((r) => r._kind === k && conceptOf.get(keyOf(r)) === c).length;
const evalCount = new Map<string, number>();
for (const e of book.evals) evalCount.set(e.subject, (evalCount.get(e.subject) ?? 0) + 1);

const data = {
  stamp,
  totals: {
    records: all.length,
    evals: book.evals.length,
    problems: book.problems.length,
    gaps: book.gaps.length,
    kinds: Object.fromEntries([...new Set(all.map((r) => r._kind))].map((k) => [k, ofKind(k).length])),
    evalLevels: Object.fromEntries([...new Set(book.evals.map((e) => e.id.split(":")[0]))].map((l) => [l, book.evals.filter((e) => e.id.startsWith(`${l}:`)).length])),
  },
  concepts: CONCEPTS.map((c: AnyRecord) => ({
    id: c.id, title: c.title, about: one(c.about), dependsOn: ((c.dependsOn ?? []) as unknown[]).map(ref),
    counts: Object.fromEntries(["operation", "table", "machine", "rpc", "flow", "workflow", "procedure", "decision"].map((k) => [k, count(c.id, k)])),
  })),
  operations: ofKind("operation").map((o) => ({
    id: o.id, concept: where(o), command: o.command, title: o.title, about: one(o.about), who: one(o.who), changes: one(o.changes),
    priority: o.priority, evals: evalCount.get(keyOf(o)) ?? 0, isNew: !(o.id in frozen),
    acceptance: ((o.acceptance ?? []) as (AnyRecord | null)[]).map((a) => (a ? { claim: one(a.claim), observes: one(a.observes), rewritten: Array.isArray(a.was) && a.was.length > 0 } : null)),
    refusals: ((o.refusals ?? []) as AnyRecord[]).map((r) => ({ error: ref(r.error), given: ref(r.given), when: one(r.when) })),
    budget: (o.budget as AnyRecord | undefined)?.class ?? "",
  })),
  decisions: ofKind("decision").map((d) => ({
    id: d.id, concept: where(d), title: d.title, question: one(d.question), chosen: d.chosen, why: one(d.why), source: one(d.source),
    options: ((d.options ?? []) as AnyRecord[]).map((o) => ({ label: o.label, text: one(o.text) })),
    affects: ((d.affects ?? []) as AnyRecord[]).map((a) => `${a._kind}:${a.id}`),
    state: byAaron(d) ? "ruling" : d.id in SUPERSEDED ? "superseded" : ACCEPTED.includes(d.id) ? "accepted" : forAaron(d) ? "for-aaron" : "settled",
    supersededBy: (SUPERSEDED as Record<string, string>)[d.id] ?? null,
    pack: PACKS.includes(d.id) || /^Decision pack/i.test(String(d.title)),
  })),
  gaps: book.gaps.map((g) => ({ record: g.record, rule: g.rule, detail: one(g.detail) })),
  problems: book.problems.map((g) => ({ record: g.record, rule: g.rule, detail: one(g.detail) })),
};
writeFileSync(out, JSON.stringify(data));
console.log(`${data.totals.records} records, ${data.operations.length} operations, ${data.decisions.length} decisions ` +
  `(${data.decisions.filter((d) => d.state === "for-aaron").length} for Aaron, ${data.decisions.filter((d) => d.pack).length} packs), ` +
  `${data.totals.problems} problems, ${data.totals.gaps} gaps → ${out}`);
