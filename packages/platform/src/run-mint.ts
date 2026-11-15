// Entry: mints a world's site token under a platform stage's door key and writes it to a file readable only by its
// owner. Prints the claims and the token's print, never the token. A world's create step runs it with the world's
// quota and expiry; packages/world can instead call `mint` through src/door.ts.
// Usage: bin/run.sh bun src/run-mint.ts <platform-stage> <world> <quota> <expires-unix-seconds> <out-file>
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Alchemist from "alchemy/Alchemist";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { doorKey } from "./door.ts";
import { cryptoLayer, fingerprint, mint } from "./token.ts";
import { exportFromConfig, platformTelemetry } from "./telemetry.ts";

Effect.gen(function* () {
  const [stage = "", world = "", quota = "", expires = "", out = ""] = process.argv.slice(2);
  const key = yield* doorKey(stage);
  const token = yield* mint(key, { world, quota: Number(quota), expires: Number(expires) });
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(out, Redacted.value(token), { mode: 0o600 });
  const print = yield* fingerprint(token);
  yield* Console.log(`minted: world=${world} quota=${quota} expires=${expires} print=${print} file=${out}`);
}).pipe(
  Effect.scoped,
  // With OTLP export, as OpenTelemetry's standard settings ask (src/telemetry.ts); flushed when the command ends.
  Effect.provide(
    Layer.mergeAll(Alchemist.layer(), BunServices.layer, cryptoLayer, exportFromConfig(platformTelemetry)),
  ),
  BunRuntime.runMain,
);
