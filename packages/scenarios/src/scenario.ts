// How a scenario is declared. A scenario proves one acceptance claim of the blueprint black-box: from the claim's
// starting world, through `Capxul` only, reading only what the operations answer. It holds no check of events, spans
// or speed: the runner applies those to every call it makes.
import { allClaims, startingWorlds, type Claim, type OperationName, type StartingWorld } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { Capxul, Failure } from "./client.ts";

/** The claim a scenario proves: an operation, and the claim's number in claims.md (from 1). */
export interface Proves {
  readonly operation: OperationName;
  readonly claim: number;
}

/**
 * What a scenario does in its world: an Effect that needs only `Capxul`. It may fail with what a call through the
 * door fails with (a declared refusal) or with `ExpectationFailed`; any failure or defect fails the scenario.
 */
export type Run = Effect.Effect<void, ExpectationFailed | Failure, Capxul>;

export interface Scenario {
  /** Unique among all scenarios; it names the run record. */
  readonly name: string;
  /** The claim it proves; null for an example, which proves none and is not counted. */
  readonly proves: Proves | null;
  /** The starting world it begins from: its claim's, for a scenario that proves one. */
  readonly given: StartingWorld;
  readonly run: Run;
}

/** The claim `proves` names, if the blueprint declares it. */
export const claimOf = (proves: Proves): Option.Option<Claim> =>
  Option.fromNullishOr(allClaims[proves.operation].claims[proves.claim - 1]);

/**
 * Declares the scenario that proves one claim. Its name is the operation and the claim's number, and it begins from
 * the claim's own starting world. A claim the blueprint does not declare makes a scenario that dies at once, and
 * the registry's test fails on it.
 */
export const scenario = (proves: Proves, run: Run): Scenario => {
  const name = `${proves.operation} claim ${proves.claim}`;
  return Option.match(claimOf(proves), {
    onNone: () => ({
      name,
      proves,
      given: startingWorlds.nothing,
      run: Effect.die(`${proves.operation} has no claim ${proves.claim} in the blueprint`),
    }),
    onSome: (claim) => ({ name, proves, given: claim.given, run }),
  });
};

/** Declares an example: a scenario that proves no claim, to show the format and to try the runner. */
export const example = (name: string, given: StartingWorld, run: Run): Scenario => ({
  name: `example: ${name}`,
  proves: null,
  given,
  run,
});

/** What a scenario fails with when the world did not answer as its claim says. */
// oxlint-disable-next-line capxul/blueprint-owns-names -- a scenario's own failed expectation, not a refusal of Capxul's
export class ExpectationFailed extends Schema.TaggedError<ExpectationFailed, { readonly brand: unique symbol }>()(
  "ExpectationFailed",
  {
    message: Schema.String,
  },
) {}

/** Fails the scenario with `message` unless `holds`. */
export const expect = (holds: boolean, message: string): Effect.Effect<void, ExpectationFailed> =>
  holds ? Effect.void : Effect.fail(ExpectationFailed.make({ message }));
