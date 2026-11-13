// The sweeper: deletes every stage of a stack whose recorded expiry has passed, and leaves the rest.
//
// It works from two things only: the stack's code (to build its providers and its state store) and the shared state
// store (to list the stages and read what each recorded). It reads no local state, so it can run in any container, on
// a schedule, long after the container that created a stage is gone.
//
// The rule it enforces (docs/roadmap.md, "World lifecycle rules", rule 2): every world has an owner and an expiry, and
// what has expired is deleted without anyone remembering to. A stage that recorded no expiry, or one that cannot be
// read, is never deleted: it is left in place and reported, so a person can decide.
import * as Alchemist from "alchemy/Alchemist";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

/** What a stage must put in its stack outputs for the sweeper to act on it. Other outputs are ignored. */
export const Recorded = Schema.Struct({
  owner: Schema.optionalKey(Schema.String),
  expiresAt: Schema.optionalKey(Schema.DateTimeUtcFromString),
});

export const Verdict = Schema.Literals([
  "destroyed",
  "destroy failed",
  "expired, would be destroyed",
  "kept: not expired",
  "kept: no expiry recorded",
  "kept: expiry unreadable",
]);
export type Verdict = typeof Verdict.Type;

export const StageReport = Schema.Struct({
  stage: Schema.String,
  owner: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.String),
  verdict: Verdict,
  /** Why a destroy failed, or what could not be read. */
  detail: Schema.NullOr(Schema.String),
  /** How long the destroy took. */
  destroyMs: Schema.NullOr(Schema.Number),
});
export type StageReport = typeof StageReport.Type;

export const SweepReport = Schema.Struct({
  stack: Schema.String,
  at: Schema.String,
  dryRun: Schema.Boolean,
  stages: Schema.Array(StageReport),
});
export type SweepReport = typeof SweepReport.Type;

/** The sweep ran to the end, but at least one expired stage is still there. The report says which. */
export class SweepIncomplete extends Schema.TaggedError<SweepIncomplete>()("SweepIncomplete", {
  report: SweepReport,
}) {}

export interface SweepOptions {
  /** The stack file, as `alchemy --config` takes it. Its state store is the only state the sweep reads. */
  readonly entrypoint: string;
  /** Report what would be destroyed and destroy nothing. */
  readonly dryRun?: boolean;
  /** The most one stage's destroy may take before it counts as failed. */
  readonly destroyTimeout?: Duration.Input;
}

type Finding =
  | { readonly kind: "expired" | "live"; readonly owner: string | null; readonly expiresAt: string }
  | { readonly kind: "no-expiry"; readonly owner: string | null }
  | { readonly kind: "unreadable"; readonly detail: string };

/** Decides what a stage's recorded outputs say about it at `now`. A stage with no outputs at all recorded no expiry. */
export const classify = (now: DateTime.Utc, output: unknown): Effect.Effect<Finding> =>
  Schema.decodeUnknownEffect(Recorded)(output ?? {}).pipe(
    Effect.match({
      onFailure: (error): Finding => ({ kind: "unreadable", detail: String(error.message).slice(0, 300) }),
      onSuccess: (recorded): Finding => {
        const owner = recorded.owner ?? null;
        if (recorded.expiresAt === undefined) return { kind: "no-expiry", owner };
        const expired = DateTime.isLessThanOrEqualTo(recorded.expiresAt, now);
        return { kind: expired ? "expired" : "live", owner, expiresAt: DateTime.formatIso(recorded.expiresAt) };
      },
    }),
  );

/** Every stage the state store holds for the stack, with the outputs each one recorded. */
const recordedStages = (entrypoint: string, stack: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const state = yield* Alchemist.State.store({ type: "configured", entrypoint });
      const stages = yield* state.listStages(stack);
      return yield* Effect.forEach(
        stages,
        (stage) => Effect.map(state.getOutput({ stack, stage }), (output) => ({ stage, output })),
        { concurrency: 4 },
      );
    }),
  );

/** Destroys one stage from state alone: the stack's program is not run, so it needs none of the stage's settings. */
const destroy = (stack: Alchemist.ConfiguredStack<unknown, unknown>, stage: string, limit: Duration.Input) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* Alchemist.apply(yield* Alchemist.plan({ stack, operation: "destroy", stage }));
    }),
  ).pipe(Effect.timeout(limit), Effect.timed, Effect.exit, Effect.withSpan("sweep.destroy", { attributes: { stage } }));

/**
 * Sweeps the stack once. Stages are handled one after another, and a stage whose destroy fails does not stop the
 * others. Succeeds with the report when no expired stage is left, and fails with `SweepIncomplete` otherwise.
 */
export const sweep = (options: SweepOptions) =>
  Effect.gen(function* () {
    const stack = yield* Alchemist.importStack(options.entrypoint);
    const now = yield* DateTime.now;
    const stages = yield* recordedStages(options.entrypoint, stack.stackName);
    const reports = yield* Effect.forEach(stages, ({ stage, output }) =>
      Effect.gen(function* () {
        const finding = yield* classify(now, output);
        const base = { stage, owner: null, expiresAt: null, detail: null, destroyMs: null };
        if (finding.kind === "unreadable") {
          return { ...base, verdict: "kept: expiry unreadable", detail: finding.detail } satisfies StageReport;
        }
        if (finding.kind === "no-expiry") {
          return { ...base, owner: finding.owner, verdict: "kept: no expiry recorded" } satisfies StageReport;
        }
        const known = { ...base, owner: finding.owner, expiresAt: finding.expiresAt };
        if (finding.kind === "live") return { ...known, verdict: "kept: not expired" } satisfies StageReport;
        if (options.dryRun === true) return { ...known, verdict: "expired, would be destroyed" } satisfies StageReport;
        const gone = yield* destroy(stack, stage, options.destroyTimeout ?? "5 minutes");
        if (Exit.isFailure(gone)) {
          const detail = String(gone.cause).slice(0, 300);
          return { ...known, verdict: "destroy failed", detail } satisfies StageReport;
        }
        const destroyMs = Math.round(Duration.toMillis(gone.value[0]));
        return { ...known, verdict: "destroyed", destroyMs } satisfies StageReport;
      }),
    );
    const report: SweepReport = {
      stack: stack.stackName,
      at: DateTime.formatIso(now),
      dryRun: options.dryRun === true,
      stages: reports,
    };
    if (reports.some((stage) => stage.verdict === "destroy failed")) return yield* new SweepIncomplete({ report });
    return report;
  }).pipe(Effect.withSpan("sweep"));
