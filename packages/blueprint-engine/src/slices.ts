/** Mechanical product coverage. This module neither schedules work nor writes plan/status. */
import { keyOf, type AnyRecord, type Blueprint } from "./build.ts";
import { underOf } from "./stand.ts";
import { freshStatus, type RunReceipt, type StatusDocument } from "./status.ts";

export interface SliceRun extends Pick<RunReceipt, "id" | "at" | "commit" | "state" | "environment" | "requested" | "screens"> {
  readonly landed?: boolean;
  readonly status: StatusDocument;
}
export interface SliceEvidence {
  readonly state: "unproved" | "running" | "incomplete" | "failing" | "partial" | "proved";
  readonly passing: number;
  readonly required: number;
  readonly run: string | null;
  readonly commit: string | null;
  readonly environment: SliceRun["environment"] | null;
  readonly landed: boolean;
  readonly verdicts: StatusDocument["evals"];
}
export interface ProductSlice {
  readonly id: string;
  readonly wave: number;
  readonly journey: string;
  readonly concept: string;
  readonly concepts: readonly string[];
  readonly records: readonly string[];
  readonly remaining: readonly string[];
  readonly operations: readonly string[];
  readonly events: readonly string[];
  readonly screens: readonly string[];
  readonly evals: readonly string[];
  readonly required: readonly string[];
  readonly prerequisites: readonly string[];
  readonly waiting: readonly string[];
  readonly evidence: SliceEvidence;
}
export interface SliceManifest {
  readonly version: 1;
  readonly waves: readonly { readonly id: number; readonly slices: readonly string[]; readonly concepts: readonly string[]; readonly shared: boolean; readonly maxWriters: number }[];
  readonly slices: readonly ProductSlice[];
  readonly journeys: readonly { readonly id: string; readonly slices: readonly string[]; readonly evals: readonly string[]; readonly evidence: SliceEvidence; readonly empty: boolean }[];
  readonly proven: readonly string[];
  readonly outside: { readonly records: readonly string[]; readonly operations: readonly string[]; readonly evals: readonly string[] };
}
export interface SliceOptions {
  readonly conceptOf: ReadonlyMap<string, string>;
  readonly runs?: readonly SliceRun[];
  readonly waits?: (decision: AnyRecord) => boolean;
}
const sorted = (keys: Iterable<string>): string[] => [...new Set(keys)].sort();
const parentKind: Readonly<Record<string, string>> = { transition: "machine", call: "integration", function: "contract", chainEvent: "contract" };

/** Explicit floor only. Use sliceZeroRequired for the full computed acceptance contract. */
export const SLICE_ZERO_REQUIRED: readonly string[] = [
  ...["supplier-invoice", "payment-entry", "general-ledger", "safe-trial-balance"].map((id) => `scr:${id}/shows`),
  ...["indexer_unready", "delivery_stuck", "money_event_parked"].flatMap((id) => ["quiet", "fires", "clears"].map((state) => `alr:${id}/${state}`)),
];
const foundationKeys = (b: Blueprint): Set<string> => {
  const journey = b.records.get("journey:thin_line");
  if (!journey) return new Set();
  const keys = new Set(underOf(b, journey).under.filter((k) => !k.startsWith("journey:")));
  for (const e of b.evals.filter((e) => SLICE_ZERO_REQUIRED.includes(e.id))) {
    const r = b.records.get(e.subject);
    if (r) for (const key of underOf(b, r).under) keys.add(key);
  }
  return keys;
};

/** Full same-run gate consumed by both the board and slice-zero runtime; eval IDs remain opaque. */
export const sliceZeroRequired = (b: Blueprint): readonly string[] => {
  const keys = foundationKeys(b);
  return sorted([...SLICE_ZERO_REQUIRED, ...b.evals.filter((e) => e.subject === "journey:thin_line" ||
    (keys.has(e.subject) && (e.level === "L1" || /^(scr|alr):/.test(e.id)))).map((e) => e.id)]);
};

