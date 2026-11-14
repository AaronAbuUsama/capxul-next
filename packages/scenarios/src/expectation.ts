// How a journey says what it expects: `expect`, the failure it fails with, and `given`, the facts of the starting
// world it was handed. Every check and every step fails with `ExpectationFailed` when the world did not answer as the
// blueprint says, never with a defect.
import { holdsFactsOf, type StartingWorld } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Given } from "./client.ts";

/** What a journey fails with when the world did not answer as the blueprint says. */
// oxlint-disable-next-line capxul/blueprint-owns-names -- a journey's own failed expectation, not a refusal of Capxul's
export class ExpectationFailed extends Schema.TaggedError<ExpectationFailed, { readonly brand: unique symbol }>()(
  "ExpectationFailed",
  {
    message: Schema.String,
  },
) {}

/** Fails with `message` unless `holds`. */
export const expect = (holds: boolean, message: string): Effect.Effect<void, ExpectationFailed> =>
  holds ? Effect.void : Effect.fail(ExpectationFailed.make({ message }));

/** Fails with `message`. */
export const failWith = (message: string): Effect.Effect<never, ExpectationFailed> =>
  Effect.fail(ExpectationFailed.make({ message }));

/**
 * The facts of `world`, typed by its own schema: the journey's starting world's, or those of a world it is made
 * from. Facts the maker did not keep, or that are not of the schema, are a defect: the journey cannot act on them.
 */
export const given = <Facts extends Schema.Codec<unknown, unknown>>(
  world: StartingWorld<Facts>,
): Effect.Effect<Facts["Type"], never, Given> =>
  Effect.gen(function* () {
    const handed = yield* Given;
    if (!holdsFactsOf(handed.world, world))
      return yield* Effect.die(`a journey from ${handed.world.name} asked for the facts of ${world.name}`);
    const facts = yield* handed.facts;
    return yield* Effect.orDie(Schema.decodeUnknownEffect(world.facts)(facts));
  });

/** Whether the journey's starting world holds the facts of `world`: it is `world` or made from it. */
export const holds = (world: StartingWorld): Effect.Effect<boolean, never, Given> =>
  Effect.map(Effect.service(Given), (handed) => holdsFactsOf(handed.world, world));
