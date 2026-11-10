// node --experimental-strip-types packages/plan/src/tasks.ts           → writes docs/mission/tasks.json and prints counts
// node --experimental-strip-types packages/plan/src/tasks.ts --check   → exits 1 if docs/mission/tasks.json is stale
//
// The build's task tree, derived from the design book (docs/design/swarm.md, section 5). Nothing here is written by hand
// except the milestones, which are the milestones of plan/plan.json (the coordinator's plan, read from the file, so there is
// one list; portal.plan-page). Every other task is a record of the book, and its done is the book's own eval ids:
//
// - one lane per concept, in the layers of decision system.build-order (the concepts' dependsOn depth, equity last);
// - in each lane: the door (its tables, machines and procedures), one task per durable process, one per operation, and
//   one per rpc or helper flow that no operation of its own lane owns (swarm.rpc-ownership);
// - the integrations, as their own lane before the concepts; the journeys, as their own lane after them;
// - needs from the links: an operation on the tasks that own its flow's rpcs, the doors of the concepts its rpcs read,
//   write and invoke, the integrations they call, and the processes they start or wake (swarm.process-order); never on
//   an event (swarm.events-not-needs), and never on a task in a later layer (swarm.layers).
//
// It fails (exit 1) if the book has problems, an eval is owned twice or not at all, an operation has no task or two, a
// need points at a later layer, or the needs (with each parent waiting on its children) have a cycle.
//
// A task with evals but no paths is a watch task (swarm.watch-tasks): no maker could change anything for it, so it has no
// checkers and no budget, never gets a pair, and is done when its evals pass (the journeys).
//
// The file holds the tasks and nothing aggregated over the book: no record or eval counts, which change with every
// decision record a lane adds. So two lanes that change different tasks regenerate it without a conflict, and a merge of
// both is the file plan-tasks writes at the merged head (swarm.task-tree). The counts are printed instead.

import { readFileSync, writeFileSync } from "node:fs";
import { name, records, stage } from "../../../books/target/index.ts";
import { CONCEPTS } from "../../../books/target/shared/foundation.ts";
import { recordsOf } from "../../../books/target/shared/index.ts";
import { WORLDS } from "../../../books/target/devnet/worlds.ts";
import { parsePlan } from "./modules/plan/service.ts";
import { buildBook, keyOf, type AnyRecord, type EvalDef } from "@capxul/book";

const OUT = "docs/mission/tasks.json";
const PLAN = "plan/plan.json";
const check = process.argv.includes("--check");
const failures: string[] = [];
const warnings: string[] = [];

// ── the book ────────────────────────────────────────────────────────────────────────────────

const book = buildBook({ name, stage, records });
if (book.problems.length) {
  console.error(`the book has ${book.problems.length} problems; build it to 0 first`);
  process.exit(1);
}
const get = (key: string): AnyRecord => {
  const r = book.records.get(key);
  if (!r) throw new Error(`no record ${key}`);
  return r;
};
const all = [...book.records.values()];
const ofKind = (kind: string) => all.filter((r) => r._kind === kind).sort((a, b) => a.id.localeCompare(b.id));
const linksFrom = (key: string, field?: string) =>
  book.links.filter((l) => l.from === key && (field === undefined || l.field === field)).map((l) => l.to);

/** The concept whose folder exports a record (a machine's transitions come with it). */
const conceptOf = new Map<string, string>();
for (const c of CONCEPTS) {
  const m = (await import(`../../../books/target/${c.id}/index.ts`)) as { modules: readonly object[] };
  for (const r of recordsOf(m.modules) as AnyRecord[]) {
    conceptOf.set(keyOf(r), c.id);
    if (r._kind === "machine") for (const t of Object.values(r.t as object) as AnyRecord[]) conceptOf.set(keyOf(t), c.id);
  }
}
// The pay agreements moved from payroll into payments (cut.agreements-in-payments); they keep their own folder inside it.
{
  const m = (await import("../../../books/target/payments/agreements/index.ts")) as { modules: readonly object[] };
  for (const r of recordsOf(m.modules) as AnyRecord[]) {
    conceptOf.set(keyOf(r), "payments");
    if (r._kind === "machine") for (const t of Object.values(r.t as object) as AnyRecord[]) conceptOf.set(keyOf(t), "payments");
  }
}
const concept = (key: string): string => {
  const c = conceptOf.get(key);
  if (!c) throw new Error(`no concept exports ${key}`);
  return c;
};

