// Where the calls made for one journey's starting world go, and which journey it is (roadmap 4.8): provided per journey
// by the run (worlds/run.ts), read by the recorder (making.ts) and the makers (company.ts). A file of its own so the
// makers can read it without importing the recorder, which imports them.
import type { Journey } from "@capxul/scenarios";
import * as Context from "effect/Context";
import type * as Ref from "effect/Ref";
import type { Call } from "../client.ts";

/** One call made in making a starting world, with the world it was made for: what the starting worlds' record keeps. */
export interface MakingCall {
  readonly world: string;
  readonly call: Call;
}

/**
 * Where the calls made for one journey's starting world go, besides the run's `made`: the journey's own log. Provided
 * per journey (worlds/run.ts), so a journey reads its own making calls, not a slice of a list other journeys append to
 * at the same time (roadmap 4.8). A making with none provided records into `made` alone.
 */
export class JourneyMaking extends Context.Service<
  JourneyMaking,
  {
    readonly calls: Ref.Ref<ReadonlyArray<MakingCall>>;
    /** The journey whose starting world is being made: a run in one shared world makes it by the journey's kind. */
    readonly journey?: Journey;
  }
>()("@capxul/runner/worlds/journey-making/JourneyMaking") {}
