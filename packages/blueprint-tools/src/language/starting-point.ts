// What a starting point is (today's word in the code: a starting world): a named state a journey begins from, made
// through the door by the blueprint's own operations from the one before it. The blueprint declares each one
// (packages/blueprint, src/starting-points/points.ts), naming its operations; this is the format they share, with the
// operation's name left open so the toolkit needs nothing of the blueprint.
import type * as Schema from "effect/Schema";

/** One step of making a starting world: an operation through the door, as someone, or a wait for background work. */
export interface Step<Name extends string = string> {
  readonly operation: Name | "wait";
  /** "operator" (the first operator, the world's owner), "second operator", or a person of the cast. */
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
  /** Every fact a journey from this world is handed: its ancestors' and its own steps'. */
  readonly facts: Facts;
  /** One example of the facts, which the tests and the run against empty handlers hand to a journey. */
  readonly example: unknown;
}

/** True when `world` is `ancestor` or is made from it, so a journey from `world` holds `ancestor`'s facts. */
export const holdsFactsOf = (world: StartingWorld, ancestor: StartingWorld): boolean =>
  world === ancestor || (world.from !== null && holdsFactsOf(world.from, ancestor));
