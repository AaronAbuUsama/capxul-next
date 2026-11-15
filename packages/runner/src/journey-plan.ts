// A registered journey as a run (run.ts, `Plan`): its client, its facts and the runner's ear, and the span of the
// step it is in, to which each of its calls is linked.
import type { Journey } from "@capxul/scenarios";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import type * as Tracer from "effect/Tracer";
import { capxulFor } from "./client.ts";
import { givenFor, type Handing } from "./given.ts";
import type { Plan } from "./run.ts";
import type { Settings } from "./settings.ts";
import { hearing } from "./steps.ts";

/**
 * A registered journey as a run: its `Capxul` is the stage's Core, through the recording client, its `Given` the
 * facts the runner has of its starting world (given.ts), and its `Steps` the runner's ear (steps.ts).
 */
export const journeyPlan =
  (settings: Settings, handing: Handing) =>
  (journey: Journey): Plan => ({
    kind: "journey",
    name: journey.name,
    proves: null,
    given: journey.given.name,
    via: settings.via,
    outline: journey.outline,
    calls: (target, log, heard) =>
      Effect.flatMap(Ref.make<Option.Option<Tracer.Span>>(Option.none()), (open) =>
        // oxlint-disable-next-line effecttsgo/strict-effect-provide -- each journey is its own program, handed its own stage's client, facts and ear
        Effect.provide(
          journey.run,
          Layer.mergeAll(
            capxulFor(target, log, settings.via, open),
            givenFor(journey.given, { first: settings.owner, second: settings.secondOwner }, handing),
            hearing(heard, log, open),
          ),
        ),
      ),
  });
