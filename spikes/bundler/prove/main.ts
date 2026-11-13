// The proof's entry: `bun prove/main.ts setup <chain-rpc>` puts the test contracts on a world's chain and prints
// what it made; `bun prove/main.ts send <chain-rpc> <bundler-rpc> <world.json>` sends one sponsored UserOperation and
// prints the bundler's answers and the chain's effect. Both print one JSON line.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { readFileSync } from "node:fs";
import { setup, type World } from "./setup.ts";
import { sendUserOperation } from "./userop.ts";

const show = (value: unknown) => Console.log(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? String(v) : v)));

const [command, rpc, bundler, worldFile] = process.argv.slice(2);
const program =
  command === "setup" && rpc
    ? setup(rpc).pipe(Effect.flatMap(show))
    : command === "send" && rpc && bundler && worldFile
      ? sendUserOperation(rpc, bundler, (JSON.parse(readFileSync(worldFile, "utf8")) as { world: World }).world).pipe(Effect.flatMap(show))
      : Console.error("usage: main.ts setup <rpc> | send <rpc> <bundler> <world.json>");

NodeRuntime.runMain(program);
