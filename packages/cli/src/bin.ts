#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// The `capxul` process: runs the command line on this process's arguments, standard output and environment, and
// exits with the blueprint's exit code for a refusal (Errors.exitCode), 1 for anything else that failed, 0 on
// success. Where a call goes and what signs it come from the environment (packages/sdk, `platformTarget` and
// `worldTarget`), or else from the profile `capxul login` and `capxul use` keep (src/target.ts, src/profile.ts).
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Command from "effect/cli/Command";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { capxul, exitCodeOf, VERSION } from "./door.ts";

const main = Command.run(capxul, { version: VERSION }).pipe(
  Effect.match({ onSuccess: () => 0, onFailure: exitCodeOf }),
  Effect.flatMap((code) =>
    Effect.sync(() => {
      process.exitCode = code;
    }),
  ),
  Effect.provide(Layer.merge(NodeServices.layer, FetchHttpClient.layer)),
);

NodeRuntime.runMain(main);
