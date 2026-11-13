// The one place that decides what runs in a world's Core slot: the real Core (packages/core), deployed with the
// world and handed the world's own facts (CoreDeployment), never its own stage's:
//
//   its database      the world's branch, through the world's Hyperdrive configuration (WorldDatabase)
//   its world door    the world's token (the door's, `door-token`) and the owner operator's token (`operator-token`)
//   its chain         a service binding to the world's door, whose `/<token>/rpc` is the chain; Core answers only
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
import { WorldDatabase } from "../database/Db.ts";
import Door, { DOOR_TOKEN_ID } from "../door/Door.ts";
import { nameOf } from "../stack/names.ts";
import { worldSettings } from "../stack/settings.ts";
import type { CoreSlot } from "../stack/stack.ts";

/** Logical ids of the Core slot's own secrets, as the state store keys them. */
export const OPERATOR_TOKEN_ID = "operator-token";
export const SITE_KEY_ID = "site-key";
export const SITE_SECRET_ID = "site-secret";

/** What fills a world's Core slot when the caller provides nothing else: the real Core, with the world's facts. */
export const defaultCore: CoreSlot = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const settings = yield* worldSettings;
  const database = yield* WorldDatabase;
  const door = yield* Door;
  // The door's own token: the same resource the door made, yielded again by its logical id.
  const doorToken = yield* Alchemy.Random(DOOR_TOKEN_ID, { bytes: 16 });
  const operatorToken = yield* Alchemy.Random(OPERATOR_TOKEN_ID, { bytes: 24 });
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
    [CORE_ENV.doorToken]: doorToken.text,
    [CORE_ENV.platformToken]: operatorToken.text,
    [CORE_ENV.chain]: door,
    [CORE_ENV.chainToken]: doorToken.text,
    ...site,
  };
  const core = yield* CoreWorker.pipe(Effect.provideService(CoreDeployment, Option.some({ database, env })));
  return { url: core.url };
});

/** The `.sql` files applied to a world's database when it is created, unless the caller names its own: Core's. */
export const CORE_MIGRATIONS = fileURLToPath(migrations.href);

/** What fills a world's Core slot. A caller with a Core of its own provides it here. */
export const Core = Context.Reference<CoreSlot>("@capxul/world/core/Core", { defaultValue: () => defaultCore });
