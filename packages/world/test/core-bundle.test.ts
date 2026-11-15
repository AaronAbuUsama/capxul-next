// A world's copy of Core's bundle (src/parts/api/bundle.ts) is what Alchemy itself would upload for that world: the
// same modules, byte for byte, as its own build for the world's stage, read back the way a prebuilt Worker is read.
// It fails when an Alchemy upgrade changes how Core is built, so the shortcut never drifts from the real build.
import * as assert from "node:assert/strict";
import { test } from "node:test";
import { getCompatibility, getToolingCompatibility } from "@alchemy.run/cloudflare/Workers/Compatibility";
import { readPrebuiltWorkerBundle } from "@alchemy.run/cloudflare/Workers/Sources/Prebuilt";
import { WorkerBundle } from "@alchemy.run/cloudflare/Workers/Sources/Rolldown";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { coreProps } from "@capxul/core";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import { worldCopy } from "../src/parts/api/bundle.ts";
import { STACK } from "../src/stack/names.ts";

const STAGE = "w-bundle-test";
const text = (content: string | Uint8Array) =>
  typeof content === "string" ? content : new TextDecoder().decode(content);

test(
  "a world's copy of Core is Alchemy's own build for its stage, without the source maps",
  { timeout: 120_000 },
  async () => {
    const [copied, own] = await Effect.runPromise(
      Effect.gen(function* () {
        const main = yield* worldCopy(STAGE);
        assert.ok(Option.isSome(main), "the shared build was made");
        const read = yield* readPrebuiltWorkerBundle({ main: main.value });
        const props = coreProps();
        const bundler = yield* WorkerBundle;
        const built = yield* bundler.build({
          id: "Core",
          main: props.main,
          compatibility: getToolingCompatibility(getCompatibility(props), props.main),
          entry: { kind: "effect", exports: {} },
          stack: { name: STACK, stage: STAGE },
          extraOptions: undefined,
        });
        return [read.files, built.files] as const;
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
    const modules = Arr.filter(own, (file) => Str.endsWith(".js")(file.path));
    const paths = Arr.map((file: { readonly path: string }) => file.path);
    assert.deepStrictEqual(paths(copied), paths(modules));
    for (const [index, file] of modules.entries())
      assert.strictEqual(text(copied[index]!.content), text(file.content), file.path);
  },
);
