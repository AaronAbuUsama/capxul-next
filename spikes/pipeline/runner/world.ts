// The life of a world as one unit: create it, use it, report on it, destroy it. Adapted from spikes/hosting.
//
// The rules this file enforces (docs/roadmap.md, "World lifecycle rules"):
//   1. Destroy runs even when the create or the use fails, times out or is interrupted.
//   2. Every world has an owner and an expiry; Neon deletes an expired branch by itself.
//   4. Destroy removes everything the world created: its Worker, its Hyperdrive configuration and its branch.
//   5. A world never lives on this machine: it is a Worker and a Neon branch.
//   6. Each step has a declared timeout, and how long each step took is reported.
import * as Alchemist from "alchemy/Alchemist";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import stack from "../alchemy.run.ts";
import { PLATFORM, WorldSettings } from "../core/world.ts";
import { migrate } from "./database.ts";
import { describe } from "./failure.ts";

export interface WorldSpec {
  /** The world's stage name. Starts with `pl-` so it cannot be mistaken for anyone else's. */
  readonly name: string;
  readonly owner: string;
  /** How long the world may exist. Past this, Neon deletes its branch whatever happened to the run. */
  readonly lifetime: Duration.Duration;
  readonly timeouts: { readonly create: Duration.Duration; readonly use: Duration.Duration; readonly destroy: Duration.Duration };
  /** The directory of `.sql` files applied to the world's database when it is created. */
  readonly migrations: string;
}

export interface World {
  readonly name: string;
  readonly owner: string;
  readonly expiresAt: string;
  /** Where the world's Core answers. */
  readonly url: string;
  readonly database: Redacted.Redacted<string>;
}

export class StepTimedOut extends Schema.TaggedError<StepTimedOut>()("StepTimedOut", {
  step: Schema.Literals(["create", "use", "destroy"]),
  afterMs: Schema.Number,
  message: Schema.String,
}) {}

export class WorldNotReady extends Schema.TaggedError<WorldNotReady>()("WorldNotReady", {
  url: Schema.String,
  status: Schema.Number,
  message: Schema.String,
}) {}

/** What became of the world, and how long each step took. Reported twice: before the destroy and after it. */
export interface Lifecycle<A, E> {
  readonly name: string;
  readonly owner: string;
  readonly expiresAt: string;
  /** Why the world could not be created; null when it was. */
  readonly createFailure: string | null;
  /** Undefined when the use step never ended: the create failed, or the run was interrupted. */
  readonly used: Exit.Exit<A, E | StepTimedOut> | undefined;
  readonly worldAfterwards: "destroying" | "destroyed" | "destroy failed";
  readonly ms: { readonly create: number | null; readonly use: number | null; readonly destroy: number | null };
}

type StepName = "create" | "use" | "destroy";

const limited = <A, E, R>(name: StepName, limit: Duration.Duration, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.timeoutOrElse({
      duration: limit,
      orElse: () => {
        const afterMs = Duration.toMillis(limit);
        return Effect.fail(new StepTimedOut({ step: name, afterMs, message: `the ${name} step did not finish within its declared ${afterMs} ms` }));
      },
    }),
    Effect.withSpan(`world.${name}`),
  );

const millis = (took: Duration.Duration) => Math.round(Duration.toMillis(took));

const step = <A, E, R>(name: StepName, limit: Duration.Duration, effect: Effect.Effect<A, E, R>) =>
  Effect.timed(limited(name, limit, effect)).pipe(Effect.map(([took, value]) => ({ ms: millis(took), value })));

const Output = Schema.Struct({ url: Schema.String, database: Schema.Union([Schema.String, Schema.Redacted(Schema.String)]) });

/** Deploys one stage of the stack. */
const deploy = (stage: string) => Effect.scoped(Effect.flatMap(Alchemist.plan({ stack, operation: "deploy", stage }), Alchemist.apply));

const remove = (stage: string) => Effect.scoped(Effect.flatMap(Alchemist.plan({ stack, operation: "destroy", stage }), Alchemist.apply));

/**
 * Waits until the world's Core answers. A new Worker's address answers 404 until Cloudflare has routed it; each
 * attempt asks a different URL, so no cache between here and the Worker can keep handing back an early 404.
 */
