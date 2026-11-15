// What one deploy of Core is given: the Hyperdrive configuration it binds as its database, and the facts it binds
// into its environment by the names in src/env.ts. A Core of its own stage (the runner's `CapxulCore`) takes both
// from its own stack and the deployer's environment; a world's Core (packages/world, its Core slot) is handed them
// by providing `CoreDeployment` around the Worker, because a world's facts are its stack's own resources.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ENV } from "../env.ts";
import { CoreDatabase } from "./database.ts";

export interface Deployment {
  readonly database: Cloudflare.Hyperdrive.Connection;
  /** Values for the names of src/env.ts: text, `Redacted` (bound as secrets), Alchemy outputs, or a Worker (a service binding). */
  readonly env: Readonly<Record<string, unknown>>;
}

export const CoreDeployment = Context.Reference<Option.Option<Deployment>>("@capxul/core/stack/CoreDeployment", {
  defaultValue: () => Option.none(),
});

/** A stage of `CapxulCore`: its own database, and its facts from the deployer's environment (packages/runner). */
export const ownDeployment = Effect.gen(function* () {
  const database = yield* CoreDatabase;
  const secondOwner = yield* Config.option(Config.String(ENV.secondOwner));
  const secondToken = yield* Config.option(Config.Redacted(ENV.secondPlatformToken));
  const handlers = yield* Config.option(Config.String(ENV.handlers));
  // `on` gives this stage the tap (src/telemetry/export.ts), as a world of a test grade has it.
  const tap = yield* Config.option(Config.String(ENV.tap));
  const second =
    Option.isSome(secondOwner) && Option.isSome(secondToken)
      ? { [ENV.secondOwner]: secondOwner.value, [ENV.secondPlatformToken]: secondToken.value }
      : {};
  return {
    database,
    env: {
      [ENV.owner]: yield* Config.String(ENV.owner),
      [ENV.doorToken]: yield* Config.Redacted(ENV.doorToken),
      [ENV.platformToken]: yield* Config.Redacted(ENV.platformToken),
      ...second,
      ...(Option.isSome(handlers) ? { [ENV.handlers]: handlers.value } : {}),
      ...(Option.isSome(tap) ? { [ENV.tap]: tap.value } : {}),
    },
  } satisfies Deployment;
});
