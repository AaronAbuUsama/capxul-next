// Creates one world outside a run and leaves it up for its owner.
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { Timeouts, type WorldSpec } from "./values.ts";
import { makeStopwatch } from "../../common/stopwatch.ts";
import { bringUp } from "./bring-up.ts";
import { planOf, takeDown } from "./take-down.ts";

/**
 * Creates a world and leaves it up, for its owner to use until it expires or is destroyed. A create that fails
 * after the name was claimed takes down whatever it had made, so a failed create leaves nothing either.
 */
export const create = (spec: WorldSpec) =>
  Effect.gen(function* () {
    const plan = yield* planOf(spec);
    const watch = yield* makeStopwatch(yield* Timeouts);
    const held = yield* Ref.make(Option.none<string>());
    const began = yield* Clock.currentTimeMillis;
    const [up, cleaned] = yield* Effect.uninterruptibleMask((restore) =>
      Effect.flatMap(Effect.exit(restore(bringUp(spec, plan, watch, held))), (brought) =>
        Effect.gen(function* () {
          const holder = yield* Ref.get(held);
          if (Exit.isSuccess(brought) || Option.isNone(holder)) return [brought, true] as const;
          return [brought, Exit.isSuccess(yield* Effect.exit(takeDown(plan.stage, watch, holder)))] as const;
        }),
      ),
    );
    if (Exit.isFailure(up)) {
      const nothingMade = Option.isNone(yield* Ref.get(held));
      const cleanup = cleaned
        ? "what the create had made is destroyed"
        : "the cleanup failed; sweep removes it at its expiry";
      yield* Effect.logError(`world ${plan.stage}: not created; ${nothingMade ? "nothing of it was made" : cleanup}`);
      return yield* Effect.failCause(up.cause);
    }
    return { world: up.value, ms: { ...(yield* watch.durations), create: (yield* Clock.currentTimeMillis) - began } };
  }).pipe(Effect.withSpan("world.lifecycle.create", { attributes: { world: spec.name } }));
