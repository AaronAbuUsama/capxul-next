// What Core serves, apart from where it runs: both blueprint groups as one Rpc group on one address, with their
// handlers and middlewares. The Worker (`worker.ts`) provides a database; a test provides a sink of its own.
import { PlatformRpcs, WorldRpcs } from "@capxul/blueprint";
import * as Layer from "effect/Layer";
import { PlatformHandlers, WorldHandlers } from "./handlers.ts";
import { PlatformSignInLive, TelemetryLive, WorldSignInLive } from "./telemetry/middleware.ts";

/** Every operation of the blueprint. Each keeps its own group's middlewares (`RpcGroup.merge` keeps them per Rpc). */
export const CoreRpcs = PlatformRpcs.merge(WorldRpcs);

/** The handlers and middlewares of `CoreRpcs`. Needs a `SpanSink` and the `CoreIdentity` of the deploy. */
export const Served = Layer.merge(PlatformHandlers, WorldHandlers).pipe(
  Layer.provideMerge(Layer.merge(TelemetryLive, Layer.merge(WorldSignInLive, PlatformSignInLive))),
);
