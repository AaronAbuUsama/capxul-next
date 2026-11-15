// The platform's door: the blueprint's platform group (world.create, world.show, world.snapshot.save,
// world.snapshot.restore, and an operator's inventory: world.list, world.snapshot.list and world.snapshot.delete),
// served over HTTP with Effect's Rpc server at `PLATFORM_PATH` by whatever process runs it
// where the Cloudflare and Neon keys are (packages/blueprint/docs/decisions.md, entry 51): the runner, in-process, or
// `world platform serve`. Its sign-in and its spans are Core's own middlewares; its spans are kept in the platform's
// store (store.ts), and each call's events in the record of the world it acted on.
import { PLATFORM_PATH, PlatformRpcs } from "@capxul/blueprint";
import { PlatformSignInLive, TelemetryLive } from "@capxul/core";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as RpcServer from "effect/rpc/RpcServer";
import { query } from "../parts/database/sql.ts";
import { registry } from "../things/registry/reserve.ts";
import { create, show } from "./worlds.ts";
import { list, snapshotDelete, snapshotList } from "./lists.ts";
import { PlatformIdentity } from "./operators.ts";
import { save, restore } from "./snapshots.ts";
import { keptOf, PlatformSpanSink, prepareStore } from "./store.ts";
import { opened } from "./view.ts";

/** The platform group's handlers: one per operation, or this does not compile. */
export const PlatformHandlers = PlatformRpcs.toLayer({
  "world.create": create,
  "world.show": show,
  "world.snapshot.save": save,
  "world.snapshot.restore": restore,
  "world.list": list,
  "world.snapshot.list": snapshotList,
  "world.snapshot.delete": snapshotDelete,
});

const sink = Layer.unwrap(
  Effect.map(
    Effect.tap(registry, () => prepareStore),
    PlatformSpanSink,
  ),
);

/** The platform group at `PLATFORM_PATH`, on the `HttpServer` it is given. */
export const servePlatform = HttpRouter.serve(
  RpcServer.layerHttp({ group: PlatformRpcs, path: PLATFORM_PATH, protocol: "http" }).pipe(
    Layer.provide(PlatformHandlers),
    Layer.provide(Layer.merge(TelemetryLive, PlatformSignInLive)),
    Layer.provide(Layer.merge(sink, PlatformIdentity)),
    Layer.provide(RpcSerialization.layerJson),
  ),
  { disableLogger: true, disableListenLog: true },
);

/** Where the served platform answers: its group's address. */
export const platformUrl = HttpServer.addressFormattedWith((address) => Effect.succeed(`${address}${PLATFORM_PATH}`));

const EventRows = Schema.Array(
  Schema.Struct({ trace_id: Schema.String, operation: Schema.String, event: Schema.String, payload: Schema.Unknown }),
);

/**
 * What the platform kept of the calls under `traceIds`: their spans, and the events each successful one wrote into
 * the record of the world it acted on, read while that world exists.
 */
export const keptByPlatform = Effect.fn("platform.kept")(function* (traceIds: ReadonlyArray<string>) {
  if (Arr.isReadonlyArrayEmpty(traceIds)) return { spans: [], events: [] };
  const { spans, calls } = yield* keptOf(traceIds);
  const stages = Arr.dedupe(Arr.map(calls, (call) => call.stage));
  const events = yield* Effect.forEach(stages, (stage) =>
    Effect.gen(function* () {
      const { world } = yield* opened(stage);
      const traces = Arr.map(
        Arr.filter(calls, (call) => call.stage === stage),
        (call) => call.trace_id,
      );
      const rows = yield* query(
        world.database,
        "select trace_id, operation, event, payload from app.events where trace_id = any($1) order by id",
        [traces],
      );
      return yield* Schema.decodeUnknownEffect(EventRows)(rows);
    }),
  );
  return { spans, events: Arr.flatten(events) };
});
