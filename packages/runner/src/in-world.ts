// A run in a world that `world create` made (`./run.sh door --world=<name>`), rather than in a stage of the runner's
// own: the same plan, the same calls and the same generic checks (run.ts), with the world's Core, its database and its
// tokens, read from the shared state of packages/world (world/existing.ts). The world is neither created nor
// destroyed here: its owner does both.
import { SharedState } from "@capxul/world";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { failuresOf } from "./checks/checks.ts";
import { describe, endedOf } from "./failure.ts";
import { writeRecord } from "./record.ts";
import { type Plan, use } from "./run.ts";
import type { Settings } from "./settings.ts";
import { opened, OtherWorlds, startedNow, worldRecord } from "./world/existing.ts";

/**
 * Runs one plan in a world that `world create` made (`--world=<name>`), and returns its run record, which is also on
 * disk by then. The world is not the runner's: it is neither created nor destroyed here.
 */
export const runInWorld = (plan: Plan, settings: Settings, name: string) =>
  Effect.gen(function* () {
    const startedAt = yield* startedNow;
    const [openTook, found] = yield* Effect.timed(opened(name, settings));
    const base = {
      kind: plan.kind,
      name: plan.name,
      proves: plan.proves,
      given: plan.given,
      stage: found.ok?.world.stage ?? name,
      owner: found.ok?.world.owner ?? settings.owner,
      startedAt,
      readiness: found.ok?.stage.readiness ?? null,
    };
    if (found.ok === null) {
      const record = worldRecord(
        { ...base, ended: null, calls: [], ms: { create: null, run: null, checks: null, destroy: null } },
        [found.failure ?? "the world could not be opened"],
      );
      return yield* Effect.as(Effect.orDie(writeRecord(settings.records, record)), record);
    }
    const { stage, settings: inWorld } = found.ok;
    const ran = yield* Effect.exit(Effect.timeout(use(plan, inWorld)(stage), settings.useTimeout));
    const used = Exit.isSuccess(ran) ? ran.value : undefined;
    const failures = [
      ...(Exit.isFailure(ran) ? [`the run did not finish: ${describe(ran.cause)}`] : []),
      ...(used !== undefined && Exit.isFailure(used.run) ? [`the run failed: ${describe(used.run.cause)}`] : []),
      ...(used === undefined ? [] : failuresOf(used.calls)),
    ];
    const record = worldRecord(
      {
        ...base,
        ended: used === undefined ? null : endedOf(used.run),
        calls: used?.calls ?? [],
        ms: {
          create: Math.round(Duration.toMillis(openTook)),
          run: used?.ms.run ?? null,
          checks: used?.ms.checks ?? null,
          destroy: null,
        },
      },
      failures,
    );
    return yield* Effect.as(Effect.orDie(writeRecord(settings.records, record)), record);
  }).pipe(
    // A run in a world reads the shared state of packages/world, opened for this run only: the world's own facts, and
    // the database of any other world a call is made `at` (world/existing.ts).
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- a run in a world is its own program, handed the shared state it alone needs
    Effect.provide(OtherWorlds.fromSharedState.pipe(Layer.provideMerge(SharedState.layer))),
    Effect.withSpan("runner.run.world", { attributes: { run: plan.name, world: name } }),
  );
