/** Product coverage only. Existing plan tasks describe occupied lanes; this page never dispatches or leases. */
import { sliceConcept, type ProductSlice, type SliceEvidence } from "@capxul/blueprint-engine";
import type { CataloguePage, Ref } from "../types.ts";
import { head, type Ctx } from "./context.ts";
import { refOf } from "./locate.ts";
import { code, many, row, tableOf, to, words } from "./table.ts";

export const BOARD: Ref = { label: "Waves & slices", page: "board", anchor: "" };
const sliceRef = (id: string): Ref => ({ label: id === "slice-0" ? "Slice 0 · Reconciled supplier payment + recovery" : id, page: `slice/${id}`, anchor: "" });
const proof = (e: SliceEvidence): string => `${e.state === "proved" ? e.landed ? "Landed · proved" : "Proved · awaiting merge" : e.state} · ${e.passing}/${e.required} required`;

export const slicePages = (ctx: Ctx): readonly CataloguePage[] => {
  const manifest = ctx.input.slices;
  if (!manifest) return [];
  const { blueprint, conceptOf } = ctx.input;
  const refs = (keys: readonly string[]): Ref[] => keys.flatMap((k) => { const r = blueprint.records.get(k); return r ? [refOf(r)] : []; });
  const concept = (id: string): Ref => ({ label: id, page: `concept/${id}`, anchor: "" });
  const tasks = (lane: string) => (ctx.input.plan?.plan.tasks ?? []).filter((t) => t.state === "doing" && t.records.some((k) =>
    sliceConcept(blueprint, conceptOf, k) === lane || k === `concept:${lane}`));
  const holders = (s: ProductSlice) => [...new Map(s.concepts.flatMap((c) => tasks(c)).map((t) => [t.id, t])).values()];
  const lane = (s: ProductSlice) => {
    const held = holders(s);
    const conflict = s.concepts.some((c) => tasks(c).length > 1);
    return `${conflict ? "CONFLICT · " : ""}${held.length ? held.map((t) => t.id).join("; ") : "No active owner recorded"}`;
  };
  const state = (s: ProductSlice) => {
    if (s.evidence.state === "proved") return proof(s.evidence);
    const blocked = s.prerequisites.filter((id) => { const e = manifest.slices.find((p) => p.id === id)?.evidence; return e?.state !== "proved" || !e.landed; });
    const active = holders(s).some((t) => t.records.some((k) => s.records.includes(k)));
    return `${active ? "In progress · " : holders(s).length ? "Lane occupied · " : ""}${proof(s.evidence)}${s.waiting.length ? ` · ${s.waiting.length} decisions` : ""}${blocked.length ? ` · ${blocked.length} unproved prerequisites` : ""}`;
  };
  const board: CataloguePage = {
    ...head("board", "Waves & slices", "blueprint and complete run receipts", null),
    type: "catalogue", nav: BOARD.label, eyebrow: "Product coverage · generated", crumbs: [], sliceManifest: manifest,
    lead: "Wave 0 is one reconciled supplier payment with recovery on Postgres/Ponder Core and ERPNext. " +
      "Later waves are provisional conflict groups, not a ready-to-run schedule. One agent per concept at a time, " +
      "plus one serialized shared lane; wave 1 permits at most 13 concept owners + shared. " +
      "Live serving picks up local evidence and integration/wave-0 landings automatically. Historical JSON passes do not complete a slice.",
    tiles: manifest.waves.map((w) => ({ big: `${w.id}`, name: `wave · ${w.slices.length} slices`, to: { label: `Wave ${w.id}`, page: "board", anchor: `wave-${w.id}` } })),
    sections: [
      ...manifest.waves.map((w) => tableOf(`wave-${w.id}`, `Wave ${w.id}${w.id === 0 ? " · Supplier payment, reconciled and recoverable" : ""}`,
        ["Slice / journey", "Owns", "Records / evals", "Evidence", "Concept lane"],
        manifest.slices.filter((s) => s.wave === w.id).map((s) => row([
          to(sliceRef(s.id), s.journey), s.concept === "foundation" ? words("Foundation · one cross-stack owner") : s.concept === "shared" ? words("shared") : to(concept(s.concept)),
          words(`${s.remaining.length}/${s.records.length} remaining · ${s.evals.length} evals`), words(state(s)), words(lane(s)),
        ])), { caption: w.id === 0 ? "One foundation owner coordinates its concept locks; nothing is erased because the JSON skeleton passed." :
          `${w.concepts.length} distinct concept lanes${w.shared ? " + shared" : ""}; at most ${w.maxWriters} writers, not ${w.slices.length}. Repeated concepts queue; runtime prerequisites can lower this ceiling.` })),
      tableOf("journeys", "Journey integration proof", ["Journey", "Slices", "Ordered journey / funnel", "Disposition"], manifest.journeys.map((j) => row([
        many(refs([`journey:${j.id}`])), many(j.slices.map(sliceRef)), words(proof(j.evidence)),
        words(j.empty ? "EMPTY · not implemented or complete; needs explicit disposition" : j.slices.length ? "Integration proof is separate from slice proof" : "No new records · integration proof still required"),
      ]))),
      tableOf("outside", "Outside journey coverage", ["Kind", "Records"], [
        row([words("Operations"), many(refs(manifest.outside.operations))]),
        row([words("Events / chain events / screens"), many(refs(manifest.outside.records.filter((k) => /^(event|chainEvent|screen):/.test(k))))]),
        row([words("Other records"), many(refs(manifest.outside.records.filter((k) => !/^(operation|event|chainEvent|screen):/.test(k))))]),
      ], { caption: `${manifest.outside.operations.length} operations, ${manifest.outside.records.length} records and ${manifest.outside.evals.length} evals are outside the journeys. They are not silently complete. ${manifest.proven.length} foundation records have selected-stack proof.` }),
    ],
  };
  return [board, ...manifest.slices.map((s): CataloguePage => ({
    ...head(`slice/${s.id}`, sliceRef(s.id).label, "blueprint and complete run receipts", null),
    type: "catalogue", nav: BOARD.label, eyebrow: `Wave ${s.wave} · ${s.concept}`, crumbs: [BOARD], tiles: [],
    lead: `${state(s)}. ${lane(s)}. One writer per concept; shared files stay in the shared lane. ` +
      `Required proof is L1 plus screen and alert claims together in one complete selected-stack run. ${s.remaining.length}/${s.records.length} records remain unproved or unmerged. Other evals stay listed. A zero-check slice is unproved.`,
    sections: [
      tableOf("evidence", "Latest qualifying run", ["State", "Run / tested commit", "Environment"], [row([
        words(proof(s.evidence)), words(`${s.evidence.run ?? "No complete selected-stack run"} · ${s.evidence.commit ?? "none"}`),
        words(s.evidence.environment ? `${s.evidence.environment.stack} · world ${s.evidence.environment.world}` : "Required: postgres-ponder-erpnext-v4; historical JSON evidence does not qualify"),
      ])], { caption: s.evidence.commit && s.evidence.commit !== ctx.input.commit ? `Tested at ${s.evidence.commit}, not proof at this built commit ${ctx.input.commit}.` : "No union of historical passes; missing screen captures, stale claims and interrupted runs cannot prove completion." }),
      tableOf("dependencies", "Prerequisites, decisions and concept locks", ["Prerequisite slices", "Waiting decisions", "Concept locks"], [row([
        many(s.prerequisites.map(sliceRef)), many(refs(s.waiting)), many(s.concepts.map((id) => id === "shared" ? { label: "shared · serialized", page: "board", anchor: `wave-${s.wave}` } : concept(id))),
      ])]),
      tableOf("operations", "Operations this slice supports", ["Operation"], refs(s.operations).map((r) => row([to(r)]))),
      tableOf("events", "Owned events and screens", ["Record"], refs([...s.events, ...s.screens]).map((r) => row([to(r)]))),
      tableOf("records", "Owned records", ["Record"], refs(s.records).map((r) => row([to(r)]))),
      tableOf("evals", "Eval contract and evidence", ["Eval", "Subject / evidence", "Required", "Latest recorded verdict"], s.evals.map((id) => {
        const e = blueprint.evals.find((e) => e.id === id);
        const record = e && blueprint.records.get(e.subject);
        const selected = s.evidence.verdicts[id];
        const historical = ctx.input.status?.evals[id];
        return row([code(id), record && e ? to(refOf(record), e.claim) : words(e?.claim ?? "Required declaration has not landed"), words(s.required.includes(id) ? "yes" : "catalogue"),
          words(selected ? `${selected.verdict} · complete selected-stack run ${s.evidence.run} · ${selected.commit}${selected.evidence ? ` · ${selected.evidence}` : ""}` :
            historical ? `${historical.verdict} · historical scoreboard · ${historical.run ?? "no run"} · ${historical.commit}; not selected-stack proof` : "not run")]);
      })),
    ],
  }))];
};
