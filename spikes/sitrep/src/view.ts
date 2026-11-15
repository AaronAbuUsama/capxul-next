// The conductor's state, as the sitrep shows it: derived from the event log, never stored, never typed.
//
//   events (append-only, on the `state` branch) --decode: Event--> replay each thing through its machine
//     --> fields merged from its events --> cross-references checked --> derived figures --decode: Snapshot--> page
//
// Every arrow fails loudly: an event that is not a declared event, a move a machine refuses, an actor a move does not
// allow, a reference to a thing that does not exist, or a snapshot that does not match its schema. So the page cannot
// show a state the blueprint does not allow, and nothing on it can drift from the history that produced it.
import * as Schema from "effect/Schema";
import { Derived, NOTHING_DERIVED } from "./derived.ts";
import { Actor, Instant, InvalidHistory, replay, type Allowed, type Entry, type Stamped } from "./language.ts";
import { Ask, AskAnswered, AskOpened, AskReopened, AskWithdrawn, askAllowed } from "./things/ask.ts";
import { Lane, LaneLanded, LaneLed, LaneOpened, laneAllowed } from "./things/lane.ts";
import { Milestone, MilestonePlanned, MilestoneRevised, MilestoneStarted, milestoneAllowed } from "./things/milestone.ts";
import { Plan, PlanAgreed, PlanRevised, PlanWritten, planAllowed } from "./things/plan.ts";
import { Sitrep, SitrepHeard, SitrepSaid, sitrepAllowed } from "./things/sitrep.ts";
import { Step, StepDropped, StepPlanned, StepProven, StepReopened, StepStarted, stepAllowed } from "./things/step.ts";
import { Thread, ThreadArchived, ThreadResumed, ThreadStarted, ThreadWaiting, threadAllowed } from "./things/thread.ts";

/** Every event the conductor's state can hold: what `capxul <thing> <verb>` validates before it appends one. */
export const Event = Schema.Union([
  PlanWritten, PlanAgreed, PlanRevised,
  MilestonePlanned, MilestoneStarted, MilestoneRevised,
  StepPlanned, StepStarted, StepProven, StepReopened, StepDropped,
  LaneOpened, LaneLed, LaneLanded,
  ThreadStarted, ThreadWaiting, ThreadResumed, ThreadArchived,
  AskOpened, AskAnswered, AskReopened, AskWithdrawn,
  SitrepSaid, SitrepHeard,
]);

/** The things, each with its machine, who may move it, and the field that names one. */
export const THINGS = {
  plan: { machine: Plan, allowed: planAllowed },
  milestone: { machine: Milestone, allowed: milestoneAllowed },
  step: { machine: Step, allowed: stepAllowed },
  lane: { machine: Lane, allowed: laneAllowed },
  thread: { machine: Thread, allowed: threadAllowed },
  ask: { machine: Ask, allowed: askAllowed },
  sitrep: { machine: Sitrep, allowed: sitrepAllowed },
} as const;
type ThingName = keyof typeof THINGS;

const EntrySchema = Schema.Struct({ event: Schema.String, by: Actor, at: Instant, state: Schema.String });
/** One thing as the page sees it: its id, its state, its whole history, and its fields as its events last set them. */
const Item = (machine: { State: Schema.Top }) =>
  Schema.Struct({ id: Schema.String, state: machine.State, history: Schema.Array(EntrySchema), since: Instant, fields: Schema.Record(Schema.String, Schema.Unknown) });

export const Snapshot = Schema.Struct({
  at: Instant,
  plan: Item(Plan),
  milestones: Schema.Array(Schema.Struct({ ...Item(Milestone).fields, done: Schema.Int, of: Schema.Int })),
  steps: Schema.Array(Item(Step)),
  lanes: Schema.Array(Item(Lane)),
  threads: Schema.Array(Item(Thread)),
  asks: Schema.Array(Item(Ask)),
  sitreps: Schema.Array(Item(Sitrep)),
  /** Only what needs Aaron: open asks and threads waiting on him. */
  needsYou: Schema.Struct({ asks: Schema.Array(Schema.String), threads: Schema.Array(Schema.String) }),
  /** Units of work left at every change, for the burn-down. */
  burn: Schema.Array(Schema.Struct({ at: Instant, left: Schema.Int, done: Schema.Int, total: Schema.Int, what: Schema.String })),
  /** Facts read from their owners at the refresh (health, pull requests, measures), each source with its time. */
  derived: Derived,
});
export type Snapshot = typeof Snapshot.Type;

const STAMP = new Set(["_tag", "by", "at"]);
const thingOf = (tag: string): ThingName => tag.slice(0, tag.indexOf("_")) as ThingName;

