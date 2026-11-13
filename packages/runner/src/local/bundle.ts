// Core's Worker bundle for a local Core (`--core=local`): the same build Alchemy makes when it deploys Core to
// Cloudflare (its rolldown bundle of packages/core's Worker, wrapped in Alchemy's Worker bridge, with the
// compatibility date and flags a deploy gives it), written to a directory once per run, for workerd to serve.
import { CORE_WORKER_MAIN } from "@capxul/core";
import { getCompatibility } from "@alchemy.run/cloudflare/Workers/Compatibility";
import { WorkerBundle } from "@alchemy.run/cloudflare/Workers/Sources/Rolldown";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Str from "effect/String";
import { RunnerFailure } from "../failure.ts";

/** A built Core: its directory, its modules in load order (the entry first) and the runtime settings it was built for. */
export interface CoreBundle {
  readonly directory: string;
  readonly modules: ReadonlyArray<string>;
  readonly compatibility: { readonly date: string; readonly flags: ReadonlyArray<string> };
}

/** The stack and stage the bridge names: a local Core is no stage of any stack on Cloudflare. */
const STACK = { name: "CapxulWorld", stage: "local-core" } as const;

/** Builds Core into `directory` and answers what workerd needs to serve it. */
export const buildCore = Effect.fn("runner.local.bundle")(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const main = CORE_WORKER_MAIN;
  const compatibility = getCompatibility({ main, compatibility: { flags: ["nodejs_compat"] } });
  const bundler = yield* WorkerBundle;
  const built = yield* bundler
    .build({
      id: "Core",
      main,
      compatibility,
      entry: { kind: "effect", exports: {} },
      stack: STACK,
      extraOptions: undefined,
    })
    .pipe(Effect.mapError((error) => RunnerFailure.make({ step: "local core", message: `bundle: ${error.message}` })));
  yield* fs.makeDirectory(directory, { recursive: true });
  yield* Effect.forEach(built.files, (file) =>
    Predicate.isString(file.content)
      ? fs.writeFileString(path.join(directory, file.path), file.content)
      : fs.writeFile(path.join(directory, file.path), file.content),
  );
  const modules = Arr.filter(
    Arr.map(built.files, (file) => file.path),
    Str.endsWith(".js"),
  );
  return { directory, modules, compatibility } satisfies CoreBundle;
});
