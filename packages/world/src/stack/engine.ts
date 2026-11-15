// The only file that drives Alchemy: deploying and destroying a stage of the stack, and reading the shared state
// store. Everything else in the package works through these.
//
// The state store is the account's shared one (Cloudflare.state()), so any container that holds the Cloudflare key
// sees every world. Nothing here reads or writes state on this machine.
import * as Alchemist from "alchemy/Alchemist";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Str from "effect/String";
import { Core, defaultCore } from "../parts/api/Api.ts";
import { StateUnreadable } from "../common/failures.ts";
import { STACK } from "./names.ts";
import { WorldSettings } from "./settings.ts";
import { openedState, worldStack } from "../things/world/stage.ts";

/** The stack file, for opening the state store without running the stack's program. */
const ENTRYPOINT = `${import.meta.dirname}/../../alchemy.run.ts`;

/** Deploys one stage. A world stage needs its settings; the platform stage takes none. */
export const deployStage = Effect.fn("world.engine.deploy")(function* (
  stage: string,
  settings: Option.Option<WorldSettings>,
) {
  const { store } = yield* SharedState;
  const stack = worldStack(yield* Core, openedState(store));
  return yield* Alchemist.plan({ stack, operation: "deploy", stage }).pipe(
    Effect.flatMap(Alchemist.apply),
    Effect.provideService(WorldSettings, settings),
    Effect.scoped,
  );
});

/** Destroys one stage from its state alone: the stack's program is not run, so it needs none of the stage's settings. */
export const destroyStage = Effect.fn("world.engine.destroy")(function* (stage: string) {
  const { store } = yield* SharedState;
  const stack = worldStack(defaultCore, openedState(store));
  const plan = yield* Alchemist.plan({ stack, operation: "destroy", stage });
  yield* Alchemist.apply(plan);
  return plan.summary.delete;
}, Effect.scoped);

/**
 * The shared state store, opened once for the life of the program: opening it fetches the store's token through
 * Cloudflare, which takes three to four seconds.
 */
export type StateStore = Effect.Success<ReturnType<typeof Alchemist.State.store>>;

export class SharedState extends Context.Service<SharedState, { readonly store: StateStore }>()(
  "@capxul/world/stack/engine/SharedState",
) {
  // Opening the store goes through the network twice; a refusal on the way is tried again before it is believed.
  static readonly layer = Layer.effect(
    SharedState,
    Alchemist.State.store({ type: "configured", entrypoint: ENTRYPOINT }).pipe(
      Effect.retry(Schedule.max([Schedule.spaced("5 seconds"), Schedule.recurs(3)])),
      Effect.map((store) => ({ store })),
    ),
  );
}

/** Runs `use` with the shared state store. */
export const withState = <A, E, R>(use: (state: StateStore) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const { store } = yield* SharedState;
    return yield* use(store);
  });

/** Every stage the shared store holds for one stack of this package, with the outputs each one recorded. */
export const recordedStagesOf = (stack: string) =>
  withState((state) =>
    Effect.gen(function* () {
      const stages = yield* state.listStages(stack);
      return yield* Effect.forEach(
        stages,
        (stage) => Effect.map(state.getOutput({ stack, stage }), (output) => ({ stage, output })),
        { concurrency: 4 },
      );
    }),
  );

/** Every world stage (and the platform's) the shared store holds, with its outputs. */
export const recordedStages = recordedStagesOf(STACK).pipe(Effect.withSpan("world.engine.stages"));

/** What one stage recorded as its outputs; undefined when the stage was never deployed. */
export const recordedOutput = (stage: string, stack: string = STACK) =>
  withState((state) => state.getOutput({ stack, stage }));

/** Records a stage's outputs before its deploy, so a world that dies half-way still says who owns it and when it expires. */
export const recordOutput = (stage: string, value: unknown, stack: string = STACK) =>
  withState((state) => state.setOutput({ stack, stage, value })).pipe(Effect.asVoid);

/** Removes whatever the store still holds for a stage once its resources are gone. */
export const forgetStage = (stage: string, stack: string = STACK) =>
  withState((state) => state.deleteStack({ stack, stage }));

const asSecret = (value: unknown): Option.Option<Redacted.Redacted> => {
  const inner = Redacted.isRedacted(value) ? Redacted.value(value) : value;
  return typeof inner === "string" ? Option.some(Redacted.make(inner)) : Option.none();
};

/**
 * One attribute of one resource of a stage, as a secret. This is how the database's connection string and the
 * door's token are reached: from the resource's own state in the shared store, never from a stack output.
 */
export const secretOf = Effect.fn("world.engine.secret")(function* (
  stage: string,
  logicalId: string,
  attribute: string,
  stack: string = STACK,
) {
  const missing = (message: string) => StateUnreadable.make({ stage, what: `${logicalId}.${attribute}`, message });
  return yield* withState((state) =>
    Effect.gen(function* () {
      const fqns = yield* state.list({ stack, stage });
      const fqn = yield* Arr.findFirst(
        fqns,
        (candidate) => candidate === logicalId || Str.endsWith(`/${logicalId}`)(candidate),
      ).pipe(
        Effect.fromOption,
        Effect.mapError(() => missing(`the stage holds no resource called ${logicalId}`)),
      );
      const found = yield* state.get({ stack, stage, fqn });
      const attributes: Record<string, unknown> =
        found !== undefined && "attr" in found && found.attr !== undefined ? found.attr : {};
      return yield* Effect.fromOption(asSecret(attributes[attribute])).pipe(
        Effect.mapError(() => missing(`the resource has no ${attribute} yet`)),
      );
    }),
  );
});
