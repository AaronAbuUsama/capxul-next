// Core: the Capxul server. A Cloudflare Worker, deployed by Alchemy, that serves every blueprint operation over
// HTTP with Effect's Rpc server, and keeps every call's spans in its database, reached through Hyperdrive.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as SQL from "@alchemy.run/sql/Postgres";
import { Values } from "@capxul/blueprint";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as RpcServer from "effect/rpc/RpcServer";
import { CoreRpcs, Served } from "./server.ts";
import { CoreDatabase } from "./stack/database.ts";
import { CoreIdentity } from "./telemetry/middleware.ts";
import { SqlSpanSink } from "./telemetry/sink.ts";

export default class Core extends Cloudflare.Worker<Core>()(
  "Core",
  {
    main: import.meta.url,
    // The Postgres driver opens its socket through Node's `net` and `tls`.
    compatibility: { flags: ["nodejs_compat"] },
  },
  Effect.gen(function* () {
    // The world is the stage. Its owner is read at deploy (`WORLD_OWNER`) and bound into the Worker's environment,
    // where the running Worker reads it again.
    const { stage } = yield* Alchemy.Stack;
    const identity = yield* Schema.decodeEffect(Schema.Struct({ world: Values.WorldName, owner: Values.OperatorName }))(
      {
        world: stage,
        owner: yield* Config.String("WORLD_OWNER"),
      },
    ).pipe(Effect.orDie);
    const hyperdrive = yield* Cloudflare.Hyperdrive.Connect(CoreDatabase);
    // One pool per request, opened on the first query and closed when the request ends.
    const database = SQL.PostgresLayer({ url: hyperdrive.connectionString });
    const served = Served.pipe(
      Layer.provideMerge(RpcSerialization.layerJson),
      Layer.provide(SqlSpanSink),
      Layer.provide(database),
      Layer.provide(Layer.succeed(CoreIdentity, identity)),
    );
    return {
      // A defect in one call answers that call only; it does not end the caller's whole client.
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the Worker's fetch is its entry point: each request gets its own database pool
      fetch: RpcServer.toHttpEffect(CoreRpcs, { disableFatalDefects: true }).pipe(Effect.provide(served)),
    };
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the Worker's init is its entry point, as Alchemy documents
  }).pipe(Effect.provide(Cloudflare.Hyperdrive.ConnectBinding)),
) {}
