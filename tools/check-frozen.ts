// node --experimental-strip-types tools/check-frozen.ts
// Checks that the target book keeps the old operations' BEHAVIOUR, not their spelling (Aaron's
// decision system.frozen-behaviour, 8 November 2026, extended by the cut on 10 November 2026), and books a new
// capability only where an Aaron ruling asks for it (decision rules.new-operations). Three things, mechanically:
//
// 1. Booking: every one of the 215 frozen operations is booked exactly once in the built book OR classified by the cut
//    (books/target/shared/cut.ts: reached, dropped or parked), never both and never neither. A classified operation
//    names the `cut.*` decision that classified it, the decision exists and its text names the operation, and the
//    entry says what carries it. A booked operation's command and title may differ only where a decision on the
//    operation names the old one. No two target operations share a command.
// 2. Behaviour: every acceptance claim is kept in intent (word for word), or rewritten (the frozen
//    claim first in its `was`) or retired (null), with a decision on the operation. Every frozen
//    refusal (the page's and its designed v4 block's) is a behaviour that is still refused: under its
//    code where the target's error vocabulary keeps the code, unless a decision on the operation names
//    the code; a code the vocabulary does not keep must be named by such a decision.
// 3. New operations: a target operation that is none of the 215 is booked only with a decision on it,
//    other than rules.new-operations itself, that cites the Aaron ruling it serves (the decision is a
//    ruling, or its words or source name an `aaron.*` id that is one), with at least one acceptance
//    claim, with its command's words joined by dots as its id, and with an id and a command that
//    collide with nothing: no frozen id, no export name another operation has, no frozen operation's
//    old command. They are counted apart, and never stand in for one of the 215.
//
// Flags, --json shapes and wording are the target's to design and are not compared;
// books/frozen/flags.ts is reference material. Exits 1 on a breach.

import { frozen, type FrozenId } from "../books/frozen/operations.ts";
import { records } from "../books/target/index.ts";
import { CUT } from "../books/target/shared/cut.ts";

type Line = { claim: string; observes?: string; was?: readonly string[] } | null;
type Op = { _kind: "operation"; id: string; command: string; title: string; acceptance: Line[]; refusals: { error: { id: string } }[] };
type Decision = {
  _kind: "decision"; id: string; title: string; question: string; chosen: string; why: string; source: string;
  options?: { label: string; text: string }[]; affects?: { _kind: string; id: string }[];
};
type Frozen = {
  command: string; title: string; acceptance: { claim: string }[]; refusals: { code: string }[];
  designed?: { refusals?: { code: string }[] } | null;
};

const all = records as unknown as { _kind: string; id: string }[];
const ops = all.filter((r) => r._kind === "operation") as unknown as Op[];
const byId = new Map<string, Op[]>();
for (const o of ops) byId.set(o.id, [...(byId.get(o.id) ?? []), o]);
const vocabulary = new Set(all.filter((r) => r._kind === "error").map((r) => r.id));
const decisions = all.filter((r) => r._kind === "decision") as unknown as Decision[];

/** A decision's own words: its title, question, options, choice and why (never its linked records). */
const textOf = (d: Decision) => [d.title, d.question, d.chosen, d.why, ...(d.options ?? []).map((o) => o.text)].join(" ");
/** Per operation, the decisions that affect it, and their text. */
const decisionsOn = new Map<string, Decision[]>();
const decisionText = new Map<string, string>();
for (const d of decisions)
  for (const a of (d.affects ?? []).filter((x) => x._kind === "operation")) {
    decisionsOn.set(a.id, [...(decisionsOn.get(a.id) ?? []), d]);
    decisionText.set(a.id, `${decisionText.get(a.id) ?? ""} ${textOf(d)}`);
  }
const decided = (id: string) => decisionText.has(id);
const names = (id: string, text: string) => (decisionText.get(id) ?? "").includes(text);

const breaches: string[] = [];
const t = { booked: 0, classified: 0, reached: 0, dropped: 0, parked: 0, renamed: 0, lines: 0, kept: 0, rewritten: 0, retired: 0, refusals: 0, refusedUnderCode: 0, byDecision: 0 };

