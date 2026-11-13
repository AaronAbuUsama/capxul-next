// The platform stage: what every world shares. It is brought up once and taken down when no world is left.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { deployStage, destroyStage, forgetStage, recordedStages } from "../stack/engine.ts";
import { isWorldStage, PLATFORM } from "../stack/names.ts";
import { prepareRegistry, registry } from "./claim.ts";
import { removeLeftoverImages } from "./sweep.ts";

export class WorldsStillExist extends Schema.TaggedError<WorldsStillExist>()("WorldsStillExist", {
  worlds: Schema.Array(Schema.String),
  message: Schema.String,
}) {}

/** Deploys the Neon project and the registry of world names. Safe to run again: a second run changes nothing. */
export const platformUp = Effect.gen(function* () {
  const output = yield* deployStage(PLATFORM, Option.none());
  yield* prepareRegistry(yield* registry);
  return output;
}).pipe(Effect.withSpan("world.platform.up"));

/**
 * Destroys the platform and removes the image repositories every world shared, which `alchemy destroy` leaves
 * behind. Refused while a world exists: its branch lives in the platform's project.
 */
export const platformDown = Effect.gen(function* () {
  const worlds = (yield* recordedStages).map(({ stage }) => stage).filter(isWorldStage);
  if (worlds.length > 0) {
    return yield* new WorldsStillExist({ worlds, message: `destroy or sweep these worlds first: ${worlds.join(", ")}` });
  }
  const removed = yield* destroyStage(PLATFORM);
  yield* forgetStage(PLATFORM);
  return { resourcesDestroyed: removed, imagesRemoved: yield* removeLeftoverImages([], false) };
}).pipe(Effect.withSpan("world.platform.down"));
