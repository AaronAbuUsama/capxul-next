// The life of one stage of `CapxulCore` as a unit: create it, use it, report on it, destroy it, and look in the
// accounts afterwards. Adapted from spikes/pipeline/runner/world.ts. Until `packages/world` lands (step 1.3), a
// stage is the runner's world: a Core with a database of its own.
//
// The lifecycle rules this keeps (docs/roadmap.md, "World lifecycle rules"):
//   1. Destroy runs even when the create or the use fails, times out or is interrupted.
//   4. Destroy removes everything the stage created, and the inventory after it shows that nothing is left.
//   5. Nothing of a stage lives on this machine but Alchemy's local state.
//   6. Each step has a declared timeout, and how long each took is recorded.
// Rule 2's expiry is not kept: a stage has an owner but no expiry until `packages/world` gives it one.
import { migrations, stack } from "@capxul/core";
import * as Alchemist from "alchemy/Alchemist";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { describe, RunnerFailure } from "../failure.ts";
import { migrate } from "./database.ts";
import { inventory, type Accounts, type Inventory } from "./leftovers.ts";
import { answersSteadily, type Readiness, type WarmUpPolicy } from "./warmup.ts";

export interface StageSpec {
  /** The stage's name, `core-<6 hex>`; also the name of the world its Core serves. */
  readonly name: string;
  readonly owner: string;
  readonly timeouts: {
    readonly create: Duration.Duration;
    readonly use: Duration.Duration;
    readonly destroy: Duration.Duration;
  };
  readonly warmUp: WarmUpPolicy;
  readonly accounts: Accounts;
}

export interface Stage {
  readonly name: string;
  /** Where the stage's Core answers. */
  readonly url: string;
  /** Where the platform group answers, when another process serves it; left out, the stage's own Core. */
  readonly platformUrl?: string;
  readonly database: Redacted.Redacted;
  readonly readiness: Readiness;
  /** Epoch milliseconds: until then, a call Cloudflare's edge answered is sent again. */
  readonly warmUntil: number;
}

/** What became of the stage, and how long each step took. Reported before the destroy and again after it. */
export interface Lifecycle<A, E> {
  readonly name: string;
  readonly owner: string;
  /** Why the stage could not be created; null when it was. */
  readonly createFailure: string | null;
  readonly readiness: Readiness | null;
  /** Undefined when the use never ended: the create failed, or the run was interrupted. */
  readonly used: Exit.Exit<A, E | RunnerFailure> | undefined;
  readonly afterwards: "destroying" | "destroyed" | "destroy failed";
  /** What the accounts held of the stage just before its destroy, and just after it; null when not read. */
  readonly found: { readonly before: Inventory | null; readonly after: Inventory | null };
  readonly ms: { readonly create: number | null; readonly use: number | null; readonly destroy: number | null };
}

type StepName = "create" | "use" | "destroy";

const millis = (took: Duration.Duration) => Math.round(Duration.toMillis(took));

const limited = <A, E, R>(name: StepName, limit: Duration.Duration, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.timeoutOrElse({
      duration: limit,
      orElse: () =>
        RunnerFailure.make({
          step: name,
          message: `did not finish within its declared ${Duration.toMillis(limit)} ms`,
        }),
    }),
    Effect.withSpan(`stage.${name}`),
  );

const Output = Schema.Struct({
  url: Schema.String,
  database: Schema.Union([Schema.String, Schema.Redacted(Schema.String)]),
});

const apply = (stage: string, operation: "deploy" | "destroy") =>
  Effect.scoped(Effect.flatMap(Alchemist.plan({ stack, operation, stage }), Alchemist.apply));