// The evals, by id. The book derives a few ids twice (a refusal under two worlds; an integration error listed twice):
// swarmD's catalog.sync refuses a duplicate, so they are reported here and fixed in packages/book by D0, whose
// portal.eval-ids makes every id unique and adds the duplicate-eval problem (ms:D0/unique).
const evalsById = new Map<string, EvalDef[]>();
for (const e of book.evals) evalsById.set(e.id, [...(evalsById.get(e.id) ?? []), e]);
const duplicated = [...evalsById].filter(([, v]) => v.length > 1).map(([id]) => id);
if (duplicated.length)
  warnings.push(`${duplicated.length} eval ids occur more than once in the book's evals (catalog.sync refuses them; ms:D0/unique): ${duplicated.slice(0, 4).join(", ")}, …`);
const evalsOf = new Map<string, string[]>(); // subject record key → unique eval ids
for (const [id, [e]] of evalsById) evalsOf.set(e!.subject, [...(evalsOf.get(e!.subject) ?? []), id]);
const evalIdsOf = (subject: string) => evalsOf.get(subject) ?? [];

// ── layers (system.build-order) ─────────────────────────────────────────────────────────────

const depth = new Map<string, number>();
const depthOf = (id: string): number => {
  const known = depth.get(id);
  if (known !== undefined) return known;
  const deps = linksFrom(`concept:${id}`, "dependsOn").map((k) => depthOf(k.slice("concept:".length)));
  const d = deps.length ? Math.max(...deps) + 1 : 0;
  depth.set(id, d);
  return d;
};
for (const c of CONCEPTS) depthOf(c.id);
/** Built last whatever its depth: "Board's director and vote operations and all of equity are built last". */
const LAST = new Set(["equity"]);
const maxDepth = Math.max(...depth.values());
const layerOf = (c: string) => (LAST.has(c) ? maxDepth + 1 : depth.get(c)!);
/** The decision's own list, so that a change to the concept map that moves a layer fails here until the decision moves. */
const BUILD_ORDER: readonly (readonly string[])[] = [
  ["access"], ["media"], ["parties"], ["indexing"], ["approvals"], ["accounts"], ["organizations"], ["applications", "board", "books", "contacts", "documents"], ["agents", "budgets"], ["payments"], ["activity", "banking", "plugs"], ["requests", "sites"], ["notices"], ["devnet"],
];
const computed: string[][] = [];
for (const c of CONCEPTS) (computed[layerOf(c.id)] ??= []).push(c.id);
for (const l of computed) l.sort();
if (JSON.stringify(computed) !== JSON.stringify(BUILD_ORDER))
  failures.push(`the concept map's layers no longer match system.build-order: ${JSON.stringify(computed)}`);

/** The money concepts: each of their tasks gets the adversarial reviewer as a second checker (swarm.money). */
const MONEY = new Set(["payments", "books", "banking", "requests", "payroll", "budgets", "approvals"]);
const INTEGRATIONS = "integrations";
const JOURNEYS = "journeys";
const laneLayer = (lane: string) => (lane === INTEGRATIONS ? -1 : lane === JOURNEYS ? maxDepth + 2 : layerOf(lane));

// ── the task shape (docs/design/swarm.md, section 4: TaskDef) ──────────────────────────────

type Kind = "root" | "milestone" | "lane" | "door" | "process" | "rpc" | "flow" | "operation" | "integration" | "journey";
type Priority = "critical" | "normal" | "low";
interface TaskDef {
  key: string;
  kind: Kind;
  title: string;
  goal: string;
  parent?: string;
  lane?: string;
  layer?: number;
  priority: Priority;
  evals: string[];
  needs: string[];
  labels: string[];
  budgetUsd: number;
  checkers: ("reviewer" | "adversary")[];
  paths: string[];
  record?: string;
  exit?: { id: string; claim: string }[];
}
const tasks = new Map<string, TaskDef>();
const need = new Map<string, Set<string>>();
const add = (t: Omit<TaskDef, "needs" | "labels" | "budgetUsd" | "checkers" | "paths"> & Partial<TaskDef>) => {
  if (tasks.has(t.key)) throw new Error(`task ${t.key} twice`);
  const lane = t.lane;
  const money = lane !== undefined && MONEY.has(lane);
  const paths = t.paths ?? (lane && lane !== JOURNEYS && lane !== INTEGRATIONS ? lanePaths(lane) : lane === INTEGRATIONS ? ["packages/runtime/src/integrations/"] : []);
  // A structural task (root, milestone, lane) is done by roll-up; a working task with no paths is a watch task.
  const working = t.kind !== "root" && t.kind !== "milestone" && t.kind !== "lane";
  const watch = working && paths.length === 0;
  const full: TaskDef = {
    ...t,
    needs: [],
    labels: [...(t.labels ?? []), ...(watch ? ["watch"] : [])],
    budgetUsd: watch ? 0 : (t.budgetUsd ?? 5),
    checkers: watch ? [] : (t.checkers ?? (money ? ["reviewer", "adversary"] : ["reviewer"])),
    paths,
  };
  tasks.set(t.key, full);
  need.set(t.key, new Set(t.needs ?? []));
  return full;
};
const needs = (from: string, ...to: string[]) => {
  const s = need.get(from)!;
  for (const k of to) if (k !== from) s.add(k);
};
/** Where a concept's hand-written code lives (system.layout): its book folder and src/<concept>/ in the backend and the
 * SDK; indexing's views are Ponder's (packages/indexer), and devnet's supervisor and world builder are packages/devnet. */
