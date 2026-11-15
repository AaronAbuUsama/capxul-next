// The one place that decides what runs in a world's Core slot: the real Core (packages/core), deployed with the
// world and handed the world's own facts (CoreDeployment), never its own stage's:
//
//   its database      the world's branch, through the world's Hyperdrive configuration (WorldDatabase)
//   its world door    the world's token on the hub (src/things/cluster/client.ts) and the owner operator's token (`operator-token`)
//   its chain         a service binding to the hub's door, whose `/<token>/rpc` is the chain; Core answers only
//                     the blueprint's reads at CHAIN_PATH
//   its sites         the site door of the world's bench and the world's site token there, and the credential of the
//                     API user the door makes on each of the world's sites (`site-key`, `site-secret`); none when the
//                     world has no bench
//
// Every token is an Alchemy.Random of the world's stage, kept in the shared state, bound to the Worker as a secret
// and read back from the state (parts.ts), never an output.
import { CORE_ENV, CoreDeployment, CoreWorker, migrations } from "@capxul/core";
import * as Alchemy from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { fileURLToPath } from "node:url";
import { WorldDatabase } from "../database/Database.ts";
import * as Cloudflare from "@alchemy.run/cloudflare";
import { HUB_STACK } from "../../things/cluster/values.ts";
import { nameOf } from "../../stack/names.ts";
import { worldSettings } from "../../stack/settings.ts";
import type { CoreSlot } from "../../things/world/stage.ts";
import { PrebuiltCore } from "./bundle.ts";
import { CoreHost } from "./host.ts";

/** Logical ids of the Core slot's own secrets, as the state store keys them. */
export const OPERATOR_TOKEN_ID = "operator-token";
export const SITE_KEY_ID = "site-key";
export const SITE_SECRET_ID = "site-secret";

/** What fills a world's Core slot when the caller provides nothing else: the real Core, with the world's facts. */
export const defaultCore: CoreSlot = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const host = yield* CoreHost;
  // Core run by a host off Cloudflare (host.ts): no Worker, only the secrets the world's handle and sites read.
  if (Option.isSome(host)) {
    yield* Alchemy.Random(OPERATOR_TOKEN_ID, { bytes: 24 });
    yield* Alchemy.Random(SITE_KEY_ID, { bytes: 15 });
    yield* Alchemy.Random(SITE_SECRET_ID, { bytes: 24 });
    return { url: yield* host.value.urlOf(stage) };
  }
  const settings = yield* worldSettings;
  const database = yield* WorldDatabase;
  // The hub's door, whose `/<token>/rpc` is the world's chain: bound by reference to the hub's own stage.
  const door = yield* Cloudflare.Worker.ref("Door", { stack: HUB_STACK, stage: settings.hub.stage });
  // The world's token on the hub (src/things/cluster/client.ts), handed in by the create.
  const doorToken = settings.doorToken;
  const minted = yield* Alchemy.Random(OPERATOR_TOKEN_ID, { bytes: 24 });
  // The owner operator's own token when the platform made the world (decisions.md, 36); otherwise the world's own.
  const operatorToken = Option.getOrElse(
    Option.map(settings.operatorToken, (token): unknown => token),
    () => minted.text,
  );
  const siteKey = yield* Alchemy.Random(SITE_KEY_ID, { bytes: 15 });
  const siteSecret = yield* Alchemy.Random(SITE_SECRET_ID, { bytes: 24 });
  const site = Option.match(settings.bench, {
    onNone: () => ({}),
    onSome: (bench) => ({
      [CORE_ENV.siteDoor]: bench.door,
      [CORE_ENV.siteToken]: bench.token,
      [CORE_ENV.siteKey]: siteKey.text,
      [CORE_ENV.siteSecret]: siteSecret.text,
    }),
  });
  const env = {
    [CORE_ENV.world]: nameOf(stage),
    [CORE_ENV.owner]: settings.owner,
    [CORE_ENV.doorToken]: doorToken,
    [CORE_ENV.platformToken]: operatorToken,
    [CORE_ENV.chain]: door,
    [CORE_ENV.chainToken]: doorToken,
    ...site,
  };
  // The world's copy of Core's bundle when the deploy made one (bundle.ts); otherwise Alchemy builds Core here.
  const prebuilt = yield* PrebuiltCore;
  const core = yield* CoreWorker.pipe(Effect.provideService(CoreDeployment, Option.some({ database, env, prebuilt })));
  return { url: core.url };
});

/** The `.sql` files applied to a world's database when it is created, unless the caller names its own: Core's. */
export const CORE_MIGRATIONS = fileURLToPath(migrations.href);

/** What fills a world's Core slot. A caller with a Core of its own provides it here. */
export const Core = Context.Reference<CoreSlot>("@capxul/world/parts/api/Api/Core", {
  defaultValue: () => defaultCore,
});
