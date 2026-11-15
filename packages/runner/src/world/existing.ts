// A run against a world that `world create` made (packages/world), rather than a stage of `CapxulCore` of the runner's
// own: `./run.sh door --world=<name>`. The world is opened from the shared state alone. Its Core is the real Core in
// the world's Core slot, which keeps its spans in the world's own database, and accepts the world's door token and
// its owner's operator token, which the runner reads from the world's state and never prints. The runner neither
// creates nor destroys the world: its owner does, with `world destroy`.
//
// `OtherWorlds` is how the runner reads what Core kept for a call made `at` another world's door
// (packages/blueprint, src/protocol/headers.ts): each world keeps its own spans, so such a call's telemetry is read
// from the world whose Core answers at that door.
import * as World from "@capxul/world";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import { describe } from "../failure.ts";
import type { RunRecord } from "../record.ts";
import { writeRecord } from "../record.ts";
import type { Settings } from "../settings.ts";
import { answersSteadily } from "./warmup.ts";

const trimmed = (url: string) => Str.replace(/\/+$/, "")(url);

/** The database of the world whose Core answers at a door, or none when no world of the shared state does. */
export class OtherWorlds extends Context.Service<
  OtherWorlds,
  { readonly databaseAt: (door: string) => Effect.Effect<Option.Option<Redacted.Redacted>> }
>()("@capxul/runner/world/existing/OtherWorlds") {
  /** No other world is known: a call `at` another door has no telemetry to read. */
  static readonly none = Layer.succeed(OtherWorlds, { databaseAt: () => Effect.succeedNone });

  /** Every world of the shared state, found by the address its Core answers at. */
  static readonly fromSharedState = Layer.effect(
    OtherWorlds,
    Effect.gen(function* () {
      // Opening a world asks Neon for its database's connection string (packages/world, src/things/world/client.ts).
      const context = yield* Effect.context<World.SharedState | HttpClient.HttpClient>();
      return {
        databaseAt: (door: string) =>
          Effect.gen(function* () {
            const worlds = yield* World.list;
            for (const listed of worlds) {
              const opened = yield* Effect.option(World.open(listed.world));
              if (Option.isSome(opened) && trimmed(opened.value.coreUrl) === trimmed(door))
                return Option.some(opened.value.database);
            }
            return Option.none<Redacted.Redacted>();
          }).pipe(
            Effect.provide(context),
            Effect.orElseSucceed(() => Option.none<Redacted.Redacted>()),
          ),
      };
    }),
  );
}

/** What `use` needs of the world: Core's address, its database, its doors' tokens, and how ready it was found. */
export const openWorld = (name: string, settings: Settings) =>
  Effect.gen(function* () {
    const world = yield* World.open(name);
    const readiness = yield* answersSteadily(world.coreUrl, {
      answers: settings.readyAnswers,
      every: settings.probeEvery,
      warmUp: settings.warmUp,
    });
    const warmUntil = (yield* Clock.currentTimeMillis) + Duration.toMillis(settings.warmUp);
    return {
      world,
      stage: { name: world.stage, url: world.coreUrl, database: world.database, readiness, warmUntil },
      settings: { ...settings, owner: world.owner, doorToken: world.doorToken, platformToken: world.operatorToken },
    };
  });

/** The record of a run in a world the runner did not make: nothing is destroyed, so nothing is looked for after. */
export const worldRecord = (
  base: Omit<RunRecord, "afterwards" | "outcome" | "failure">,
  failures: ReadonlyArray<string>,
): RunRecord => ({
  ...base,
  outcome: failures.length === 0 ? "passed" : "failed",
  failure: failures.length === 0 ? null : Arr.join(failures, "\n"),
  afterwards: { stage: "left to its owner", before: null, after: null },
});

/** Opens the world, or says why it could not be. */
export const opened = (name: string, settings: Settings) =>
  Effect.exit(openWorld(name, settings)).pipe(
    Effect.map((exit) =>
      Exit.isSuccess(exit)
        ? { ok: exit.value, failure: null }
        : { ok: null, failure: `the world ${name} could not be opened: ${describe(exit.cause)}` },
    ),
  );

/** When the run started, as a record says it. */
export const startedNow = Effect.map(DateTime.now, DateTime.formatIso);

export { writeRecord };
