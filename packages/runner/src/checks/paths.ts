// The generic `path` check (docs/roadmap.md, "Lifecycles are machines in the blueprint", step 3.4). The blueprint
// declares each thing's lifecycle as a machine: its states, the event that starts it, and its moves, each made by an
// operation, sending one event, and refused with a declared refusal from each state it cannot start from. This reads a
// journey's calls in order and checks that the events of each thing, grouped by the machine they belong to and by the
// value of its key, form a path through it: its start's event first, then each a move from the state it stands in;
// and that a refusal the machine declares names the state it was refused from. It also counts what was reached:
// coverage, the scenario author's target, not a gate. Pure. No scenario writes it, and a builder never changes it.
import { machines } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import type { Call } from "../client.ts";
import type { Coverage } from "../record.ts";
import type { Kept } from "../world/database.ts";
import type { Check, CheckedCall } from "./checks.ts";

/** A machine of the blueprint, as the path check reads it (packages/blueprint/src/machine.ts). */
export interface PathMachine {
  readonly name: string;
  /** The field every event of the thing carries naming it, and every refusal its moves declare. */
  readonly key: string;
  readonly states: ReadonlyArray<string>;
  readonly start: { readonly state: string; readonly by: string; readonly event: string };
  readonly moves: {
    readonly [move: string]: {
      readonly from: ReadonlyArray<string>;
      readonly to: string;
      readonly by: string;
      readonly event: string;
      readonly otherwise: { readonly [state: string]: { readonly refusal: string } | "unchanged" };
    };
  };
}

/** One call of a journey, as the path check reads it. */
export interface PathCall {
  readonly operation: string;
  /** The refusal's tag, for a refused call. */
  readonly refusal: string | null;
  /** The refusal itself, for a refused call: what it carries. */
  readonly refused: unknown;
  /** The events recorded under the call's trace id, in the order they were written, with what each carried. */
  readonly events: ReadonlyArray<{ readonly event: string; readonly payload: unknown }>;
}

/** Each call's `path` check, null for a call that touched no machine, and what the journey reached of each machine. */
export interface Paths {
  readonly checks: ReadonlyArray<Check | null>;
  readonly coverage: Coverage;
}

/** Every machine the blueprint declares. */
export const declaredMachines: ReadonlyArray<PathMachine> = Rec.values(machines);

const keyed = (machine: PathMachine, value: string) => `${machine.name}\u0000${value}`;
const pairOf = (machine: PathMachine, state: string, move: string) => `${machine.name}\u0000${state}\u0000${move}`;
const textOf = (value: unknown): string | null => (Predicate.isString(value) ? value : null);
const fieldOf = (value: unknown, field: string): string | null =>
  Predicate.hasProperty(value, field) ? textOf(value[field]) : null;

/** Every refused pair a machine declares: each state a move cannot start from that it refuses, in order. */
const refusedPairsOf = (machine: PathMachine) =>
  Arr.flatMap(Rec.toEntries(machine.moves), ([move, declared]) =>
    Arr.flatMap(machine.states, (state) => {
      const otherwise = declared.otherwise[state];
      return otherwise === undefined || otherwise === "unchanged" ? [] : [{ state, move, refusal: otherwise.refusal }];
    }),
  );

/** The machine and the start or move an event's tag belongs to. */
const ownerOf = (against: ReadonlyArray<PathMachine>, event: string) =>
  Arr.findFirst(against, (machine): Option.Option<{ readonly machine: PathMachine; readonly move: string | null }> => {
    if (machine.start.event === event) return Option.some({ machine, move: null });
    const move = Arr.findFirst(Rec.toEntries(machine.moves), ([, declared]) => declared.event === event);
    return Option.map(move, ([name]) => ({ machine, move: name }));
  });

