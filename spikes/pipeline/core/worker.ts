// Core: the world's server. A Cloudflare Worker that serves the contract's Rpc group over HTTP and reaches the
// world's Neon branch through Hyperdrive with Effect SQL. It holds no connection string: Hyperdrive is a binding.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as SQL from "@alchemy.run/sql/Postgres";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as RpcServer from "effect/rpc/RpcServer";
import { CoreRpcs } from "../contract/door.ts";
import { HandlersLive } from "./handlers.ts";
import { EventsLive, TelemetryLive } from "./telemetry.ts";
import { WorldDatabase } from "./world.ts";

export default class Core extends Cloudflare.Worker<Core>()(
  "Core",
  {
    main: import.meta.url,
    // The Postgres driver opens its socket through Node's `net` and `tls`.
    compatibility: { flags: ["nodejs_compat"] },
  },
  Effect.gen(function* () {
    const hyperdrive = yield* Cloudflare.Hyperdrive.Connect(WorldDatabase);
    // One pool per request, opened on the first query and closed when the request ends; Hyperdrive keeps the
    // real connections warm next to the database.
    const database = SQL.PostgresLayer({ url: hyperdrive.connectionString });
    const served = Layer.mergeAll(HandlersLive, TelemetryLive, RpcSerialization.layerJson).pipe(
      Layer.provide(EventsLive),
      Layer.provide(database),
    );
    return {
      // A defect in one call answers that call only; it does not end the caller's whole client.
      fetch: RpcServer.toHttpEffect(CoreRpcs, { disableFatalDefects: true }).pipe(Effect.provide(served)),
    };
  }).pipe(Effect.provide(Cloudflare.Hyperdrive.ConnectBinding)),
) {}