const answers = (url: string) =>
  Effect.gen(function* () {
    const attempt = yield* Ref.make(0);
    const ask = Effect.gen(function* () {
      const n = yield* Ref.updateAndGet(attempt, (was) => was + 1);
      const response = yield* HttpClient.get(`${url}/?ready=${n}`);
      if (response.status !== 200) return yield* new WorldNotReady({ url, status: response.status, message: `attempt ${n}: Core answered ${response.status}` });
      return n;
    });
    return yield* ask.pipe(
      Effect.scoped,
      Effect.tapError((error) => Effect.logDebug(`not ready: ${"message" in error ? error.message : String(error)}`)),
      Effect.retry(Schedule.spaced("1 second")),
    );
  });

const create = (spec: WorldSpec, expiresAt: string) =>
  Effect.gen(function* () {
    // The world's owner and expiry reach the stack as a service, never through the process environment.
    const settings = Option.some({ owner: spec.owner, expiresAt });
    const out = yield* Schema.decodeUnknownEffect(Output)(yield* Effect.provideService(deploy(spec.name), WorldSettings, settings));
    const database = Redacted.isRedacted(out.database) ? out.database : Redacted.make(out.database);
    yield* Effect.log(`world ${spec.name}: deployed at ${out.url}`);
    const applied = yield* migrate(database, spec.migrations);
    yield* Effect.log(`world ${spec.name}: migrations applied (${applied.join(", ")})`);
    yield* answers(out.url);
    yield* Effect.log(`world ${spec.name}: Core answers`);
    return { name: spec.name, owner: spec.owner, expiresAt, url: out.url, database } satisfies World;
  });

/** Makes sure the stage that owns what worlds share (the Neon project) exists. A deploy that changes nothing is quick. */
export const ensurePlatform = deploy(PLATFORM).pipe(Effect.asVoid, Effect.withSpan("platform.ensure"));

/**
 * Creates the world, runs `use` in it, and destroys it. The destroy runs whatever happened, also when the create
 * failed half-way and left something behind. `report` is called with what happened before the destroy and again
 * after it, so a destroy that fails is itself on record.
 */
export const runInWorld = <A, E, R, R2>(
  spec: WorldSpec,
  use: (world: World) => Effect.Effect<A, E, R>,
  report: (lifecycle: Lifecycle<A, E>) => Effect.Effect<void, never, R2>,
) =>
  Effect.gen(function* () {
    const expiresAt = DateTime.formatIso(DateTime.addDuration(yield* DateTime.now, spec.lifetime));
    const progress = yield* Ref.make<Pick<Lifecycle<A, E>, "createFailure" | "used" | "ms">>({
      createFailure: null,
      used: undefined,
      ms: { create: null, use: null, destroy: null },
    });
    const run = Effect.gen(function* () {
      const created = yield* Effect.exit(step("create", spec.timeouts.create, create(spec, expiresAt)));
      if (Exit.isFailure(created)) return yield* Ref.update(progress, (was) => ({ ...was, createFailure: describe(created.cause) }));
      yield* Ref.update(progress, (was) => ({ ...was, ms: { ...was.ms, create: created.value.ms } }));
      // The use step is timed whether it passes or not, so a failure or a timeout still says how long it ran.
      const [took, used] = yield* Effect.timed(Effect.exit(limited("use", spec.timeouts.use, use(created.value.value))));
      yield* Ref.update(progress, (was) => ({ ...was, used, ms: { ...was.ms, use: millis(took) } }));
    });
    const leave = Effect.gen(function* () {
      const before: Lifecycle<A, E> = { name: spec.name, owner: spec.owner, expiresAt, ...(yield* Ref.get(progress)), worldAfterwards: "destroying" };
      yield* report(before);
      const gone = yield* Effect.exit(step("destroy", spec.timeouts.destroy, remove(spec.name)));
      const after: Lifecycle<A, E> = {
        ...before,
        worldAfterwards: Exit.isSuccess(gone) ? "destroyed" : "destroy failed",
        ms: { ...before.ms, destroy: Exit.isSuccess(gone) ? gone.value.ms : null },
      };
      yield* report(after);
      return after;
    });
    // `leave` is the release of acquireUseRelease in all but name: it cannot be interrupted, and it runs when
    // `run` fails, dies or is interrupted.
    return yield* Effect.uninterruptibleMask((restore) => Effect.flatMap(Effect.exit(restore(run)), () => leave));
  });