const OWN_PACKAGE: Record<string, string> = { indexing: "packages/indexer/", devnet: "packages/devnet/" };
const lanePaths = (c: string) => [`books/target/${c}/`, `packages/backend/src/${c}/`, `packages/sdk/src/${c}/`, ...(OWN_PACKAGE[c] ? [OWN_PACKAGE[c]!] : [])];
/** What every task may also change, but only to what the generators write at its version (swarm.scope): the gate admits a
 * change here when `pnpm generate:check` and `plan-tasks --check` pass, so a book-first change carries its outputs. */
const REGENERATED = ["docs/mission/tasks.json", "packages/*/src/generated/"];
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const RANK: Record<Priority, number> = { critical: 0, normal: 1, low: 2 };

// ── milestones: the plan's own (plan/plan.json), read from the file so there is one list ──────

/** A milestone as the tree holds it: the plan's id, words and exit lines, and what it waits for. */
interface Milestone { key: string; title: string; goal: string; needs: string[]; exit: [string, string][] }
const planFile = parsePlan(JSON.parse(readFileSync(PLAN, "utf8")) as unknown);
if (!planFile.ok) {
  console.error(`${PLAN}: ${planFile.error}`);
  process.exit(1);
}
/** What each milestone waits for in the tree. The plan holds the order, not these edges: the compatibility climb needs the
 * real chain and the door, the cloud needs the door, company life needs the climb; the rest wait for nothing. A milestone
 * the table does not know yet waits for the one before it. */
const MILESTONE_NEEDS: Readonly<Record<string, readonly string[]>> = { m1: [], m2: [], m3: [], m3b: ["m3"], m4: ["m2", "m3"], m5: ["m4"] };
const planMilestones = [...planFile.value.milestones].sort((a, b) => a.order - b.order);
const MILESTONES: Milestone[] = planMilestones.map((m, i) => ({
  key: m.id, title: m.title, goal: m.goal,
  needs: (MILESTONE_NEEDS[m.id] ?? (i > 0 ? [planMilestones[i - 1]!.id] : [])).map((k) => `milestone:${k}`),
  // a check's claim is held to 300 characters (below); the whole claim stays in plan/plan.json
  exit: m.exit.map((e): [string, string] => [`ms:${m.id}/${e.id}`, clip(e.claim, 300)]),
}));
/** The milestone the concepts' lanes sit under, and the ones a lane waits for: the real chain, then the door. */
const CLIMB = "milestone:m4";
for (const k of [CLIMB, "milestone:m2", "milestone:m3"]) if (!MILESTONES.some((m) => `milestone:${m.key}` === k)) failures.push(`plan/plan.json has no milestone ${k.slice("milestone:".length)}`);
/** Book records whose evals no lane owns: the system's own, and the environments the plan's milestones stand up. */
const MILESTONE_BOOK: Readonly<Record<string, readonly string[]>> = {
  m1: ["system:capxul"],
  // the devnet's own environment and the invariants over no table (the clock's among them) are stood up with the door and the clock
  m3: ["environment:devnet", ...ofKind("invariant").filter((i) => !(i.over as unknown[] | undefined)?.length).map(keyOf)],
  m3b: ["environment:shared-world", "environment:worlds"], m5: ["environment:staging", "environment:production"],
};

add({ key: "capxul", kind: "root", title: "Capxul rebuilt", priority: "critical", evals: ["ok:capxul"], checkers: [], paths: [],
  goal: "Capxul runs on the new stack and does everything the built book's operations promise (the old 215 less what the cut classified, plus the plugs and the door): every eval passes at the head of integration/build on a devnet, the system evals and the size budget hold, and staging's live evals hold for a week.",
  exit: [{ id: "ok:capxul", claim: "Aaron accepts the rebuild." }] });