/** The snapshot of a log, or an InvalidHistory naming the first thing wrong with it. */
export const project = (log: ReadonlyArray<unknown>, now: string, derived: unknown = NOTHING_DERIVED): Snapshot => {
  const events = log.map((raw, i) => {
    try { return Schema.decodeUnknownSync(Event)(raw) as Stamped & Record<string, unknown>; }
    catch (e) { throw new InvalidHistory(`event ${i + 1} is no declared event: ${String(e).split("\n")[0]}`); }
  });
  const groups = new Map<string, Array<Stamped & Record<string, unknown>>>();
  for (const e of events) {
    const thing = thingOf(e._tag), key = `${thing}:${String(e[thing])}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const items: Record<ThingName, Array<{ id: string; state: string; history: Array<Entry>; since: string; fields: Record<string, unknown> }>> =
    { plan: [], milestone: [], step: [], lane: [], thread: [], ask: [], sitrep: [] };
  for (const [key, list] of groups) {
    const [thing, id] = key.split(":") as [ThingName, string];
    const { machine, allowed } = THINGS[thing];
    const { state, history } = replay(machine as never, allowed as Allowed, id, list);
    const fields: Record<string, unknown> = {};
    for (const e of list) for (const [k, v] of Object.entries(e)) if (!STAMP.has(k) && k !== thing && v !== undefined) fields[k] = v;
    items[thing].push({ id, state, history, since: history[history.length - 1]!.at, fields });
  }

  // References: every name a thing gives must be a thing in the log, and both sides must agree.
  const ids = (t: ThingName) => new Set(items[t].map((x) => x.id));
  const need = (ok: boolean, what: string) => { if (!ok) throw new InvalidHistory(what); };
  need(items.plan.length === 1, `there must be exactly one plan, not ${items.plan.length}`);
  const plan = items.plan[0]!;
  for (const m of plan.fields.milestones as string[]) need(ids("milestone").has(m), `the plan names milestone ${m}, which was never planned`);
  for (const m of items.milestone) for (const s of m.fields.steps as string[]) {
    const step = items.step.find((x) => x.id === s);
    need(step !== undefined, `milestone ${m.id} names step ${s}, which was never planned`);
    need(step!.fields.milestone === m.id, `step ${s} says it is in milestone ${String(step!.fields.milestone)}, but milestone ${m.id} lists it`);
  }
  for (const s of items.step) for (const n of s.fields.needs as string[]) need(ids("step").has(n), `step ${s.id} needs ${n}, which was never planned`);
  for (const l of items.lane) for (const s of l.fields.steps as string[]) need(ids("step").has(s), `lane ${l.id} names step ${s}, which was never planned`);
  for (const a of items.ask) need(ids("thread").has(a.fields.from as string), `ask ${a.id} comes from thread ${String(a.fields.from)}, which never started`);
  for (const r of items.sitrep) for (const l of r.fields.lanes as string[]) need(ids("lane").has(l), `sitrep ${r.id} names lane ${l}, which was never opened`);
  const facts = Schema.decodeUnknownSync(Derived)(derived);
  for (const p of facts.pulls) need(ids("lane").has(p.lane), `pull request ${p.number} names lane ${p.lane}, which was never opened`);

  // Derived figures: milestone progress and the burn-down, from the steps' own histories.
  const unitsOf = (s: (typeof items.step)[number]) => s.fields.units as number;
  const milestones = items.milestone.map((m) => {
    const steps = items.step.filter((s) => (m.fields.steps as string[]).includes(s.id) && s.state !== "dropped");
    return { ...m, done: steps.filter((s) => s.state === "done").reduce((a, s) => a + unitsOf(s), 0), of: steps.reduce((a, s) => a + unitsOf(s), 0) };
  });
  const changes = events.filter((e) => ["step_planned", "step_proven", "step_reopened", "step_dropped"].includes(e._tag));
  let total = 0, done = 0;
  const burn = changes.map((e) => {
    const units = unitsOf(items.step.find((s) => s.id === e.step)!);
    if (e._tag === "step_planned") total += units; else if (e._tag === "step_proven") done += units;
    else if (e._tag === "step_reopened") done -= units; else total -= units;
    return { at: e.at, left: total - done, done, total, what: `${e._tag.replace("step_", "step " + String(e.step) + " ")}` };
  });

  return Schema.decodeUnknownSync(Snapshot)({
    at: now, plan, milestones, steps: items.step, lanes: items.lane, threads: items.thread, asks: items.ask, sitreps: items.sitrep,
    needsYou: { asks: items.ask.filter((a) => a.state === "open").map((a) => a.id), threads: items.thread.filter((t) => t.state === "waiting").map((t) => t.id) },
    burn, derived,
  });
};
