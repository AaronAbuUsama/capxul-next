// The three images every world runs, and how a deploy names each one.
//
// Each image is built from a context and a Dockerfile (BUILDS). Alchemy names a built image by a hash of its whole
// build context, read file by file on every deploy: Alto's 237 MB of node_modules took 20.9 s of a create and Ponder's
// context 10.8 s (spikes/world-speed, 1.2), and that hash changes with nothing but how node_modules happened to be
// installed, so a container whose install differs builds again and, where Docker cannot push, fails
// (records/speed/before-create-ewb1.log). So each image is pinned (PINS): the digest it was published as, and a cheap
// fingerprint of what it was built from. The fingerprint reads only the files the Dockerfile can see, and reads each
// node_modules folder as the lockfile and settings it is installed from, so it takes milliseconds and does not depend
// on the install. A deploy whose fingerprint matches the pin deploys the published image by digest and hashes nothing;
// one whose inputs changed builds by context as before, and says so, so a stale pin is slow but never wrong.
//
// To pin an image again after its inputs changed: deploy once (it builds and publishes as before), then copy the
// digest the deploy's log names and the fingerprint `./run.sh images` prints into PINS. The index's image copies
// `ponder/node_modules` and the bundler's `images/alto/node_modules`: after a change to either's package.json, run
// `pnpm install --ignore-workspace` there first. In an agent's container the Docker daemon has no route out, so such a
// deploy builds the image and fails at the push: `images/publish.sh <repository:tag>...`, with the tags the failed
// deploy's log names, pushes them through the session's proxy, and the next deploy needs no Docker.
import * as Alchemy from "alchemy";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { pipe } from "effect/Function";
import * as Order from "effect/Order";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Str from "effect/String";
import * as Digest from "effect/crypto/Digest";
import { BUNDLER_IMAGE, CHAIN_IMAGE, INDEX_IMAGE } from "./names.ts";

const WORLD = `${import.meta.dirname}/../..`;
const PACKAGES = `${WORLD}/..`;

/** What an image is built from: Docker's context and Dockerfile, and the repository it is published to. */
export interface ImageBuild {
  readonly repository: string;
  readonly context: string;
  readonly dockerfile: string;
}

export const BUILDS = {
  /** Anvil with the seeded state: packages/contracts/state is the context. */
  chain: {
    repository: CHAIN_IMAGE,
    context: `${PACKAGES}/contracts/state`,
    dockerfile: `${WORLD}/images/anvil/Dockerfile`,
  },
  /** The real Ponder app: the repository's packages/ folder is the context, narrowed by ponder/Dockerfile.dockerignore. */
  index: { repository: INDEX_IMAGE, context: PACKAGES, dockerfile: `${WORLD}/ponder/Dockerfile` },
  /** alto: images/alto is the context, with its node_modules installed beforehand. */
  bundler: {
    repository: BUNDLER_IMAGE,
    context: `${WORLD}/images/alto`,
    dockerfile: `${WORLD}/images/alto/Dockerfile`,
  },
} as const satisfies Record<string, ImageBuild>;

export type ImageKind = keyof typeof BUILDS;
export const IMAGE_KINDS: ReadonlyArray<ImageKind> = ["chain", "index", "bundler"];

/** An image as it was published: the fingerprint of its inputs then, and the digest the registry gave it. */
export interface Pin {
  readonly inputs: string;
  readonly digest: string;
}

/**
 * Each image as last published. The digests are the ones every create used on 13 and 14 November 2026
 * (spikes/world-speed records: registry cache hits of these exact digests from the inputs at 3d2e8d7c, unchanged since).
 */
export const PINS: Readonly<Record<ImageKind, Pin>> = {
  chain: {
    inputs: "56d2fc66ad074bffebd502bfa7aeed70a2830e6467a531fa2c73e650dc4bee61",
    digest: "sha256:bb1777935f5ffaf6966cae1770807090823671b0cd2b0ea3fdc7ba88f0e15474",
  },
  index: {
    inputs: "e7fb22c96b0babf76abeba7bca6000b2f6ad55b081b17e0ed85e6aa88df97386",
    digest: "sha256:46acfce74583a150332ef0343c34d3ecac012452d3263fbc02f10c26549dace9",
  },
  bundler: {
    inputs: "6e0e1a5bc7f39e1b77b3a0186df2ce6ea126d855ba38702656d1ca0010e40121",
    digest: "sha256:2980e3139ccc5b9ee40246d313c59674b7916d11ed7c701d4de7b650b191f916",
  },
};