const owned = new Map<string, string>(); // eval id → task key
const own = (task: string, ids: string[]) => {
  for (const id of ids) {
    const prior = owned.get(id);
    if (prior) failures.push(`eval ${id} owned by ${prior} and ${task}`);
    owned.set(id, task);
  }
  tasks.get(task)!.evals.push(...ids);
};
for (const m of MILESTONES) {
  const key = `milestone:${m.key}`;
  add({ key, kind: "milestone", title: m.title, goal: m.goal, parent: "capxul", priority: "critical", evals: [], checkers: [], paths: [], needs: m.needs,
    exit: m.exit.map(([id, claim]) => ({ id, claim })) });
  own(key, m.exit.map(([id]) => id));
  for (const r of MILESTONE_BOOK[m.key] ?? []) if (book.records.has(r)) own(key, evalIdsOf(r));
}

// ── lanes, doors, processes, rpcs, flows and operations ────────────────────────────────────

const lanes = [INTEGRATIONS, ...CONCEPTS.map((c) => c.id), JOURNEYS];
for (const lane of lanes) {
  const isConcept = lane !== INTEGRATIONS && lane !== JOURNEYS;
  add({ key: `lane:${lane}`, kind: "lane", lane, layer: laneLayer(lane), parent: CLIMB, priority: lane === "equity" ? "low" : "normal", evals: [],
    title: isConcept ? `Lane: ${lane}` : lane === INTEGRATIONS ? "Lane: integrations" : "Lane: journeys", checkers: [], paths: [],
    goal: isConcept
      ? `The ${lane} concept is built as its records say: its door, durable processes and operations pass every eval at the integration head, and its code imports other concepts only through their doors.`
      : lane === INTEGRATIONS
        ? "Every outside service is reached through its Effect service in packages/runtime, with its fake, its timeouts, retries and error mapping as its integration record says."
        : "Every journey runs end to end on a devnet, and each of its steps sends its proving event once, in order." });
  if (isConcept) own(`lane:${lane}`, evalIdsOf(`concept:${lane}`));
}

// The door: tables, machines (their transitions) and procedures, and the invariants over its tables.
const tablesOf = (c: string) => ofKind("table").filter((t) => concept(keyOf(t)) === c);
for (const c of CONCEPTS.map((x) => x.id)) {
  const key = `door:${c}`;
  add({ key, kind: "door", lane: c, layer: layerOf(c), parent: `lane:${c}`, priority: c === "equity" ? "low" : "normal", evals: [],
    title: `Door: ${c} tables, machines and procedures`,
    goal: `The ${c} concept's tables, state machines and door procedures exist as its records say: tenant-first keys and row-level security, only declared transitions, one event per machine, each procedure atomic.` });
  for (const t of tablesOf(c)) own(key, evalIdsOf(keyOf(t)));
  for (const m of ofKind("machine").filter((m) => concept(keyOf(m)) === c))
    for (const t of Object.values(m.t as object) as AnyRecord[]) own(key, evalIdsOf(keyOf(t)));
  for (const p of ofKind("procedure").filter((p) => concept(keyOf(p)) === c)) own(key, evalIdsOf(keyOf(p)));
}
for (const inv of ofKind("invariant")) {
  const over = linksFrom(keyOf(inv), "over");
  if (!over.length) continue; // owned by the milestone that stands up the world (MILESTONE_BOOK)
  own(`door:${concept(over[0]!)}`, evalIdsOf(keyOf(inv)));
  for (const t of over) needs(`door:${concept(over[0]!)}`, `door:${concept(t)}`);
}
// A door needs the doors of the tables its tables admit through, and of the procedures and tables its procedures reach.
for (const t of ofKind("table")) for (const a of linksFrom(keyOf(t), "admits")) needs(`door:${concept(keyOf(t))}`, `door:${concept(a)}`);
for (const p of ofKind("procedure")) {
  const from = `door:${concept(keyOf(p))}`;
  for (const k of [...linksFrom(keyOf(p), "invokes"), ...linksFrom(keyOf(p), "reads"), ...linksFrom(keyOf(p), "writes")]) needs(from, `door:${concept(k)}`);
}

// The integrations.
const integrationOfCall = (callKey: string) => `integration:${(get(callKey) as unknown as { integration: string }).integration}`;
for (const i of ofKind("integration")) {
  const key = keyOf(i);
  add({ key, kind: "integration", lane: INTEGRATIONS, layer: -1, parent: `lane:${INTEGRATIONS}`, priority: "normal", evals: [], record: key,
    title: clip(`Integration: ${i.id}, ${String(i.title)}`, 80),
    goal: clip(`The ${i.id} integration is an Effect service with its fake, and every call keeps its timeout, retries and error mapping as the record says.`, 1000) });
  own(key, evalIdsOf(key));
}

