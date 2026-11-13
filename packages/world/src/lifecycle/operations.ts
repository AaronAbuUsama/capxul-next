// What the command line does with one world outside a run: create it and leave it up, destroy it, list what exists.
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { recordedStages } from "../stack/engine.ts";
import { isWorldStage } from "../stack/names.ts";
import { classify, type Finding } from "./expiry.ts";
import { Timeouts, type WorldSpec } from "./spec.ts";
import { makeStopwatch } from "./steps.ts";
import { bringUp, mustExist, planOf, takeDown } from "./world.ts";

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

/** Destroys a world by name, from the shared state alone, and gives its name back. */
export const destroy = (name: string) =>
  Effect.gen(function* () {
    const stage = yield* mustExist(name);
    const watch = yield* makeStopwatch(yield* Timeouts);
    const resourcesDestroyed = yield* takeDown(stage, watch);
    return { world: stage, resourcesDestroyed, ms: yield* watch.durations };
  }).pipe(Effect.withSpan("world.destroy", { attributes: { world: name } }));

/** One world as a listing shows it. */
export interface Listed {
  readonly world: string;
  readonly owner: string | null;
  readonly expiresAt: string | null;
  readonly status: string | null;
  readonly state: Finding["kind"];
}

const listed = (world: string, finding: Finding): Listed => {
  switch (finding.kind) {
    case "unreadable":
      return { world, owner: null, expiresAt: null, status: null, state: finding.kind };
    case "no-expiry":
      return { world, owner: finding.owner, expiresAt: null, status: null, state: finding.kind };
    default:
      return {
        world,
        owner: finding.owner,
        expiresAt: finding.expiresAt,
        status: finding.status ?? "up",
        state: finding.kind,
      };
  }
};

/** Every world the shared state holds, with its owner, its expiry and whether that has passed. */
export const list = Effect.gen(function* () {
  const now = yield* DateTime.now;
  const stages = Arr.filter(yield* recordedStages, ({ stage }) => isWorldStage(stage));
  return yield* Effect.forEach(stages, ({ stage, output }) =>
    Effect.map(classify(now, output), (finding) => listed(stage, finding)),
  );
}).pipe(Effect.withSpan("world.list"));
