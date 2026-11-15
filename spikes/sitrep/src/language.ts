// What the blueprint's toolkit lacks for the conductor's state, proposed here and graduated into
// packages/blueprint-tools/src/language/ if agreed:
//
// 1. A stamp on every event: WHO changed the thing (an agent's thread, a person, or the pipeline) and WHEN. Product
//    events carry their own actors today (`by: PersonId` on member_invited); nothing makes it uniform.
// 2. Replay: today a machine answers one move (`step`), but nothing derives a thing's state from its history. Here a
//    thing's state is never stored: it is its events played through its machine, so it cannot drift from them, and an
//    event a machine would refuse makes the whole history invalid instead of silently applying.
// 3. Who may make a move: the blueprint will declare roles per operation (5.1); here each move names the kinds of
//    actor allowed, so "only Aaron agrees a plan" and "only the pipeline proves a step" are declarations, not habits.
// 4. Prose as a value: a required section of words, with a minimum, so "a milestone has a goal" is enforced.
import * as Schema from "effect/Schema";
import type { Machine } from "@capxul/blueprint-tools";

/** A UTC instant, to the second. */
export const Instant = Schema.String.check(Schema.isPattern(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/));
/** A required section of words: at least a sentence. */
export const Prose = Schema.String.check(Schema.isMinLength(20), Schema.isMaxLength(4000));
/** A short title. */
export const Title = Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(90));
/** A link anyone with access can open. */
export const Url = Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/));
/** A thread, by its id in its agent (a Claude Code session, an Amp thread, a Codex session). */
export const ThreadId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{6,80}$/));
/** A person the conductor answers to, by handle. */
export const PersonHandle = Schema.Literals(["aaron"]);
/** A run of the pipeline in CI, by its id. */
export const RunRef = Schema.String.check(Schema.isPattern(/^ci-\d+$/));

/** Who made a change: an agent's thread, a person, or the pipeline (a CI run's verdict). */
export const Actor = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("agent"), thread: ThreadId }),
  Schema.Struct({ kind: Schema.Literal("person"), person: PersonHandle }),
  Schema.Struct({ kind: Schema.Literal("pipeline"), run: RunRef }),
]);
export type Actor = typeof Actor.Type;
export type ActorKind = Actor["kind"];

/** The stamp every conductor event carries, beside its own fields. */
export const stamp = { by: Actor, at: Instant } as const;

/** Any stamped event: its tag, its thing's key, and its stamp. */
export interface Stamped {
  readonly _tag: string;
  readonly by: Actor;
  readonly at: string;
}

/** Which actors may cause each event: the move's `allowed`, declared beside the machine. */
export type Allowed = { readonly [event: string]: ReadonlyArray<ActorKind> };

/** One entry of a thing's history: what happened, who did it, when, and the state it left. */
export interface Entry {
  readonly event: string;
  readonly by: Actor;
  readonly at: string;
  readonly state: string;
}

export class InvalidHistory extends Error {}

type AnyMachine = Machine.Machine<string, string, ReadonlyArray<string>, string, { readonly [m: string]: Machine.Move }>;

/**
 * A thing's state, derived from its events in order. The first must be its machine's start; every later one must be a
 * move its machine makes from the state reached, by an actor that move allows. Anything else is an invalid history.
 */
export const replay = (machine: AnyMachine, allowed: Allowed, key: string, events: ReadonlyArray<Stamped>) => {
  const byEvent = new Map(Object.entries(machine.moves).map(([name, move]) => [move.event, name]));
  let state: string | undefined;
  const history: Array<Entry> = [];
  for (const e of events) {
    const who = allowed[e._tag];
    if (who === undefined || !who.includes(e.by.kind))
      throw new InvalidHistory(`${machine.name} ${key}: ${e._tag} at ${e.at} by the ${e.by.kind}, which may not make that move`);
    if (state === undefined) {
      if (e._tag !== machine.start.event) throw new InvalidHistory(`${machine.name} ${key}: starts with ${e._tag}`);
      state = machine.start.state;
    } else {
      const move = byEvent.get(e._tag);
      if (move === undefined) throw new InvalidHistory(`${machine.name} ${key}: ${e._tag} is no move of it`);
      const stepped = machine.step(state, move);
      if (stepped._tag === "Refused")
        throw new InvalidHistory(`${machine.name} ${key}: ${move} from ${state} at ${e.at} is refused (${stepped.refusal})`);
      if (stepped._tag === "Moved") state = stepped.to;
    }
    history.push({ event: e._tag, by: e.by, at: e.at, state });
  }
  if (state === undefined) throw new InvalidHistory(`${machine.name} ${key}: no events`);
  return { state, history };
};