for (const id of Object.keys(frozen) as FrozenId[]) {
  const f = frozen[id] as unknown as Frozen;
  const found = byId.get(id) ?? [];
  const cut = CUT[id];
  if (cut) {
    // Classified by the cut: not booked, and a decision names it and what carries it.
    if (found.length) breaches.push(`${id}: classified by the cut as ${cut.fate} but still booked ${found.length} times; it is booked or classified, never both`);
    const d = decisions.find((x) => x.id === cut.decision);
    if (!d) breaches.push(`${id}: classified by decision ${cut.decision}, which is not in the book`);
    else if (!textOf(d).includes(id)) breaches.push(`${id}: classified by ${cut.decision}, whose text does not name the operation`);
    if (!cut.carriedBy.trim()) breaches.push(`${id}: classified by the cut with no word on what carries it`);
    t.classified++;
    t[cut.fate]++;
    continue;
  }
  if (found.length !== 1) { breaches.push(`${id}: booked ${found.length} times and not classified by the cut; it must be booked exactly once or classified`); continue; }
  const o = found[0]!;
  t.booked++;

  // Booking: a renamed command or title carries a decision that names the old one.
  if (o.command !== f.command) {
    if (names(id, f.command)) t.renamed++;
    else breaches.push(`${id}: command "${o.command}" renames "${f.command}", and no decision on the operation names the old command`);
  }
  if (o.title !== f.title && !names(id, f.title) && !decided(id))
    breaches.push(`${id}: title "${o.title}" renames "${f.title}" with no decision on the operation`);

  // Behaviour: every acceptance claim kept in intent, or rewritten or retired with a decision.
  if (o.acceptance.length !== f.acceptance.length)
    breaches.push(`${id}: ${o.acceptance.length} acceptance lines, the old page has ${f.acceptance.length}; retire a line as null, never remove it`);
  f.acceptance.forEach((fa, i) => {
    t.lines++;
    const a = o.acceptance[i];
    if (a === undefined) return;
    if (a === null) {
      t.retired++;
      if (!decided(id)) breaches.push(`${id} #${i + 1}: retired with no decision on the operation`);
      return;
    }
    if (a.claim === fa.claim) return void t.kept++;
    if (a.was?.[0] !== fa.claim) return void breaches.push(`${id} #${i + 1}: rewritten, but the frozen claim is not first in its was`);
    t.rewritten++;
    if (!decided(id)) breaches.push(`${id} #${i + 1}: rewritten with no decision on the operation`);
  });

  // Behaviour: every frozen refusal is still refused.
  const codes = new Set(o.refusals.map((r) => r.error.id));
  for (const code of new Set([...f.refusals, ...(f.designed?.refusals ?? [])].map((r) => r.code))) {
    t.refusals++;
    if (vocabulary.has(code) && codes.has(code)) { t.refusedUnderCode++; continue; }
    if (names(id, code)) { t.byDecision++; continue; }
    breaches.push(
      vocabulary.has(code)
        ? `${id}: the old refusal ${code} is not refused, and no decision on the operation names it`
        : `${id}: the old refusal ${code} is not in the target's error vocabulary, and no decision on the operation says how the behaviour is refused`,
    );
  }
}

// Booking: a command names one operation, frozen or new.
const byCommand = new Map<string, string[]>();
for (const o of ops) byCommand.set(o.command, [...(byCommand.get(o.command) ?? []), o.id]);
for (const [command, ids] of byCommand)
  if (ids.length > 1) breaches.push(`command "${command}" is booked by ${ids.length} operations (${ids.join(", ")}); a command names one operation`);

