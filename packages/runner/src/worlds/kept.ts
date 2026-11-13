// What the platform this process serves kept of its calls (worlds/platform.ts): each call's spans, and the events it
// wrote into the record of the world it acted on. Present only in a run in private worlds; a stage's own Core keeps
// its platform calls in the stage's database, as before.
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { RunnerFailure } from "../failure.ts";
import type { Kept } from "../world/database.ts";

export class PlatformKept extends Context.Service<
  PlatformKept,
  { readonly kept: (traceIds: ReadonlyArray<string>) => Effect.Effect<Kept, RunnerFailure> }
>()("@capxul/runner/worlds/kept/PlatformKept") {}
