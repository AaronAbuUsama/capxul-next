// What the index's own record says about its starts, in one line, for the run record of a create whose index step
// failed: the index's Durable Object, and its record with every try, is destroyed with the world right after.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { StepTimedOut } from "../../common/failures.ts";
import { partStatus } from "../../things/world/client.ts";
import type { World } from "../../things/world/values.ts";

const Tried = Schema.Struct({
  attempts: Schema.Array(
    Schema.Struct({ outcome: Schema.String, message: Schema.NullOr(Schema.String), ms: Schema.Finite }),
  ),
  refusals: Schema.Finite,
  ms: Schema.Finite,
});
type Tried = typeof Tried.Type;
const Seen = Schema.Struct({
  running: Schema.Boolean,
  health: Schema.NullOr(Schema.Finite),
  ready: Schema.NullOr(Schema.Finite),
  starts: Schema.Array(Tried),
  gaveUp: Schema.Array(Tried),
});

/** One start, in a few words: its tries, its refusals, how long they took and how the last one ended. */
const summary = (tried: Tried): string => {
  const last = Option.match(Arr.last(tried.attempts), {
    onNone: () => "no try recorded",
    onSome: (attempt) => `the last ${attempt.outcome}${attempt.message === null ? "" : ` (${attempt.message})`}`,
  });
  return `${Arr.length(tried.attempts)} tries, ${tried.refusals} refused, ${Math.round(tried.ms / 1000)} s, ${last}`;
};

const latest = (list: ReadonlyArray<Tried>): string =>
  Option.match(Arr.last(list), { onNone: () => "none", onSome: summary });

/** The index's account of itself; never fails, since it is read only to explain a failure. */
export const indexAccount = (world: Pick<World, "door">) =>
  partStatus(world, "index").pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Seen)),
    Effect.map(
      (seen) =>
        `running ${seen.running}, health ${seen.health ?? "no answer"}, ready ${seen.ready ?? "no answer"}; ` +
        `${Arr.length(seen.starts)} starts held, the latest ${latest(seen.starts)}; ` +
        `${Arr.length(seen.gaveUp)} gave up, the latest ${latest(seen.gaveUp)}`,
    ),
    Effect.orElseSucceed(() => "the index's record could not be read"),
  );

/**
 * The index step, with the index's account of itself added to its failure when it times out: the index's record, with
 * every try of its start, is destroyed with the world right after.
 */
export const explained = <A, E, R>(world: Pick<World, "door">, step: Effect.Effect<A, E | StepTimedOut, R>) =>
  step.pipe(
    Effect.catchIf(
      (error): error is StepTimedOut => Predicate.isTagged(error, "StepTimedOut"),
      (timedOut) =>
        indexAccount(world).pipe(
          Effect.flatMap((account) =>
            Effect.fail(
              StepTimedOut.make({
                step: timedOut.step,
                afterMs: timedOut.afterMs,
                message: `${timedOut.message}; the index: ${account}`,
              }),
            ),
          ),
        ),
    ),
  );