// The durable processes: after the door, before the operations of their own and later layers that start or wake them
// (swarm.process-order). A process that reacts to an earlier layer's transition or event needs that layer's door; one
// that reacts to a later layer's (notices to equity) builds against the generated event catalogue (swarm.events-not-needs).
const doorsOfKeys = (keys: string[]) => keys.filter((k) => conceptOf.has(k)).map((k) => `door:${concept(k)}`);
const wakes = new Map<string, Set<string>>(); // rpc or transition key → the processes it starts or wakes
const wake = (k: string, w: string) => wakes.set(k, new Set([...(wakes.get(k) ?? []), w]));
const namedRpcs = new Map<string, string[]>(); // process key → the rpcs its trigger, signals and waits name
for (const w of ofKind("workflow")) {
  const key = keyOf(w);
  const c = concept(key);
  add({ key, kind: "process", lane: c, layer: layerOf(c), parent: `lane:${c}`, priority: w.priority as Priority, evals: [], record: key,
    title: clip(`Process: ${w.id}`, 80),
    goal: clip(`The durable process ${w.id} (${String(w.title)}) runs as its record says: it resumes after a crash, each activity's side effect lands once, and every keyed wait is woken by what its key names.`, 1000) });
  own(key, evalIdsOf(key));
  needs(key, `door:${c}`, ...doorsOfKeys(["reads", "writes", "drives", "invokes"].flatMap((f) => linksFrom(key, f))));
  for (const call of linksFrom(key, "calls")) needs(key, integrationOfCall(call));
  const named = [...linksFrom(key, "trigger"), ...linksFrom(key, "signals"), ...linksFrom(key, "waits")];
  for (const k of named) {
    if (k.startsWith("rpc:") || k.startsWith("transition:")) wake(k, key);
    if (k.startsWith("transition:") || k.startsWith("event:") || k.startsWith("table:")) {
      const d = concept(k);
      if (layerOf(d) <= layerOf(c)) needs(key, `door:${d}`);
      else tasks.get(key)!.labels.push(`builds-on-events:${d}`);
    }
  }
  namedRpcs.set(key, named.filter((k) => k.startsWith("rpc:")));
}
/** The transitions an rpc drives, itself or through the procedures it invokes. */
const drivenBy = (key: string, seen = new Set<string>()): string[] => {
  if (seen.has(key)) return [];
  seen.add(key);
  return [...linksFrom(key, "drives"), ...linksFrom(key, "invokes").flatMap((p) => drivenBy(p, seen))];
};
/** What a task owning this rpc needs, besides the rpcs' owners: its doors, its integrations, and the processes of its own
 * or earlier layers that it starts or wakes. A later layer's process that reacts to it needs it instead (below). */
const rpcNeeds = (rpc: string): string[] => {
  const c = concept(rpc);
  const reach = ["reads", "writes", "invokes"].flatMap((f) => linksFrom(rpc, f));
  const procs = [rpc, ...drivenBy(rpc)].flatMap((k) => [...(wakes.get(k) ?? [])]).filter((w) => layerOf(concept(w)) <= layerOf(c));
  return [`door:${c}`, ...doorsOfKeys(reach), ...linksFrom(rpc, "calls").map(integrationOfCall), ...procs];
};

// Operations and helper flows: who reaches each rpc, in lane order (critical first, operations before helper flows).
const ops = ofKind("operation");
const flows = ofKind("flow");
const implementers = new Map<string, string[]>(); // flow or rpc key → operation keys
for (const o of ops) {
  const impl = linksFrom(keyOf(o), "implementedBy")[0]!;
  implementers.set(impl, [...(implementers.get(impl) ?? []), keyOf(o)]);
}
/** The devnet commands the world builder's steps run (dev approve, dev time warp, dev fund, …): system.build-order builds
 * "devnet's own dev commands alongside the harness", and no world, so no pilot refusal or claim that starts from one, can
 * be built without them. Read from the worlds' steps, so a new step command joins the pilots by itself. */
const worldCommands = new Set([
  // the builder's own: restore `from`, run the steps, then `dev snapshot save <name> --replace` (books/target/devnet/worlds.ts)
  "dev snapshot save",
  "dev snapshot restore",
  ...WORLDS.flatMap((w) => w.steps.flatMap((s) => [...s.run.matchAll(/capxul (dev [a-z-]+(?: [a-z-]+)?)/g)].map((m) => m[1]!))),
]);
/** Each world command's operation: the one whose command is its longest prefix ("dev time warp 2h" is dev.time.warp). */
const commandOf = (c: string) =>
  ops.filter((o) => c === String(o.command) || c.startsWith(`${String(o.command)} `)).sort((a, b) => String(b.command).length - String(a.command).length)[0];
const WORLD_OPS = [...new Set([...worldCommands].map(commandOf).filter((o) => o !== undefined).map((o) => keyOf(o!)))].sort();
/** Pilots: the book's critical operations, the web app's setup flow, which starts an Account's setup
 * (accounts.setup-in-web-app), and the world builder's devnet commands. */