/** One line of a .dockerignore: a path, or `*`, that is left out, or with `!` let back in. */
export interface IgnoreRule {
  readonly pattern: string;
  readonly include: boolean;
}

/**
 * The rules of a .dockerignore. Only the forms this package's images use are understood: `*`, and plain paths with
 * or without `!`. Anything else (`**`, `?`, a `*` inside a path) is refused, so the fingerprint never misses an input.
 */
export const ignoreRulesOf = (text: string): Effect.Effect<ReadonlyArray<IgnoreRule>, string> =>
  Effect.forEach(
    pipe(
      Str.split(text, "\n"),
      Arr.map(Str.trim),
      Arr.filter((line) => line !== "" && !Str.startsWith("#")(line)),
    ),
    (line) => {
      const include = Str.startsWith("!")(line);
      const pattern = pipe(include ? Str.slice(1)(line) : line, Str.replace(/^\.?\//, ""), Str.replace(/\/$/, ""));
      return pattern !== "*" && /[*?[\]]/.test(pattern)
        ? Effect.fail(`.dockerignore pattern "${line}" is not one the image fingerprint understands`)
        : Effect.succeed({ pattern, include });
    },
  );

const matches = (pattern: string, path: string) =>
  pattern === "*" || path === pattern || Str.startsWith(`${pattern}/`)(path);

/** Whether Docker sends `path` (relative to the context) to the builder: the last rule that matches decides. */
export const isSent = (rules: ReadonlyArray<IgnoreRule>, path: string): boolean =>
  pipe(
    Arr.findLast(rules, (rule) => matches(rule.pattern, path)),
    (found) => (found._tag === "Some" ? found.value.include : true),
  );

/** Whether anything under the folder `path` can be sent: the folder itself, or a path a later rule lets back in. */
const mayHoldSent = (rules: ReadonlyArray<IgnoreRule>, path: string): boolean =>
  isSent(rules, path) || Arr.some(rules, (rule) => rule.include && Str.startsWith(`${path}/`)(rule.pattern));

/** The files a node_modules folder is installed from; they stand for it in the fingerprint. */
export const INSTALLED_FROM: ReadonlyArray<string> = [
  "package.json",
  "pnpm-lock.yaml",
  ".npmrc",
  "pnpm-workspace.yaml",
];

/** One input of an image: a file Docker sends, or a node_modules folder, read as what it is installed from. */
export interface Input {
  readonly kind: "file" | "modules";
  readonly path: string;
}

/** Every input of a build, relative to its context, in a stable order. */
export const inputsOf = (build: ImageBuild) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // Docker reads <Dockerfile>.dockerignore beside a Dockerfile first, then the context's own .dockerignore.
    const own = `${build.dockerfile}.dockerignore`;
    const ignore = (yield* fs.exists(own)) ? own : path.join(build.context, ".dockerignore");
    const rules = (yield* fs.exists(ignore)) ? yield* ignoreRulesOf(yield* fs.readFileString(ignore)) : [];
    const walk = (folder: string): Effect.Effect<ReadonlyArray<Input>, PlatformError> =>
      Effect.gen(function* () {
        const entries = yield* fs.readDirectoryEntries(path.join(build.context, folder));
        const found = yield* Effect.forEach(entries, (entry) =>
          Effect.gen(function* () {
            const at = folder === "" ? entry.name : `${folder}/${entry.name}`;
            const type =
              entry.type === "SymbolicLink" || entry.type === "Unknown"
                ? (yield* fs.stat(path.join(build.context, at))).type
                : entry.type;
            // A node_modules folder is never read: the lockfile beside it stands for it, whether it is installed
            // here or not, so a pinned deploy needs no install.
            if (type === "Directory")
              return entry.name !== "node_modules" && mayHoldSent(rules, at) ? yield* walk(at) : [];
            const modules = folder === "" ? "node_modules" : `${folder}/node_modules`;
            const installed: ReadonlyArray<Input> =
              entry.name === "pnpm-lock.yaml" && isSent(rules, modules) ? [{ kind: "modules", path: modules }] : [];
            return type === "File" && isSent(rules, at)
              ? [...installed, { kind: "file" as const, path: at }]
              : installed;
          }),
        );
        return Arr.flatten(found);
      });
    const all = yield* walk("");
    return Arr.sort(
      all,
      Order.mapInput(Order.String, (input: Input) => `${input.path} ${input.kind}`),
    );
  });

