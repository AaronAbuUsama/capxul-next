// The images' pins (src/stack/images.ts): the fingerprint a deploy compares with each pin reads only what Docker
// sends, reads a node_modules folder as the files it is installed from, and refuses an ignore rule it cannot follow.
import * as assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Digest from "effect/crypto/Digest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import {
  BUILDS,
  fingerprintOf,
  type ImageBuild,
  ignoreRulesOf,
  inputsOf,
  isSent,
  PINS,
  pinnedImage,
} from "../src/stack/images.ts";

const services = Layer.merge(NodeServices.layer, Digest.layerWebCrypto);
const run = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices | Digest.Digest>) =>
  Effect.runPromise(Effect.provide(effect, services));

/** Each input as `<kind> <path>`. */
const named = (inputs: ReadonlyArray<{ readonly kind: string; readonly path: string }>) =>
  Arr.map(inputs, (input) => `${input.kind} ${input.path}`);

/** A context folder made of `files` (path to content), with a Dockerfile beside it. */
const contextOf = (files: Readonly<Record<string, string>>): ImageBuild & { readonly root: string } => {
  const root = mkdtempSync(join(tmpdir(), "images-"));
  for (const [path, content] of Rec.toEntries(files)) {
    mkdirSync(join(root, "ctx", path, ".."), { recursive: true });
    writeFileSync(join(root, "ctx", path), content);
  }
  writeFileSync(join(root, "Dockerfile"), "FROM scratch\nCOPY . .\n");
  return { root, repository: "test", context: join(root, "ctx"), dockerfile: join(root, "Dockerfile") };
};

describe("an image's fingerprint", () => {
  test("follows the forms of .dockerignore the images use, and refuses any other", () =>
    run(
      Effect.gen(function* () {
        const rules = yield* ignoreRulesOf("# a comment\n*\n!indexer/src\n!world/ponder/node_modules/\n");
        assert.equal(isSent(rules, "indexer/src/api.ts"), true);
        assert.equal(isSent(rules, "indexer/package.json"), false);
        assert.equal(isSent(rules, "world/ponder/node_modules"), true);
        assert.equal(isSent(rules, "core/src/x.ts"), false);
        const plain = yield* ignoreRulesOf("Dockerfile\n.npmrc\n");
        assert.equal(isSent(plain, "Dockerfile"), false);
        assert.equal(isSent(plain, "package.json"), true);
        assert.equal(Exit.isFailure(yield* Effect.exit(ignoreRulesOf("**/*.log\n"))), true);
        assert.equal(Exit.isFailure(yield* Effect.exit(ignoreRulesOf("src/*.ts\n"))), true);
      }),
    ));

  test("reads a node_modules folder as its lockfile and settings, installed or not", () =>
    run(
      Effect.gen(function* () {
        const build = contextOf({
          "package.json": "{}",
          "pnpm-lock.yaml": "lock: 1",
          ".dockerignore": "Dockerfile\n",
          "src/main.js": "1",
        });
        const bare = yield* fingerprintOf(build);
        assert.deepEqual(named(yield* inputsOf(build)), [
          "file .dockerignore",
          "modules node_modules",
          "file package.json",
          "file pnpm-lock.yaml",
          "file src/main.js",
        ]);
        mkdirSync(join(build.context, "node_modules", "left-pad"), { recursive: true });
        writeFileSync(join(build.context, "node_modules", "left-pad", "index.js"), "installed one way");
        assert.equal(yield* fingerprintOf(build), bare, "an install does not change it");
        writeFileSync(join(build.context, "node_modules", "left-pad", "index.js"), "installed another way");
        assert.equal(yield* fingerprintOf(build), bare, "nor does a different install");
        writeFileSync(join(build.context, "pnpm-lock.yaml"), "lock: 2");
        const relocked = yield* fingerprintOf(build);
        assert.notEqual(relocked, bare, "a new lockfile does");
        writeFileSync(join(build.context, "src", "main.js"), "2");
        assert.notEqual(yield* fingerprintOf(build), relocked, "and so does a source file");
        rmSync(build.root, { recursive: true });
      }),
    ));

  test("leaves out what Docker does not send, and reads the Dockerfile", () =>
    run(
      Effect.gen(function* () {
        const build = contextOf({ "kept/a.ts": "a", "other/b.ts": "b" });
        writeFileSync(`${build.dockerfile}.dockerignore`, "*\n!kept\n");
        const before = yield* fingerprintOf(build);
        assert.deepEqual(
          Arr.map(yield* inputsOf(build), (input) => input.path),
          ["kept/a.ts"],
        );
        writeFileSync(join(build.context, "other", "b.ts"), "changed");
        assert.equal(yield* fingerprintOf(build), before);
        writeFileSync(build.dockerfile, "FROM scratch\nCOPY kept .\n");
        assert.notEqual(yield* fingerprintOf(build), before);
        rmSync(build.root, { recursive: true });
      }),
    ));

  test("names each pinned image by digest in its own repository", () => {
    for (const kind of ["chain", "index", "bundler"] as const) {
      assert.match(PINS[kind].digest, /^sha256:[0-9a-f]{64}$/);
      assert.match(PINS[kind].inputs, /^[0-9a-f]{64}$/);
      assert.equal(pinnedImage(kind), `registry.cloudflare.com/${BUILDS[kind].repository}@${PINS[kind].digest}`);
    }
  });

  test("of the real images reads their inputs without their node_modules", () =>
    run(
      Effect.gen(function* () {
        const index = named(yield* inputsOf(BUILDS.index));
        assert.ok(index.includes("modules world/ponder/node_modules"));
        assert.ok(index.includes("file indexer/ponder.schema.ts"));
        assert.ok(!Arr.some(index, Str.includes("node_modules/")));
        const bundler = Arr.map(yield* inputsOf(BUILDS.bundler), (input) => input.path);
        assert.deepEqual(bundler, [".dockerignore", "node_modules", "package.json", "pnpm-lock.yaml"]);
      }),
    ));
});