const PILOTS = [...ops.filter((o) => o.priority === "critical").map(keyOf), "flow:client.account.setup", ...WORLD_OPS];
const helperFlows = flows.filter((f) => !implementers.has(keyOf(f)));
const stepRpcs = (flowKey: string) => linksFrom(flowKey, "steps");
const rpcsOfTask = (key: string): string[] => {
  if (key.startsWith("flow:")) return stepRpcs(key);
  const impl = linksFrom(key, "implementedBy")[0]!;
  return impl.startsWith("rpc:") ? [impl] : stepRpcs(impl);
};
interface Reacher { key: string; lane: string; rank: number; kindRank: number }
const reachers: Reacher[] = [
  ...ops.map((o) => ({ key: keyOf(o), lane: concept(keyOf(o)), rank: RANK[o.priority as Priority], kindRank: 0 })),
  ...helperFlows.map((f) => ({ key: keyOf(f), lane: concept(keyOf(f)), rank: PILOTS.includes(keyOf(f)) ? 0 : 1, kindRank: 1 })),
].sort((a, b) => a.rank - b.rank || a.kindRank - b.kindRank || a.key.localeCompare(b.key));
const reachedBy = new Map<string, Reacher[]>();
for (const r of reachers) for (const rpc of rpcsOfTask(r.key)) reachedBy.set(rpc, [...(reachedBy.get(rpc) ?? []), r]);

for (const o of ops) {
  const key = keyOf(o);
  const c = concept(key);
  const acc = (o.acceptance as unknown[] | undefined)?.length ?? 0;
  const ref = (o.refusals as unknown[] | undefined)?.length ?? 0;
  add({ key, kind: "operation", lane: c, layer: layerOf(c), parent: `lane:${c}`, priority: o.priority as Priority, evals: [], record: key,
    title: clip(`${String(o.command)}: ${String(o.title)}`, 80),
    labels: [`area:${String(o.area)}`, ...(PILOTS.includes(key) ? ["pilot"] : [])],
    goal: clip(`\`capxul ${String(o.command)}\` does what operation ${o.id} promises: its ${acc} acceptance claims and ${ref} refusals hold, its --json shape, events, spans and budget pass on a devnet at the head of integration/build, and its reference page agrees with it. ${String(o.about)}`, 1000) });
  own(key, evalIdsOf(key));
}
for (const f of helperFlows) {
  const key = keyOf(f);
  const c = concept(key);
  add({ key, kind: "flow", lane: c, layer: layerOf(c), parent: `lane:${c}`, priority: PILOTS.includes(key) ? "critical" : "normal", evals: [], record: key,
    title: clip(`Flow: ${String(f.sdk ?? f.id)}`, 80), labels: PILOTS.includes(key) ? ["pilot"] : [],
    goal: clip(`The Core SDK flow ${String(f.sdk ?? f.id)} (${String(f.title)}) runs its steps as its record says, within its budget and with its spans; no operation implements it, so its surfaces call it.`, 1000) });
  own(key, evalIdsOf(key));
}
// A flow's evals belong to the first operation that it implements; a later one needs that task.
for (const [impl, byOps] of implementers) {
  if (!impl.startsWith("flow:")) continue;
  const [first, ...rest] = byOps.map((k) => reachers.find((r) => r.key === k)!).sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
  own(first!.key, evalIdsOf(impl));
  for (const r of rest) needs(r.key, first!.key);
  for (const call of linksFrom(impl, "calls")) needs(first!.key, integrationOfCall(call));
}
for (const f of helperFlows) for (const call of linksFrom(keyOf(f), "calls")) needs(keyOf(f), integrationOfCall(call));

// Each rpc: owned by the first task of its own lane that reaches it, when only its own lane reaches it; otherwise it is
// its own task in its lane, so a need never crosses lanes between two operations (swarm.rpc-ownership).
const rpcOwner = new Map<string, string>();
for (const rpc of ofKind("rpc")) {
  const key = keyOf(rpc);
  const c = concept(key);
  const by = reachedBy.get(key) ?? [];
  let owner: string;
  if (by.length && by.every((r) => r.lane === c)) owner = by[0]!.key;
  else {
    owner = key;
    add({ key, kind: "rpc", lane: c, layer: layerOf(c), parent: `lane:${c}`, priority: by.length ? (["critical", "normal", "low"] as Priority[])[Math.min(...by.map((r) => r.rank))]! : "normal",
      evals: [], record: key, title: clip(`Rpc: ${rpc.id}`, 80), labels: by.some((r) => PILOTS.includes(r.key)) ? ["pilot"] : [],
      goal: clip(`The server endpoint ${rpc.id} (${String(rpc.title)}) answers as its record says: its declared errors only, its spans and its budget. ${by.length ? `Other lanes reach it: ${by.map((r) => r.key).slice(0, 4).join(", ")}.` : "No operation steps it; a durable process or another surface does."}`, 1000) });
    if (by.some((r) => PILOTS.includes(r.key))) PILOTS.push(key);
  }
  rpcOwner.set(key, owner);
  own(owner, evalIdsOf(key));
  needs(owner, ...rpcNeeds(key));
  for (const r of by) needs(r.key, owner);
}

