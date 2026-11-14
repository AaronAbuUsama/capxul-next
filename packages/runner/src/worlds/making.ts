// How a starting world's steps are run and recorded, whoever runs them: the run's one world (starting.ts) or a run on
// a shared world (shared.ts). Each making is its own program with a client of its own, so its calls are recorded
// apart from any other's; every call is kept for the checks (`made`) and appended to the world's `calls` fact.
import type { StartingWorld } from "@capxul/blueprint";
import type { Capxul } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import type * as HttpClient from "effect/http/HttpClient";
import type * as World from "@capxul/world";
import { capxulFor, type Call, type Target } from "../client.ts";
import type { RunnerFailure } from "../failure.ts";
import type { Settings } from "../settings.ts";
import { madeCallOf, type Facts, type Making } from "./makers.ts";

/**
 * What making a starting world needs: the client's HTTP, the shared state the bench is found by, and the files its
 * template's code is fingerprinted from.
 */
export type Needs = HttpClient.HttpClient | World.SharedState | FileSystem.FileSystem | Path.Path;

/** One call made in making a starting world, with the world it was made for: what the starting worlds' record keeps. */
export interface MakingCall {
  readonly world: string;
  readonly call: Call;
}

export const callsOf = (facts: Facts): ReadonlyArray<unknown> => {
  const calls = facts["calls"];
  return Arr.isArray(calls) ? calls : [];
};

/** The facts of `nothing`: the run's two operators, and no call. */
export const nothingOf = (settings: Settings): Making => ({
  facts: { operators: { first: settings.owner, second: settings.secondOwner }, calls: [] },
  own: null,
});

/** The client a maker calls through: the platform, and a world's operations `at` that world's door. */
export const targetOf = (settings: Settings, platformUrl: string): Target => ({
  // A maker calls a world's operations `at` that world's door; this client's own world is never called.
  url: "http://127.0.0.1:9",
  platformUrl,
  doorToken: Redacted.make("none"),
  platformToken: settings.platformToken,
  secondPlatformToken: Option.getOrNull(settings.secondPlatformToken),
  warmUntil: 0,
  every: settings.probeEvery,
});

/** Runs `steps` of `world` from `making`, recording each call into `made`, and appends them to the world's `calls`. */
export const recorder =
  (target: Target, made: Ref.Ref<ReadonlyArray<MakingCall>>) =>
  (
    world: StartingWorld,
    steps: (making: Making) => Effect.Effect<Making, RunnerFailure, Capxul>,
    making: Making,
  ): Effect.Effect<Making, RunnerFailure, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<Call>>([]);
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- a maker's client is built for its one making and closed with it
      const exit = yield* Effect.exit(steps(making).pipe(Effect.provide(capxulFor(target, log))));
      const calls = yield* Ref.get(log);
      yield* Ref.update(made, (all) => [...all, ...Arr.map(calls, (call) => ({ world: world.name, call }))]);
      const after = yield* exit;
      const entries = yield* Effect.forEach(calls, (call) => madeCallOf(call, making.own ?? after.own));
      const facts: Facts = { ...after.facts, calls: [...callsOf(after.facts), ...entries] };
      return { own: after.own, facts } satisfies Making;
    });