/** Child records inherit their parent's source concept. Explicit concept references work in small fixtures too. */
export const sliceConcept = (b: Blueprint, owners: ReadonlyMap<string, string>, key: string): string => {
  const r = b.records.get(key);
  const parent = r && parentKind[r._kind];
  return owners.get(key) ?? (parent ? sliceConcept(b, owners, `${parent}:${String(r?.[parent])}`) :
    (r?.concept as { id?: string } | undefined)?.id ?? "shared");
};

/** No union of passes: all requested claims must pass, fresh, in the same complete selected-stack run. */
export const sliceEvidence = (b: Blueprint, ids: readonly string[], runs: readonly SliceRun[]): SliceEvidence => {
  const candidates = runs.filter((r) => r.environment.storage === "postgres" && r.environment.indexer === "ponder" &&
    r.environment.stack === "postgres-ponder-erpnext-v4" && ids.some((id) => r.requested.includes(id)))
    .toSorted((a, z) => z.at.localeCompare(a.at) || z.id.localeCompare(a.id));
  const latest = candidates[0];
  const status = latest?.state === "complete" ? freshStatus(b, { version: 1, evals: Object.fromEntries(Object.entries(latest.status.evals).filter(([id, s]) =>
    latest.requested.includes(id) && s.run === latest.id && s.commit === latest.commit)) }) : null;
  const passing = ids.filter((id) => status?.evals[id]?.verdict === "pass").length;
  const failed = ids.some((id) => status?.evals[id]?.verdict === "fail");
  const screens = b.evals.filter((e) => ids.includes(e.id) && e.subject.startsWith("screen:") && e.id.endsWith("/shows"));
  const captured = screens.every((e) => latest?.screens.some((s) => `screen:${s.screen.replace(/^screen:/, "")}` === e.subject && s.path && s.source && s.assertion === "source-equality"));
  return {
    state: !latest || ids.length === 0 ? "unproved" : latest.state !== "complete" ? latest.state : failed ? "failing" : passing === ids.length && captured ? "proved" : "partial",
    passing, required: ids.length, run: latest?.id ?? null,
    commit: latest?.commit ?? null,
    environment: latest?.environment ?? null,
    landed: latest?.landed === true,
    verdicts: Object.fromEntries(Object.entries(status?.evals ?? {}).filter(([id]) => ids.includes(id))),
  };
};