// A process of a later layer that an rpc starts or wakes needs the task that owns the rpc.
for (const [w, rpcs] of namedRpcs) for (const rpc of rpcs) if (layerOf(concept(rpc)) < layerOf(concept(w))) needs(w, rpcOwner.get(rpc)!);

// The journeys.
for (const j of ofKind("journey")) {
  const key = keyOf(j);
  add({ key, kind: "journey", lane: JOURNEYS, layer: laneLayer(JOURNEYS), parent: `lane:${JOURNEYS}`, priority: "normal", evals: [], record: key,
    title: clip(`Journey: ${j.id}`, 80), goal: clip(`The journey ${j.id} (${String(j.title)}) runs end to end on a devnet, and each step sends its proving event once, in order.`, 1000) });
  own(key, evalIdsOf(key));
  needs(key, ...linksFrom(key, "steps").filter((k) => k.startsWith("operation:")));
}

// ── base needs: the pilots' closure waits for the spine; everything else for the whole of B3 ────

const closure = new Set<string>();
const visit = (k: string) => {
  if (closure.has(k) || !tasks.has(k)) return;
  const t = tasks.get(k)!;
  if (!t.lane) return;
  closure.add(k);
  for (const n of need.get(k)!) visit(n);
};
for (const p of PILOTS) visit(p);
for (const t of tasks.values()) {
  if (!t.lane || t.kind === "lane") continue;
  if (closure.has(t.key)) {
    needs(t.key, "milestone:m2");
    t.labels.push("pilot-closure");
  } else needs(t.key, "milestone:m2", "milestone:m3");
}

// ── checks: every eval owned once, every operation one task, layers, cycles ────────────────

for (const id of evalsById.keys()) if (!owned.has(id)) failures.push(`eval ${id} (${evalsById.get(id)![0]!.subject}) has no task`);
for (const o of ops) if (!tasks.has(keyOf(o))) failures.push(`operation ${o.id} has no task`);
for (const [from, to] of need) for (const k of to) if (!tasks.has(k)) failures.push(`${from} needs ${k}, which is no task`);
for (const t of tasks.values())
  if (!t.evals.length && ![...tasks.values()].some((c) => c.parent === t.key)) failures.push(`${t.key} has no eval and no child: it would read done at once`);
// The runner lists each exit line as a catalogue check, whose claim swarmD's ledger holds to 300 characters.
for (const t of tasks.values()) for (const e of t.exit ?? []) if (e.claim.length > 300) failures.push(`${e.id}: its claim is ${e.claim.length} characters; a check's claim is at most 300`);
// A task is never scheduled before its lane's layer. One that needs a later layer's task (notices' equity processes
// read equity's tables) is scheduled in that later layer, in its own lane, and only a layer that system.build-order puts
// last may pull a task later like this; any other need on a later layer is against the build order (swarm.layers).
const lastLayers = new Set([...LAST].map(layerOf));
for (let changed = true, round = 0; changed && round < 100; round++) {
  changed = false;
  for (const t of tasks.values()) {
    if (t.layer === undefined || t.kind === "lane") continue;
    for (const k of need.get(t.key)!) {
      const n = tasks.get(k);
      if (n?.layer === undefined || n.layer <= t.layer) continue;
      if (!lastLayers.has(n.layer) && !t.labels.some((l) => l.startsWith("after:"))) {
        failures.push(`${t.key} (layer ${t.layer}) needs ${k} (layer ${n.layer}): against system.build-order`);
        continue;
      }
      t.layer = n.layer;
      t.labels = [...t.labels.filter((l) => !l.startsWith("after:")), `after:${n.lane}`];
      changed = true;
    }
  }
}
// A parent is done only when its children are, so it waits on each child as on a need.
const edges = new Map<string, string[]>();
for (const t of tasks.values()) edges.set(t.key, [...need.get(t.key)!]);
for (const t of tasks.values()) if (t.parent) edges.get(t.parent)!.push(t.key);
const state = new Map<string, 1 | 2>();
const stack: string[] = [];
const dfs = (k: string): boolean => {
  if (state.get(k) === 2) return false;
  if (state.get(k) === 1) {
    failures.push(`cycle: ${[...stack.slice(stack.indexOf(k)), k].join(" → ")}`);
    return true;
  }
  state.set(k, 1);
  stack.push(k);
  for (const n of edges.get(k)!) if (dfs(n)) return true;
  stack.pop();
  state.set(k, 2);
  return false;
};
for (const k of [...tasks.keys()].sort()) if (dfs(k)) break;

