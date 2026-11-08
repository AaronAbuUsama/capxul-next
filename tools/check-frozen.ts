// node --experimental-strip-types tools/check-frozen.ts
// Checks the target book against the frozen surface, mechanically: every frozen operation has one
// target record with the same command and title; every acceptance line is kept word for word, or
// changed with the frozen claim first in its `was`, or retired as null; every frozen refusal code
// is still a refusal, from the page or its designed (v4) block, unless a decision on the operation
// names it. Exits 1 on a breach. A changed line with no decision on its operation is listed.

import { frozen, type FrozenId } from "../books/frozen/operations.ts";
import { records } from "../books/target/index.ts";

type Line = { claim: string; observes?: string; was?: readonly string[] } | null;
type Op = { _kind: "operation"; id: string; command: string; title: string; acceptance: Line[]; refusals: { error: { id: string } }[] };
type Decision = {
  _kind: "decision"; id: string; title: string; question: string; chosen: string; why: string;
  options?: { label: string; text: string }[]; affects?: { _kind: string; id: string }[];
};

const all = records as unknown as { _kind: string; id: string }[];
const ops = new Map((all.filter((r) => r._kind === "operation") as unknown as Op[]).map((o) => [o.id, o]));
const decisions = all.filter((r) => r._kind === "decision") as unknown as Decision[];
const decided = new Set(decisions.flatMap((d) => (d.affects ?? []).filter((a) => a._kind === "operation").map((a) => a.id)));
/** A decision's own words: its title, question, options, choice and why (never its linked records). */
const textOf = (d: Decision) =>
  [d.title, d.question, d.chosen, d.why, ...(d.options ?? []).map((o) => o.text)].join(" ");
/** Per operation, the text of every decision that affects it. */
const decisionText = new Map<string, string>();
for (const d of decisions)
  for (const a of (d.affects ?? []).filter((x) => x._kind === "operation"))
    decisionText.set(a.id, `${decisionText.get(a.id) ?? ""} ${textOf(d)}`);

const breaches: string[] = [];
const undecided: string[] = [];
const tally = { operations: 0, lines: 0, kept: 0, changed: 0, retired: 0, refusals: 0, droppedByDecision: 0 };

for (const id of Object.keys(frozen) as FrozenId[]) {
  const f = frozen[id] as unknown as { command: string; title: string; acceptance: { claim: string }[]; refusals: { code: string }[] };
  const o = ops.get(id);
  if (!o) { breaches.push(`${id}: no target operation record`); continue; }
  tally.operations++;
  if (o.command !== f.command) breaches.push(`${id}: command "${o.command}" is not the frozen "${f.command}"`);
  if (o.title !== f.title) breaches.push(`${id}: title "${o.title}" is not the frozen "${f.title}"`);
  if (o.acceptance.length !== f.acceptance.length)
    breaches.push(`${id}: ${o.acceptance.length} acceptance lines, the frozen page has ${f.acceptance.length}`);
  f.acceptance.forEach((fa, i) => {
    tally.lines++;
    const a = o.acceptance[i];
    if (a === null) return void tally.retired++;
    if (a === undefined) return;
    if (a.claim === fa.claim) return void tally.kept++;
    if (a.was?.[0] === fa.claim) {
      tally.changed++;
      if (!decided.has(id)) undecided.push(`${id} #${i + 1}`);
      return;
    }
    breaches.push(`${id} #${i + 1}: the claim changed and the frozen claim is not first in its was`);
  });
  // Both the page's refusals and the designed (v4) block's are frozen. One may be dropped only by a decision
  // record on the operation that names the code (P9 drops pre-v4 refusals; P10 lets the designed block win).
  const codes = new Set(o.refusals.map((r) => r.error.id));
  const designed = (f as { designed?: { refusals?: { code: string }[] } | null }).designed?.refusals ?? [];
  for (const code of new Set([...f.refusals, ...designed].map((r) => r.code))) {
    tally.refusals++;
    if (codes.has(code)) continue;
    if ((decisionText.get(id) ?? "").includes(code)) { tally.droppedByDecision++; continue; }
    breaches.push(`${id}: the frozen refusal ${code} is not a refusal, and no decision on the operation names it`);
  }
}
for (const id of ops.keys()) if (!(id in frozen)) breaches.push(`${id}: a target operation the frozen book does not have`);

console.log(
  `${tally.operations} of ${Object.keys(frozen).length} operations; ${tally.lines} acceptance lines: ${tally.kept} kept word for word, ` +
    `${tally.changed} changed with the frozen claim kept in was, ${tally.retired} retired; ${tally.refusals} frozen refusal codes checked, ${tally.droppedByDecision} dropped by a decision that names them.`,
);
console.log(`${undecided.length} changed lines whose operation no decision record names${undecided.length ? ": " + undecided.join(", ") : ""}.`);
console.log(`${breaches.length} breaches.`);
for (const b of breaches) console.log(`breach ${b}`);
process.exitCode = breaches.length ? 1 : 0;