// New operations (rules.new-operations): booked only for an Aaron ruling, with a claim, colliding with nothing.
/** Aaron's rulings: the book's `aaron.*` decisions whose source is Aaron himself. */
const rulings = new Set(decisions.filter((d) => d.id.startsWith("aaron.") && /^Aaron\b/.test(d.source)).map((d) => d.id));
const RULING_ID = /\baaron\.[a-z0-9]+(?:[._-][a-z0-9]+)*/g;
/** The rulings a decision cites: itself if it is one, and each ruling its own words or its source name. */
const cites = (d: Decision) => [
  ...(rulings.has(d.id) ? [d.id] : []),
  ...[...`${textOf(d)} ${d.source}`.matchAll(RULING_ID)].map((m) => m[0]).filter((r) => rulings.has(r)),
];
/** The export name an operation id takes (`operation_<id, . - _ → _>`): ids that share one collide. */
const exportName = (id: string) => `operation_${id.replace(/[._-]/g, "_")}`;
/** A new operation's id: its command's words joined by dots, as the frozen ids are. */
const idOf = (command: string) => command.trim().split(/\s+/).join(".");
const frozenIds = Object.keys(frozen) as FrozenId[];
const frozenSet = new Set<string>(frozenIds);
for (const id of Object.keys(CUT)) if (!frozenSet.has(id)) breaches.push(`${id}: classified by the cut but it is not one of the 215 frozen operations`);
const byExport = new Map<string, string[]>();
for (const id of new Set([...frozenIds, ...byId.keys()])) byExport.set(exportName(id), [...(byExport.get(exportName(id)) ?? []), id]);
const frozenByCommand = new Map(frozenIds.map((id) => [(frozen[id] as unknown as Frozen).command, id]));
const n = { ops: 0, claims: 0 };
const served = new Map<string, number>();

for (const [id, found] of byId) {
  if (frozenSet.has(id)) continue;
  for (const o of found) {
    n.ops++;
    if (id !== idOf(o.command))
      breaches.push(`${id}: a new operation's id is its command's words joined by dots; for "${o.command}" that is ${idOf(o.command)}`);
    const sharing = (byExport.get(exportName(id)) ?? []).filter((x) => x !== id);
    if (sharing.length)
      breaches.push(`${id}: a new operation whose export name ${exportName(id)} is also ${sharing.map((x) => (frozenSet.has(x) ? `the frozen ${x}'s` : `${x}'s`)).join(" and ")}`);
    const old = frozenByCommand.get(o.command);
    if (old && (byCommand.get(o.command)?.length ?? 0) === 1)
      breaches.push(`${id}: a new operation whose command "${o.command}" is the old command of ${old}`);
    const claims = o.acceptance.filter((a) => a !== null).length;
    n.claims += claims;
    if (claims === 0) breaches.push(`${id}: a new operation with no acceptance claim; it needs at least one (rules.new-operations)`);
    // The rule cites rulings for every capability, so it never books an operation itself.
    const on = (decisionsOn.get(id) ?? []).filter((d) => d.id !== "rules.new-operations");
    const rs = [...new Set(on.flatMap(cites))];
    if (on.length === 0)
      breaches.push(`${id}: a target operation that is none of the 215, with no decision on it (the rule itself does not count); a new operation needs a decision that cites the Aaron ruling it serves (rules.new-operations)`);
    else if (rs.length === 0)
      breaches.push(`${id}: a new operation whose decisions (${on.map((d) => d.id).join(", ")}) cite no Aaron ruling; name the aaron.* ruling it serves (rules.new-operations)`);
    for (const r of rs) served.set(r, (served.get(r) ?? 0) + 1);
  }
}

console.log(
  `Booking: ${t.booked} of ${frozenIds.length} operations booked once; ${t.renamed} commands renamed by a decision. ` +
    `Classified by the cut: ${t.classified} (${t.reached} reached, ${t.dropped} dropped, ${t.parked} parked), each by a decision that names it.`,
);
console.log(
  `Behaviour: ${t.lines} acceptance claims: ${t.kept} kept word for word, ${t.rewritten} rewritten and ${t.retired} retired, each with a decision; ` +
    `${t.refusals} old refusals: ${t.refusedUnderCode} still refused under their code, ${t.byDecision} named by a decision.`,
);
console.log(
  `New: ${n.ops} operations beyond the 215, with ${n.claims} acceptance claims; rulings they serve: ` +
    `${served.size ? [...served].sort(([a], [b]) => a.localeCompare(b)).map(([r, k]) => `${r} (${k})`).join(", ") : "none"}.`,
);
console.log(`${breaches.length} breaches.`);
for (const b of breaches) console.log(`breach ${b}`);
process.exitCode = breaches.length ? 1 : 0;