/**
 * The fingerprint of what an image is built from: its Dockerfile, every file Docker sends, and for each node_modules
 * folder Docker sends, the files it is installed from (not the folder itself, which differs between installs).
 */
export const fingerprintOf = (build: ImageBuild) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const digest = yield* Digest.Digest;
    const hashOf = (file: string) =>
      Effect.flatMap(fs.readFile(file), (bytes) => digest.digestHex(Digest.sha256, bytes));
    const inputs = yield* inputsOf(build);
    const lines = yield* Effect.forEach(inputs, (input) =>
      input.kind === "file"
        ? Effect.map(hashOf(path.join(build.context, input.path)), (hash) => `file ${input.path} ${hash}`)
        : Effect.gen(function* () {
            const parent = path.dirname(path.join(build.context, input.path));
            const from = yield* Effect.filter(INSTALLED_FROM, (name) => fs.exists(path.join(parent, name)));
            const hashes = yield* Effect.forEach(from, (name) =>
              Effect.map(hashOf(path.join(parent, name)), (hash) => `${name}=${hash}`),
            );
            return `modules ${input.path} ${Arr.join(hashes, " ")}`;
          }),
    );
    const dockerfile = `dockerfile ${yield* hashOf(build.dockerfile)}`;
    return yield* digest.digestHex(Digest.sha256, new TextEncoder().encode(Arr.join([dockerfile, ...lines], "\n")));
  });

/** The image a world's container is deployed from: the pinned digest, or a build by context when its inputs changed. */
export type ImageSource =
  | { readonly image: string }
  | { readonly context: string; readonly dockerfile: string; readonly publish: { readonly repository: string } };

/** The pinned image, by digest. Alchemy puts the account's own namespace into a registry.cloudflare.com reference. */
export const pinnedImage = (kind: ImageKind): string =>
  `registry.cloudflare.com/${BUILDS[kind].repository}@${PINS[kind].digest}`;

/** Whether an image's inputs are what its pin was published from, and both fingerprints. */
export const pinState = (kind: ImageKind) =>
  Effect.map(fingerprintOf(BUILDS[kind]), (inputs) => ({
    image: kind,
    repository: BUILDS[kind].repository,
    pinned: PINS[kind].inputs,
    inputs,
    digest: PINS[kind].digest,
    current: inputs === PINS[kind].inputs,
  }));

/**
 * What a container class deploys. Inside a running Worker the stack's files are evaluated again only to name
 * bindings, and nothing is read from disk there; the pinned image stands in.
 */
export const imageSource = (kind: ImageKind) =>
  Effect.gen(function* () {
    const pinned: ImageSource = { image: pinnedImage(kind) };
    if ((yield* Alchemy.ALCHEMY_PHASE) === "runtime") return pinned;
    const state = yield* pinState(kind).pipe(Effect.orDie);
    if (state.current) {
      yield* Effect.logInfo(`image ${state.repository}: inputs as pinned, deploying ${PINS[kind].digest}`);
      return pinned;
    }
    yield* Effect.logWarning(
      `image ${state.repository}: inputs changed since its pin (pinned ${state.pinned}, now ${state.inputs}); ` +
        "building it by context, which hashes the whole context and may need Docker. Pin it again: src/stack/images.ts",
    );
    const { context, dockerfile, repository } = BUILDS[kind];
    const built: ImageSource = { context, dockerfile, publish: { repository } };
    return built;
  });