const create = (spec: StageSpec) =>
  Effect.gen(function* () {
    const out = yield* Schema.decodeEffect(Output)(yield* apply(spec.name, "deploy"));
    const database = Redacted.isRedacted(out.database) ? out.database : Redacted.make(out.database);
    yield* Effect.log(`stage ${spec.name}: deployed at ${out.url}`);
    const directory = yield* Effect.orDie((yield* Path.Path).fromFileUrl(migrations));
    const applied = yield* migrate(database, directory);
    yield* Effect.log(`stage ${spec.name}: migrations applied (${Arr.join(applied, ", ")})`);
    const readiness = yield* answersSteadily(out.url, spec.warmUp);
    yield* Effect.log(`stage ${spec.name}: Core answered ${spec.warmUp.answers} probes in a row (${readiness.ms} ms)`);
    const warmUntil = (yield* Clock.currentTimeMillis) + Duration.toMillis(spec.warmUp.warmUp);
    return { name: spec.name, url: out.url, database, readiness, warmUntil } satisfies Stage;
  });

/** The accounts' view of the stage, or null when it could not be read; a failed read is logged, not fatal. */
const look = (spec: StageSpec) =>
  inventory(spec.name, spec.accounts).pipe(
    Effect.map((found): Inventory | null => found),
    Effect.catchCause((cause) =>
      Effect.as(Effect.logWarning(`stage ${spec.name}: inventory not read: ${describe(cause)}`), null),
    ),
  );

/**
 * Creates the stage, runs `use` in it and destroys it. The destroy runs whatever happened, also after a create that
 * failed half-way. `report` is called with what happened before the destroy and again after it.
 */
export const runInStage = <A, E, R, R2>(
  spec: StageSpec,
  use: (stage: Stage) => Effect.Effect<A, E, R>,
  report: (lifecycle: Lifecycle<A, E>) => Effect.Effect<void, never, R2>,
) =>
  Effect.gen(function* () {
    const progress = yield* Ref.make<Pick<Lifecycle<A, E>, "createFailure" | "readiness" | "used" | "ms">>({
      createFailure: null,
      readiness: null,
      used: undefined,
      ms: { create: null, use: null, destroy: null },
    });
    const run = Effect.gen(function* () {
      const [createTook, created] = yield* limited("create", spec.timeouts.create, create(spec)).pipe(
        Effect.exit,
        Effect.timed,
      );
      const createMs = millis(createTook);
      if (Exit.isFailure(created)) {
        yield* Ref.update(progress, (was) => ({
          ...was,
          createFailure: describe(created.cause),
          ms: { ...was.ms, create: createMs },
        }));
        return;
      }
      yield* Ref.update(progress, (was) => ({
        ...was,
        readiness: created.value.readiness,
        ms: { ...was.ms, create: createMs },
      }));
      const [took, used] = yield* limited("use", spec.timeouts.use, use(created.value)).pipe(Effect.exit, Effect.timed);
      yield* Ref.update(progress, (was) => ({ ...was, used, ms: { ...was.ms, use: millis(took) } }));
    });
    const leave = Effect.gen(function* () {
      const before = yield* look(spec);
      const going: Lifecycle<A, E> = {
        name: spec.name,
        owner: spec.owner,
        ...(yield* Ref.get(progress)),
        afterwards: "destroying",
        found: { before, after: null },
      };
      yield* report(going);
      const [took, gone] = yield* limited("destroy", spec.timeouts.destroy, apply(spec.name, "destroy")).pipe(
        Effect.exit,
        Effect.timed,
      );
      const after = yield* look(spec);
      const done: Lifecycle<A, E> = {
        ...going,
        afterwards: Exit.isSuccess(gone) ? "destroyed" : "destroy failed",
        found: { before, after },
        ms: { ...going.ms, destroy: millis(took) },
      };
      if (Exit.isFailure(gone)) yield* Effect.logError(`stage ${spec.name}: destroy failed: ${describe(gone.cause)}`);
      yield* report(done);
      return done;
    });
    // `leave` is a release in all but name: it cannot be interrupted, and runs when `run` fails, dies or is interrupted.
    return yield* Effect.uninterruptibleMask((restore) => Effect.andThen(Effect.exit(restore(run)), leave));
  });
