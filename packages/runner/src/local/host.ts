// `--core=local`: every world the run makes gets its Core run here, in workerd, instead of as a Worker on Cloudflare
// (packages/world, src/core/host.ts). Its database, chain, index, bundler and door stay on Cloudflare and Neon; only
// Core moves, so that it can reach a stand-in bench on this machine, which nothing on Cloudflare can.
//
// One bundle of Core per run (bundle.ts), one chain forwarder for every world (forward.ts), and for each world its
// database bridge (database.ts) and its workerd process (workerd.ts), in a scope of its own that its destroy closes.
// A record of a run with this host says so (`LOCAL_CORE_LABEL`): it is a rehearsal, never the Cloudflare proof.
import { CORE_ENV } from "@capxul/core";
import * as World from "@capxul/world";
import * as BunSocketServer from "@effect/platform-bun/BunSocketServer";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { buildCore } from "./bundle.ts";
import { bridgeTo, portOf } from "./database.ts";
import { chainForwarder } from "./forward.ts";
import { runWorkerd, type Text } from "./workerd.ts";

/** What every record of a run with a local Core says about it, so it is never taken for the Cloudflare proof. */
export const LOCAL_CORE_LABEL =
  "local-Core rehearsal: Core ran in workerd on the runner's machine, next to a stand-in bench, against the world's database, chain, index and bundler on Cloudflare and Neon. Not the proof that the scenarios pass with Core on Cloudflare (roadmap step 1.6).";

interface Hosted {
  readonly port: number;
  readonly scope: Option.Option<Scope.Closeable>;
  readonly token: Option.Option<Redacted.Redacted>;
}

/** A free port on the loopback: one the system gives a listener that is closed again at once. */
const freePort = Effect.scoped(
  Effect.map(BunSocketServer.make({ port: 0, host: "127.0.0.1" }), (server) => portOf(server.address)),
);

/** The world's facts and secrets, by the names a deploy binds them under (packages/world src/core/Core.ts). */
const envOf = (core: World.HostedCore): Readonly<Record<string, Text>> => ({
  [CORE_ENV.world]: core.world.name,
  [CORE_ENV.owner]: core.world.owner,
  [CORE_ENV.doorToken]: core.world.doorToken,
  [CORE_ENV.platformToken]: core.operatorToken,
  [CORE_ENV.chainToken]: core.world.doorToken,
  ...Option.match(core.bench, {
    onNone: () => ({}),
    onSome: (bench) => ({
      [CORE_ENV.siteDoor]: bench.door,
      [CORE_ENV.siteToken]: bench.token,
      [CORE_ENV.siteKey]: core.siteKey,
      [CORE_ENV.siteSecret]: core.siteSecret,
    }),
  }),
});

/** The host, for as long as the layer lives: every Core it started is stopped when it ends. */
export const localCoreHost = Layer.effect(
  World.CoreHost,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "capxul-local-core-" });
    yield* Effect.logInfo("local Core: building Core's bundle for workerd");
    const bundle = yield* buildCore(path.join(directory, "bundle"));
    const forwarder = yield* chainForwarder;
    const runScope = yield* Effect.scope;
    const hosted = yield* Ref.make(new Map<string, Hosted>());
    const services = yield* Effect.context<
      FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
    >();

    const urlOf = (stage: string) =>
      Effect.gen(function* () {
        const held = (yield* Ref.get(hosted)).get(stage);
        if (held !== undefined) return `http://127.0.0.1:${held.port}`;
        const port = yield* Effect.orDie(freePort);
        yield* Ref.update(
          hosted,
          (all) => new Map([...all, [stage, { port, scope: Option.none(), token: Option.none() }]]),
        );
        return `http://127.0.0.1:${port}`;
      });

    /** Stops what runs for a world: its workerd, its database bridge and its route through the forwarder. */
    const release = (held: Hosted) =>
      Effect.gen(function* () {
        if (Option.isSome(held.token)) yield* forwarder.remove(held.token.value);
        if (Option.isSome(held.scope)) yield* Scope.close(held.scope.value, Exit.void);
      });

    const stop = (stage: string) =>
      Effect.gen(function* () {
        const held = (yield* Ref.get(hosted)).get(stage);
        if (held === undefined) return;
        yield* Ref.update(hosted, (all) => new Map(Arr.filter([...all], ([each]) => each !== stage)));
        yield* release(held);
        yield* Effect.logInfo(`local Core of ${stage}: stopped`);
      });

    const start = (core: World.HostedCore) =>
      Effect.gen(function* () {
        const stage = core.world.stage;
        const url = yield* urlOf(stage);
        // A Core started again for the same world replaces the one before it, at the same address.
        const before = (yield* Ref.get(hosted)).get(stage);
        if (before !== undefined) yield* release(before);
        const port = (yield* Ref.get(hosted)).get(stage)?.port ?? 0;
        const scope = yield* Scope.fork(runScope);
        yield* Ref.update(
          hosted,
          (all) =>
            new Map([...all, [stage, { port, scope: Option.some(scope), token: Option.some(core.world.doorToken) }]]),
        );
        const database = yield* Scope.provide(bridgeTo(core.world.database), scope);
        yield* forwarder.add(core.world.doorToken, core.world.door);
        yield* Scope.provide(
          runWorkerd(directory, { stage, port, bundle, database, chainPort: forwarder.port, env: envOf(core) }),
          scope,
        ).pipe(Effect.provide(services));
        yield* Effect.logInfo(`local Core of ${stage}: workerd serves it at ${url}`);
      }).pipe(Effect.mapError((error) => `the local Core did not start: ${error.message}`));

    const host: World.CoreHost = { urlOf, start, stop, label: LOCAL_CORE_LABEL };
    yield* Effect.addFinalizer(() => Effect.logInfo("local Core: every world's Core stopped"));
    return Option.some(host);
  }),
);
