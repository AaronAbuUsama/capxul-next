// Core's bundle, built once per process and given to each world's Core Worker as its own prebuilt copy (run-time.md,
// option 6d).
//
// Alchemy builds a Worker's bundle inside each deploy's own plan, so every world one process made built Core again:
// 2.2 to 3.6 s of rolldown each, and a run makes ten worlds or more. The bundle differs between worlds only in the stage
// Alchemy writes into the entry it generates (its Worker bridge), so it is built once here with a placeholder stage,
// and each world's copy is that build with the world's own stage written in: byte for byte the JavaScript Alchemy
// would have built for that world. What changes is what is uploaded: Alchemy uploaded its hidden source maps with the
// modules (10.3 MB beside 1.5 MB of JavaScript); a prebuilt Worker uploads only the modules.
//
// Each world still has its own Worker, uploaded by its own deploy: Cloudflare keeps a Worker's modules per script, and
// no upload is shared between scripts. Anything unexpected (the build fails, the placeholder is not in the entry
// exactly once, a stage it cannot be written into) leaves the deploy to Alchemy's own build, as before.
import { getCompatibility, getToolingCompatibility } from "@alchemy.run/cloudflare/Workers/Compatibility";
import { WorkerBundle } from "@alchemy.run/cloudflare/Workers/Sources/Rolldown";
import { workerProps } from "@capxul/core";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Str from "effect/String";
import { STACK } from "../../stack/names.ts";
import { CoreHost } from "./host.ts";

/** The stage the build names in Core's entry, beside the world stack's name; replaced in each world's copy. */
const PLACEHOLDER = "capxul-api-stage-placeholder-0f3c9a";
/** The stages that can be written into the entry's string as they are: a world's stage names are of these. */
const WRITABLE = /^[a-z0-9-]+$/;

interface BuiltFile {
  readonly path: string;
  readonly content: string | Uint8Array;
}

const textOf = (content: string | Uint8Array) =>
  Predicate.isString(content) ? content : new TextDecoder().decode(content);

/** How often the placeholder appears in a text. */
const countOf = (text: string) => Str.split(text, PLACEHOLDER).length - 1;

/** Builds Core once, with the placeholder stage; none when the build fails or its entry is not as expected. */
const buildOnce = Effect.fn("world.api.bundle")(
  function* () {
    const props = workerProps();
    const bundler = yield* WorkerBundle;
    const built = yield* bundler.build({
      id: "Core",
      main: props.main,
      compatibility: getToolingCompatibility(getCompatibility(props), props.main),
      entry: { kind: "effect", exports: {} },
      stack: { name: STACK, stage: PLACEHOLDER },
      // The source maps are not uploaded by a prebuilt Worker: not making them saves a part of the build too.
      extraOptions: { output: { sourcemap: false } },
    });
    const files: ReadonlyArray<BuiltFile> = built.files;
    const [entry, ...rest] = files;
    if (entry === undefined) return yield* Effect.fail("the build made no modules");
    if (countOf(textOf(entry.content)) !== 1) return yield* Effect.fail("the stage is not in the entry exactly once");
    if (Arr.some(rest, (file) => countOf(textOf(file.content)) > 0))
      return yield* Effect.fail("the stage is in a module other than the entry");
    yield* Effect.logInfo(`core bundle: built once for this process, ${files.length} modules`);
    return Option.some(files);
  },
  // A defect too (rolldown not loading, say): every world would otherwise fail on the one cached failure.
  Effect.catchCause((cause) =>
    Effect.as(
      Effect.logWarning(`core bundle: not built once; each deploy builds Core itself`, cause),
      Option.none<ReadonlyArray<BuiltFile>>(),
    ),
  ),
);

/** Core's bundle for this process: built by the first world that asks, shared by every world after it. */
const once = buildOnce().pipe(Effect.cached, Effect.runSync);

/** Whether this program's worlds deploy Core's Worker themselves: not when a host runs Core (host.ts). */
const deploysApi = Effect.gen(function* () {
  return Option.isNone(yield* CoreHost);
});

/**
 * Starts Core's build, once per process, so it runs beside a world's database branch rather than inside its deploy.
 * The build runs on its own: a create that fails meanwhile does not abandon it for the worlds after. Nothing when this
 * program's worlds deploy no Core Worker.
 */
export const warmApi = Effect.fn("world.api.warm")(function* () {
  if (yield* deploysApi) yield* once.pipe(Effect.forkDetach);
});

/**
 * Writes one world's copy of Core's bundle into a directory that lasts as long as the scope, and answers the path of
 * its entry module; none when there is no shared build, and the deploy builds Core itself.
 */
export const worldCopy = Effect.fn("world.api.copy")(function* (stage: string) {
  if (!(yield* deploysApi) || !WRITABLE.test(stage)) return Option.none<string>();
  const built = yield* once;
  if (Option.isNone(built)) return Option.none<string>();
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "capxul-api-" });
  const [entry, ...rest] = built.value;
  if (entry === undefined) return Option.none<string>();
  yield* fs.writeFileString(path.join(directory, entry.path), Str.replace(PLACEHOLDER, stage)(textOf(entry.content)));
  yield* Effect.forEach(rest, (file) =>
    Predicate.isString(file.content)
      ? fs.writeFileString(path.join(directory, file.path), file.content)
      : fs.writeFile(path.join(directory, file.path), file.content),
  );
  return Option.some(path.join(directory, entry.path));
});

/** The entry of this deploy's copy of Core's bundle, provided by the deploy (src/stack/engine.ts); none by default. */
export const PrebuiltApi = Context.Reference<Option.Option<string>>("@capxul/world/parts/api/bundle/PrebuiltApi", {
  defaultValue: () => Option.none(),
});
