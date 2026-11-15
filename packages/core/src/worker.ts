// Core: the Capxul server. A Cloudflare Worker, deployed by Alchemy, that serves every blueprint operation at its
// group's door with Effect's Rpc server, reads its world's chain at `CHAIN_PATH`, and keeps every call's spans in its
// database, reached through Hyperdrive.
//
// What it binds is its deploy's (src/stack/deployment.ts): its own stage's database and facts, or a world's, handed
// to it by packages/world. The running Worker reads every fact per request from its environment (src/env.ts).
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as SQL from "@alchemy.run/sql/Postgres";
import { CHAIN_PATH } from "@capxul/blueprint";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Str from "effect/String";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import { chainRead } from "./chain.ts";
import { COMPANIES_PATH, companiesRead } from "./platform/companies.ts";
import { serveDoors } from "./doors.ts";
import { EMPTY_HANDLERS } from "./empty-handlers.ts";
import { ENV, identityOf, textOf } from "./env.ts";
import { HEALTH_PATH, PROBE_PATH, probeSite } from "./probe.ts";
import { ChainOps } from "./organizations/handlers.ts";
import { Served, ServedEmpty } from "./server.ts";
import { siteOpsLive } from "./site-ops/door.ts";
import { SiteDoor } from "./site/SiteDoor.ts";
import { CoreDeployment, ownDeployment } from "./stack/deployment.ts";
import { coloOf, Placement } from "./telemetry/attributes.ts";
import { CoreIdentity } from "./telemetry/middleware.ts";
import { SqlSpanSink } from "./telemetry/sink.ts";

/** The Hyperdrive binding as the running Worker holds it. */
const connectionString = (env: Record<string, unknown>) =>
  Effect.sync(() => {
    const bound = env[ENV.database];
    const text =
      Predicate.hasProperty(bound, "connectionString") && Predicate.isString(bound.connectionString)
        ? bound.connectionString
        : "";
    return Redacted.make(text);
  });

// The Postgres driver opens its socket through Node's `net` and `tls`. Cloudflare's own logs and traces of the
// Worker go to the account's Axiom destinations: a second view, read by people, never by a check.
const props = () => ({
  main: import.meta.url,
  compatibility: { flags: ["nodejs_compat"] },
  observability: {
    enabled: true,
    logs: { enabled: true, invocationLogs: true, destinations: ["axiom-capxul-logs"] },
    traces: { enabled: true, destinations: ["axiom-capxul-traces"] },
  },
});

export default class Core extends Cloudflare.Worker<Core>()(
  "Core",
  Effect.gen(function* () {
    // Inside the running Worker the stack's files are evaluated again only to name bindings; nothing is read there.
    if ((yield* Alchemy.ALCHEMY_PHASE) === "runtime") return props();
    const given = yield* CoreDeployment;
    const deployment = Option.isSome(given) ? given.value : yield* ownDeployment;
    return { ...props(), env: { ...deployment.env, [ENV.database]: deployment.database } };
  }),
  Effect.succeed({
    fetch: Effect.gen(function* () {
      const env: Record<string, unknown> = yield* Cloudflare.WorkerEnvironment;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const path = Option.match(HttpServerRequest.toURL(request), {
        onNone: () => "",
        onSome: (url) => Str.replace(/\/+$/, "")(url.pathname),
      });
      const identity = yield* identityOf(env);
      const owners = [identity.doorToken, identity.platformToken];
      if (path === HEALTH_PATH) return HttpServerResponse.jsonUnsafe({ core: "capxul", world: identity.world });
      if (path === CHAIN_PATH) return yield* chainRead(env, owners);
      if (path === PROBE_PATH)
        return yield* probeSite(identity.world, owners).pipe(
          // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the Worker's fetch is its entry point: each request gets the site door its environment names
          Effect.provide(SiteDoor.fromEnv(env).pipe(Layer.provide(FetchHttpClient.layer))),
        );
      const siteDoor = SiteDoor.fromEnv(env).pipe(Layer.provide(FetchHttpClient.layer));
      // Hyperdrive pools connections by transaction, so a statement prepared on one connection may run on another:
      // statements go unnamed (the first world run of approval.sign, w-cops2, failed on a named one).
      const database = SQL.PostgresLayer({ url: connectionString(env), prepare: false });
      if (path === COMPANIES_PATH)
        return yield* companiesRead(owners).pipe(
          // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the Worker's fetch is its entry point: each request gets its own database pool
          Effect.provide(
            siteOpsLive(env).pipe(
              Layer.provideMerge(ChainOps.layer(env)),
              Layer.provideMerge(siteDoor),
              Layer.provideMerge(database),
            ),
          ),
          Effect.catchTag("SqlError", (error) =>
            Effect.succeed(HttpServerResponse.jsonUnsafe({ error: error.message }, { status: 500 })),
          ),
        );
      // One pool per request, opened on the first query and closed when the request ends.
      // A stage deployed in empty-handler mode serves every operation's empty handler (src/empty-handlers.ts).
      const handlers: typeof Served = Option.contains(textOf(env[ENV.handlers]), EMPTY_HANDLERS) ? ServedEmpty : Served;
      const served = handlers.pipe(
        Layer.provideMerge(RpcSerialization.layerJson),
        Layer.provide(
          siteOpsLive(env).pipe(Layer.provide(SiteDoor.fromEnv(env).pipe(Layer.provide(FetchHttpClient.layer)))),
        ),
        Layer.provide(SqlSpanSink),
        Layer.provide(ChainOps.layer(env)),
        Layer.provide(database),
        Layer.provide(Layer.succeed(CoreIdentity, identity)),
        // Which Cloudflare data centre runs this request, for every call's span (telemetry/attributes.ts).
        Layer.provide(Layer.succeed(Placement, { colo: coloOf(request.source) })),
      );
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- the Worker's fetch is its entry point: each request gets its own database pool
      return yield* Effect.flatten(serveDoors).pipe(Effect.provide(served));
    }),
  }),
) {}
