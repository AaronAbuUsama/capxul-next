// Entry: mints a world's site token and writes it to a file readable only by its owner. Prints the claims and the
// token's print, never the token. The world's create step runs it with the world's quota and expiry.
// Usage: ./run.sh bun src/run-mint.ts <world> <quota> <expires-unix-seconds> <out-file>
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Redacted from "effect/Redacted";
import { fingerprint, mint } from "./token.ts";

Effect.gen(function* () {
  const [world = "", quota = "", expires = "", out = ""] = process.argv.slice(2);
  const key = yield* Config.Redacted("PLATFORM_DOOR_KEY");
  const token = yield* mint(key, { world, quota: Number(quota), expires: Number(expires) });
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(out, Redacted.value(token), { mode: 0o600 });
  yield* Console.log(`minted: world=${world} quota=${quota} expires=${expires} print=${fingerprint(token)} file=${out}`);
}).pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
