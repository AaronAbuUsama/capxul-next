// One world's local Core as a workerd process: Core's bundle (bundle.ts) served on a loopback port, with the bindings
// a deploy gives the Worker on Cloudflare (packages/world src/core/Core.ts), by the same names (CORE_ENV):
//
//   DATABASE   a Hyperdrive binding, as on Cloudflare, whose origin is the world's database bridge (database.ts)
//   CHAIN      a service binding to the chain forwarder (forward.ts), which carries it to the world's door
//   the rest   the world's facts and secrets as text, and the site door of the stand-in bench on this machine
//
// workerd reads its configuration from a Cap'n Proto text file, written here with every secret in it; the file is in
// the run's own temporary directory, readable by this user only, and goes with it.
import { CORE_ENV } from "@capxul/core";
import * as Arr from "effect/Array";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Rec from "effect/Record";
import * as Redacted from "effect/Redacted";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Str from "effect/String";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { RunnerFailure } from "../failure.ts";
import type { CoreBundle } from "./bundle.ts";
import type { DatabaseBridge } from "./database.ts";

/** A binding's value: plain text, or a secret that is written into the configuration and nowhere else. */
export type Text = string | Redacted.Redacted;

export interface LocalCoreConfig {
  readonly stage: string;
  readonly port: number;
  readonly bundle: CoreBundle;
  readonly database: DatabaseBridge;
  readonly chainPort: number;
  readonly env: Readonly<Record<string, Text>>;
}

/** A Cap'n Proto text literal. */
const quoted = (value: Text) => {
  const text = Redacted.isRedacted(value) ? Redacted.value(value) : value;
  return `"${Str.replace(/"/g, '\\"')(Str.replace(/\\/g, "\\\\")(text))}"`;
};

/**
 * The configuration file workerd serves the world's Core from. `bundleFrom` is the bundle's directory relative to
 * the file's: Cap'n Proto embeds a file by a path relative to the file that names it.
 */
export const configOf = (config: LocalCoreConfig, bundleFrom: string) => {
  const modules = Arr.map(
    config.bundle.modules,
    (module) => `    (name = ${quoted(module)}, esModule = embed ${quoted(`${bundleFrom}/${module}`)}),`,
  );
  const text = Arr.map(
    Rec.toEntries(config.env),
    ([name, value]) => `    (name = ${quoted(name)}, text = ${quoted(value)}),`,
  );
  const flags = Arr.join(Arr.map(config.bundle.compatibility.flags, quoted), ", ");
  return Arr.join(
    [
      `using Workerd = import "/workerd/workerd.capnp";`,
      `const config :Workerd.Config = (`,
      `  services = [`,
      `    (name = "core", worker = .core),`,
      `    (name = "internet", network = (allow = ["public", "private", "local"])),`,
      `    (name = "chain", external = (address = "127.0.0.1:${config.chainPort}", http = ())),`,
      `    (name = "database", external = (address = "127.0.0.1:${config.database.port}", tcp = ())),`,
      `  ],`,
      `  sockets = [(name = "http", address = "127.0.0.1:${config.port}", http = (), service = "core")],`,
      `);`,
      `const core :Workerd.Worker = (`,
      `  modules = [`,
      ...modules,
      `  ],`,
      `  compatibilityDate = ${quoted(config.bundle.compatibility.date)},`,
      `  compatibilityFlags = [${flags}],`,
      `  bindings = [`,
      ...text,
      `    (name = ${quoted(CORE_ENV.chain)}, service = "chain"),`,
      `    (name = ${quoted(CORE_ENV.database)}, hyperdrive = (designator = "database", database = ${quoted(config.database.database)}, user = ${quoted(config.database.user)}, password = ${quoted(config.database.password)}, scheme = "postgresql")),`,
      `  ],`,
      `  globalOutbound = "internet",`,
      `);`,
      ``,
    ],
    "\n",
  );
};

/** The workerd binary: the version Alchemy's own local runtime pins, which run.sh finds. */
const WORKERD = Config.String("CAPXUL_WORKERD");

/**
 * Starts workerd for one world's Core in `directory` and keeps it running for as long as the scope lives. Its output
 * goes to `<stage>.log` beside its configuration.
 */
export const runWorkerd = (
  directory: string,
  config: LocalCoreConfig,
): Effect.Effect<
  void,
  RunnerFailure,
  Scope.Scope | FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const file = path.join(directory, `${config.stage}.capnp`);
    yield* fs.writeFileString(file, configOf(config, path.relative(directory, config.bundle.directory)), {
      mode: 0o600,
    });
    yield* Effect.addFinalizer(() => Effect.ignore(fs.remove(file)));
    const log = path.join(directory, `${config.stage}.log`);
    const binary = yield* WORKERD;
    const handle = yield* spawner.spawn(
      ChildProcess.make(binary, ["serve", file, "--experimental"], {
        stdout: "pipe",
        stderr: "pipe",
        killSignal: "SIGTERM",
        forceKillAfter: "5 seconds",
      }),
    );
    yield* Effect.forkScoped(handle.all.pipe(Stream.run(fs.sink(log)), Effect.ignore));
  }).pipe(
    Effect.mapError((error) =>
      RunnerFailure.make({ step: "local core", message: `workerd did not start: ${error.message}` }),
    ),
  );
