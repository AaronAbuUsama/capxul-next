// Which journeys a run of `./run.sh scenarios` runs: those named on its command line; else those `RUNNER_JOURNEYS`
// names, comma separated; else every registered journey. A name no registered journey has fails the run at once, by
// name, before any world is made: a smoke that ran nothing would read as a pass.
import type { Journey } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Str from "effect/String";
import { RunnerFailure } from "./failure.ts";

/** The names in `RUNNER_JOURNEYS`: split at its commas, each trimmed, empty ones left out. */
export const namesIn = (setting: string): ReadonlyArray<string> =>
  Arr.filter(Arr.map(Str.split(",")(setting), Str.trim), Str.isNonEmpty);

/** The journeys of `all` the command line (`given`) or else the setting names; all of them when neither names any. */
export const chosenOf = (
  all: ReadonlyArray<Journey>,
  given: ReadonlyArray<string>,
  setting: string,
): Effect.Effect<ReadonlyArray<Journey>, RunnerFailure> => {
  const names = given.length > 0 ? given : namesIn(setting);
  const unknown = Arr.filter(names, (name) => !Arr.some(all, (each) => each.name === name));
  return names.length === 0
    ? Effect.succeed(all)
    : unknown.length > 0
      ? Effect.fail(
          RunnerFailure.make({ step: "arguments", message: `no journey is named one of: ${Arr.join(unknown, "; ")}` }),
        )
      : Effect.succeed(Arr.filter(all, (each) => Arr.contains(names, each.name)));
};