// ── output ──────────────────────────────────────────────────────────────────────────────────

const KIND_ORDER: Kind[] = ["root", "milestone", "lane", "integration", "door", "process", "rpc", "flow", "operation", "journey"];
const order = (t: TaskDef) => [laneLayer(t.lane ?? INTEGRATIONS) + (t.lane ? 0 : -10), t.lane ?? "", KIND_ORDER.indexOf(t.kind), RANK[t.priority], t.key] as const;
const cmp = (a: TaskDef, b: TaskDef) => {
  const x = order(a), y = order(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return 0;
};
const out = [...tasks.values()].sort(cmp).map((t) => ({
  ...t,
  needs: [...need.get(t.key)!].sort(),
  labels: [...new Set([`kind:${t.kind}`, ...(t.lane ? [`lane:${t.lane}`, `layer:${t.layer}`] : []), ...(t.checkers.includes("adversary") ? ["money"] : []), ...t.labels])].sort(),
  evals: [...t.evals].sort(),
}));
const count = (f: (t: TaskDef) => boolean) => out.filter(f).length;
const isWorking = (t: TaskDef) => t.kind !== "root" && t.kind !== "milestone" && t.kind !== "lane";
/** The frontier once the real chain and the door are done (m2 and m3): the working tasks with checkers, outside the pilot
 * closure, whose needs are all met by those milestones and the closure (the loop's step 3 takes from it, one task per lane). */
const doneByM3 = new Set(["milestone:m2", "milestone:m3"]);
for (const k of closure) doneByM3.add(k);
const frontierAfterM3 = out.filter((t) => isWorking(t) && t.checkers.length && !doneByM3.has(t.key) && t.needs.every((n) => doneByM3.has(n)));
const counts = {
  tasks: out.length,
  working: count(isWorking),
  paired: count((t) => isWorking(t) && t.checkers.length > 0),
  watch: count((t) => t.labels.includes("watch")),
  milestones: count((t) => t.kind === "milestone"),
  lanes: count((t) => t.kind === "lane"),
  doors: count((t) => t.kind === "door"),
  processes: count((t) => t.kind === "process"),
  operations: count((t) => t.kind === "operation"),
  rpcs: count((t) => t.kind === "rpc"),
  flows: count((t) => t.kind === "flow"),
  integrations: count((t) => t.kind === "integration"),
  journeys: count((t) => t.kind === "journey"),
  pilotClosure: closure.size,
  money: count((t) => t.checkers.includes("adversary")),
  bookEvals: book.evals.length,
  uniqueBookEvals: evalsById.size,
  duplicateEvalIds: duplicated.length,
  milestoneEvals: [...owned.keys()].filter((id) => !evalsById.has(id)).length,
  needs: out.reduce((n, t) => n + t.needs.length, 0),
  budgetUsd: out.reduce((n, t) => n + (isWorking(t) ? t.budgetUsd : 0), 0),
  worldPilots: WORLD_OPS.length,
  frontierAfterM3: frontierAfterM3.length,
  frontierLanesAfterM3: new Set(frontierAfterM3.map((t) => t.lane)).size,
  bookRecords: book.records.size,
};
const doc = {
  about: "The build's task tree, derived from books/target by packages/plan/src/tasks.ts (docs/design/swarm.md, section 5). Do not edit: change the book or the script, then regenerate. It holds no counts over the book, so lanes that change different tasks never conflict here.",
  regenerated: REGENERATED,
  layers: [[INTEGRATIONS], ...computed, [JOURNEYS]],
  tasks: out,
};
const text = `${JSON.stringify(doc, null, 2)}\n`;

for (const w of warnings) console.warn(`warning: ${w}`);
if (failures.length) {
  for (const f of failures.slice(0, 40)) console.error(f);
  console.error(`${failures.length} failures`);
  process.exit(1);
}
if (check) {
  let prior = "";
  try { prior = readFileSync(OUT, "utf8"); } catch { /* missing counts as stale */ }
  if (prior !== text) {
    console.error(`${OUT} is stale: run node --experimental-strip-types packages/plan/src/tasks.ts`);
    process.exit(1);
  }
  console.log(`${OUT} is current`);
} else writeFileSync(OUT, text);
console.log(Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · "));