/** Foundation first; deterministic conflict packing is provisional, not product priority or runtime readiness. */
export const slicesOf = (b: Blueprint, options: SliceOptions): SliceManifest => {
  const runs = options.runs ?? [];
  const all = [...b.records.values()];
  const owner = (k: string) => sliceConcept(b, options.conceptOf, k);
  const evalsOn = (keys: readonly string[]) => { const set = new Set(keys); return b.evals.filter((e) => set.has(e.subject)); };
  const requiredOn = (keys: readonly string[]) => evalsOn(keys).filter((e) => e.level === "L1" || /^(scr|alr):/.test(e.id)).map((e) => e.id).sort();
  const proven = new Set(all.filter((r) => {
    const defs = evalsOn([keyOf(r)]);
    const ids = defs.filter((e) => e.level === "L1" || /^(scr|alr):/.test(e.id)).map((e) => e.id);
    const evidence = sliceEvidence(b, ids.length ? ids : defs.map((e) => e.id), runs);
    return evidence.state === "proved" && evidence.landed;
  }).map(keyOf));
  const journeys = all.filter((r) => r._kind === "journey").sort((a, z) => a.id.localeCompare(z.id, "en"));
  const reaches = new Map(journeys.map((j) => [j.id, new Set(underOf(b, j).under.filter((k) => !k.startsWith("journey:")))]));
  const used = new Map<string, string>();
  let slices: ProductSlice[] = [];
  const add = (id: string, wave: number, journey: string, concept: string, records: string[], reach: ReadonlySet<string>) => {
    const held = new Set(records);
    const operations = [...reach].filter((k) => k.startsWith("operation:") && (concept === "foundation" || owner(k) === concept ||
      underOf(b, b.records.get(k)!).under.some((r) => held.has(r))));
    const required = concept === "foundation" ? sliceZeroRequired(b) : requiredOn(records);
    const waiting = b.links.filter((l) => l.field === "affects" && held.has(l.to) && l.from.startsWith("decision:") &&
      options.waits?.(b.records.get(l.from)!)).map((l) => l.from);
    slices.push({ id, wave, journey, concept, concepts: sorted(records.map(owner)), records: sorted(records), remaining: sorted(records.filter((k) => !proven.has(k))), operations: sorted(operations),
      events: records.filter((k) => /^(event|chainEvent):/.test(k)).sort(), screens: records.filter((k) => k.startsWith("screen:")).sort(),
      evals: sorted([...evalsOn(records).map((e) => e.id), ...(concept === "foundation" ? required : [])]), required: sorted(required),
      prerequisites: [], waiting: sorted(waiting), evidence: sliceEvidence(b, required, runs) });
    for (const k of records) used.set(k, id);
  };
  const foundation = foundationKeys(b);
  if (reaches.has("thin_line")) reaches.set("thin_line", foundation);
  // Keep the foundation and completed slices in the inventory so a landing changes status, not slice identity.
  if (reaches.has("thin_line")) add("slice-0", 0, "thin_line", "foundation", [...foundation], foundation);
  const breadth = journeys.filter((j) => j.id !== "thin_line").map((j) => ({ journey: j.id,
    keys: new Set([...(reaches.get(j.id) ?? [])].filter((k) => !foundation.has(k)))
  })).sort((a, z) => z.keys.size - a.keys.size || a.journey.localeCompare(z.journey, "en"));
  const packs: { keys: Set<string>; concepts: Set<string>; journeys: typeof breadth }[] = [];
  for (const j of breadth) {
    const concepts = new Set([...j.keys].map(owner).filter((c) => c !== "shared"));
    let pack = packs.find((p, i) => ![...j.keys].some((k) => p.keys.has(k)) && (i !== 0 || new Set([...p.concepts, ...concepts]).size <= 13));
    if (!pack) { pack = { keys: new Set(), concepts: new Set(), journeys: [] }; packs.push(pack); }
    pack.journeys.push(j);
    j.keys.forEach((k) => pack.keys.add(k)); concepts.forEach((c) => pack.concepts.add(c));
  }
  for (const [i, pack] of packs.entries()) for (const j of pack.journeys) {
    const records = [...j.keys].filter((k) => !used.has(k));
    for (const concept of sorted(records.map(owner))) {
      add(`${j.journey}--${concept}`, i + 1, j.journey, concept, records.filter((k) => owner(k) === concept), reaches.get(j.journey)!);
    }
  }
  slices = slices.map((s) => ({ ...s, prerequisites: sorted(s.records.flatMap((k) => underOf(b, b.records.get(k)!).under)
    .flatMap((k) => { const id = used.get(k); return id && id !== s.id ? [id] : []; })) }));
  const reached = new Set([...reaches.values()].flatMap((r) => [...r]));
  const waves = sorted(slices.map((s) => String(s.wave))).map(Number).sort((a, z) => a - z).map((id) => {
    const held = slices.filter((s) => s.wave === id);
    const concepts = sorted(held.flatMap((s) => s.concepts).filter((c) => c !== "shared"));
    const shared = held.some((s) => s.concepts.includes("shared"));
    return { id, slices: held.map((s) => s.id), concepts, shared, maxWriters: id === 0 ? 1 : concepts.length + Number(shared) };
  });
  return { version: 1, waves, slices, proven: sorted([...proven].filter((k) => foundation.has(k))),
    journeys: journeys.map((j) => { const evals = b.evals.filter((e) => e.subject === keyOf(j)).map((e) => e.id); return {
      id: j.id, slices: slices.filter((s) => s.journey === j.id).map((s) => s.id), evals,
      evidence: sliceEvidence(b, evals, runs), empty: (j.steps as unknown[]).length === 0,
    }; }),
    outside: { records: sorted(all.filter((r) => !reached.has(keyOf(r)) && !["journey", "decision", "concept", "component", "system"].includes(r._kind)).map(keyOf)),
      operations: sorted(all.filter((r) => r._kind === "operation" && !reached.has(keyOf(r))).map(keyOf)),
      evals: b.evals.filter((e) => !reached.has(e.subject) && !e.subject.startsWith("journey:")).map((e) => e.id).sort() },
  };
};
