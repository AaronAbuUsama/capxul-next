// What a starting point is (today's word in the code: a starting world): a named state a journey begins from, made
// through the door by the blueprint's own operations from the one before it. The blueprint declares each one
// (packages/blueprint, src/starting-points/points.ts), naming its operations; this is the format they share, with the
// operation's name left open so the toolkit needs nothing of the blueprint.
import * as Arr from "effect/Array";
import type * as Schema from "effect/Schema";

/** One step of making a starting world: an operation through the door, as someone, or a wait for background work. */
export interface Step<Name extends string = string> {
  readonly operation: Name | "wait";
  /**
   * "operator" (the first operator, the world's owner), "second operator", or a person of the cast: for one that takes the
   * journey's cast (`parameters`), a role, played by whoever the journey casts in it.
   */
  readonly as: string;
  readonly does: string;
  /** The fact the step's last answer becomes, by its name in the world's facts; null when it becomes none. */
  readonly fact: string | null;
}

export interface StartingWorld<
  Facts extends Schema.Codec<unknown, unknown> = Schema.Codec<unknown, unknown>,
  Name extends string = string,
> {
  readonly name: string;
  /** The starting world this one is made from; null for one made from nothing. */
  readonly from: StartingWorld<Schema.Codec<unknown, unknown>, Name> | null;
  /** What it holds beyond `from`. */
  readonly holds: string;
  readonly steps: ReadonlyArray<Step<Name>>;
  /**
   * How a journey gets it. `from its template`: the world was made once and saved as a template snapshot, and a
   * journey gets it by the world being reset in place to that snapshot. `by its steps`: the steps run for each
   * journey, from a world of `from` got as that world is got.
   */
  readonly made: "from its template" | "by its steps";
  /**
   * What a journey hands it, when it is made for each journey with the journey's own: `cast`, who plays each
   * role its steps name; `company`, the handle of the company its steps found. One made from one that
   * takes them takes them too, and every one that takes any is made by its steps, never from a template shared by
   * journeys. Empty for one made the same for every journey.
   */
  readonly parameters: ReadonlyArray<Parameter>;
  /** Every fact a journey from this world is handed: its ancestors' and its own steps'. */
  readonly facts: Facts;
  /** One example of the facts, which the tests and the run against empty handlers hand to a journey. */
  readonly example: unknown;
}

/** What a journey may hand one made for it (its `parameters`). */
export type Parameter = "cast" | "company";

/** What the rules of parameters read of one. */
interface Parameterised {
  readonly name: string;
  readonly from: Parameterised | null;
  readonly made: "from its template" | "by its steps";
  readonly parameters: ReadonlyArray<Parameter>;
}

/**
 * Why `world` breaks the rules of parameters, or null when it keeps them: it takes every parameter its `from` takes,
 * and one that takes any is made by its steps.
 */
export const parametersMisfit = (world: Parameterised): string | null => {
  const inherited = world.from === null ? [] : world.from.parameters;
  const missing = Arr.filter(inherited, (each) => !Arr.contains(world.parameters, each));
  if (missing.length > 0)
    return `${world.name} is made from ${world.from?.name} but does not take ${Arr.join(missing, ", ")}`;
  if (world.parameters.length > 0 && world.made !== "by its steps")
    return `${world.name} takes ${Arr.join(world.parameters, ", ")} but is made from its template`;
  return null;
};

/** True when `world` is `ancestor` or is made from it, so a journey from `world` holds `ancestor`'s facts. */
export const holdsFactsOf = (world: StartingWorld, ancestor: StartingWorld): boolean =>
  world === ancestor || (world.from !== null && holdsFactsOf(world.from, ancestor));