/** Checks every call of one journey, in order, against `against`; pure. */
export const checkPaths = (against: ReadonlyArray<PathMachine>, calls: ReadonlyArray<PathCall>): Paths => {
  const standing = new Map<string, string>();
  const reached = new Map<string, number>();
  const count = (what: string) => reached.set(what, (reached.get(what) ?? 0) + 1);
  const checks = Arr.map(calls, (call): Check | null => {
    const problems: Array<string> = [];
    const notes: Array<string> = [];
    let touched = false;
    for (const recorded of call.events) {
      const owner = ownerOf(against, recorded.event);
      if (Option.isNone(owner)) continue;
      touched = true;
      const { machine, move } = owner.value;
      const thing = fieldOf(recorded.payload, machine.key);
      if (thing === null) {
        problems.push(`${recorded.event} carries no ${machine.key}`);
        continue;
      }
      const at = standing.get(keyed(machine, thing));
      const named = `${machine.name} ${thing}`;
      if (move === null) {
        if (call.operation !== machine.start.by)
          problems.push(`${named}: ${recorded.event} sent by ${call.operation}, declared by ${machine.start.by}`);
        if (at !== undefined) problems.push(`${named}: ${recorded.event} again, while it is ${at}`);
        else notes.push(`${named}: started ${machine.start.state}`);
        standing.set(keyed(machine, thing), machine.start.state);
        count(machine.name);
        continue;
      }
      const declared = machine.moves[move];
      if (declared === undefined) continue;
      if (call.operation !== declared.by)
        problems.push(`${named}: ${recorded.event} sent by ${call.operation}, declared by ${declared.by}`);
      if (at === undefined) problems.push(`${named}: ${recorded.event} (${move}) before ${machine.start.event}`);
      else if (!Arr.contains(declared.from, at))
        problems.push(
          `${named}: ${recorded.event} (${move}) starts from ${Arr.join(declared.from, " or ")}, but it is ${at}`,
        );
      else notes.push(`${named}: ${at} to ${declared.to} by ${move}`);
      standing.set(keyed(machine, thing), declared.to);
      count(`${machine.name}\u0000${move}`);
    }
    if (call.refusal !== null)
      for (const machine of against)
        for (const [move, declared] of Rec.toEntries(machine.moves)) {
          if (declared.by !== call.operation) continue;
          const refusing = Arr.filter(
            Rec.toEntries(declared.otherwise),
            ([, otherwise]) => otherwise !== "unchanged" && otherwise.refusal === call.refusal,
          );
          if (refusing.length === 0) continue;
          touched = true;
          const state = fieldOf(call.refused, "state");
          const thing = fieldOf(call.refused, machine.key);
          const named = `${machine.name} ${thing ?? "(unnamed)"}`;
          if (state === null) {
            problems.push(`${named}: ${call.refusal} carries no state`);
            continue;
          }
          if (!Arr.some(refusing, ([from]) => from === state)) {
            problems.push(`${named}: ${move} refused with ${call.refusal} from ${state}, which the machine does not`);
            continue;
          }
          const at = thing === null ? undefined : standing.get(keyed(machine, thing));
          if (at !== undefined && at !== state)
            problems.push(`${named}: ${move} refused from ${state}, but its events left it ${at}`);
          else notes.push(`${named}: ${move} refused from ${state} with ${call.refusal}`);
          count(pairOf(machine, state, move));
        }
    if (!touched) return null;
    return {
      check: "path",
      passed: problems.length === 0,
      detail: Arr.join(problems.length === 0 ? notes : problems, "; "),
    };
  });
  const coverage = Arr.map(against, (machine) => ({
    machine: machine.name,
    started: reached.get(machine.name) ?? 0,
    moves: Arr.map(Rec.keys(machine.moves), (move) => ({
      move,
      reached: reached.get(`${machine.name}\u0000${move}`) ?? 0,
    })),
    refused: Arr.map(refusedPairsOf(machine), (pair) => ({
      ...pair,
      reached: reached.get(pairOf(machine, pair.state, pair.move)) ?? 0,
    })),
  }));
  return { checks, coverage };
};

type RefusedPair = Coverage[number]["refused"][number];

const total = (counts: ReadonlyArray<number>): number => Arr.reduce(counts, 0, (sum, n) => sum + n);

/** The coverage of several journeys, summed machine by machine, in the order the machines first appear. */
export const sumCoverage = (journeys: ReadonlyArray<Coverage>): Coverage => {
  const lines = Arr.flatten(journeys);
  return Arr.map(Arr.dedupe(Arr.map(lines, (line) => line.machine)), (machine) => {
    const of = Arr.filter(lines, (line) => line.machine === machine);
    const moves = Arr.dedupe(Arr.flatMap(of, (line) => Arr.map(line.moves, (each) => each.move)));
    const declared: ReadonlyArray<RefusedPair> = Arr.flatMap(of, (line) => line.refused);
    const pairs = Arr.dedupeWith(declared, (a, b) => a.state === b.state && a.move === b.move);
    return {
      machine,
      started: total(Arr.map(of, (line) => line.started)),
      moves: Arr.map(moves, (move) => ({
        move,
        reached: total(
          Arr.flatMap(of, (line) =>
            Arr.map(
              Arr.filter(line.moves, (each) => each.move === move),
              (each) => each.reached,
            ),
          ),
        ),
      })),
      refused: Arr.map(pairs, (pair) => ({
        state: pair.state,
        move: pair.move,
        refusal: pair.refusal,
        reached: total(
          Arr.flatMap(of, (line) =>
            Arr.map(
              Arr.filter(line.refused, (each) => each.state === pair.state && each.move === pair.move),
              (each) => each.reached,
            ),
          ),
        ),
      })),
    };
  });
};

/** A journey's calls as the path check reads them, with the events Core kept under each one's trace id. */
export const pathCallsOf = (calls: ReadonlyArray<Call>, kept: Kept): ReadonlyArray<PathCall> =>
  Arr.map(calls, (call) => ({
    operation: call.operation,
    refusal: call.refusal,
    refused: Option.getOrNull(call.error ?? Option.none()),
    events: Arr.filter(kept.events, (event) => event.trace_id === call.traceId),
  }));

/** Applies the path check to a journey's checked calls: each call that touched a machine gains its `path` check. */
export const withPaths = (
  calls: ReadonlyArray<Call>,
  kept: Kept,
  checked: ReadonlyArray<CheckedCall>,
): { readonly calls: ReadonlyArray<CheckedCall>; readonly coverage: Coverage } => {
  const paths = checkPaths(declaredMachines, pathCallsOf(calls, kept));
  return {
    calls: Arr.map(checked, (call, index) => {
      const path = paths.checks[index] ?? null;
      return path === null ? call : { ...call, checks: [...call.checks, path] };
    }),
    coverage: paths.coverage,
  };
};
