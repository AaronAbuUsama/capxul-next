// What Core serves, apart from where it runs: the handlers and middlewares of both blueprint groups. The Worker
// (`worker.ts`) serves each group at its own door (`doors.ts`) and provides a database; a test provides a sink.
import { PlatformRpcs, WorldRpcs } from "@capxul/blueprint";
import * as Layer from "effect/Layer";
import { EmptyHandlers } from "./empty-handlers.ts";
import { PlatformHandlers, WorldHandlers } from "./handlers.ts";
import { PlatformSignInLive, TelemetryLive, WorldSignInLive } from "./telemetry/middleware.ts";

/**
 * Every operation of the blueprint in one group, for a test in memory. Each keeps its own group's middlewares
 * (`RpcGroup.merge` keeps them per Rpc). Over HTTP each group has its own door.
 */
export const CoreRpcs = PlatformRpcs.merge(WorldRpcs);

/** The handlers and middlewares of both groups. Needs a `SpanSink` and the `CoreIdentity` of the deploy. */
const middlewares = Layer.merge(TelemetryLive, Layer.merge(WorldSignInLive, PlatformSignInLive));

export const Served = Layer.merge(PlatformHandlers, WorldHandlers).pipe(Layer.provideMerge(middlewares));

/** The same with every handler empty (src/empty-handlers.ts): what a stage deployed with `CAPXUL_HANDLERS=empty` serves. */
export const ServedEmpty: typeof Served = EmptyHandlers.pipe(Layer.provideMerge(middlewares));
