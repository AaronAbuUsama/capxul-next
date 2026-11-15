// The platform stage: what every world shares. It is brought up once and taken down when no world is left.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { WorldsStillExist } from "../../common/failures.ts";
import { HUB_STACK } from "../cluster/values.ts";
import { deployStage, destroyStage, forgetStage, recordedStages, recordedStagesOf } from "../../stack/engine.ts";
import { isWorldStage, PLATFORM } from "../../stack/names.ts";
import { prepareRegistry, registry } from "./reserve.ts";
import { removeLeftoverImages } from "../world/sweep.ts";

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
  const worlds = Arr.filter(
    Arr.map(yield* recordedStages, ({ stage }) => stage),
    isWorldStage,
  );
  if (Arr.isReadonlyArrayNonEmpty(worlds)) {
    return yield* WorldsStillExist.make({
      worlds,
      message: `destroy or sweep these worlds first: ${Arr.join(worlds, ", ")}`,
    });
  }
  // The hubs run the images the platform owns: take them down first (`hub down`).
  const hubs = Arr.map(yield* recordedStagesOf(HUB_STACK), ({ stage }) => `hub ${stage}`);
  if (Arr.isReadonlyArrayNonEmpty(hubs))
    return yield* WorldsStillExist.make({
      worlds: hubs,
      message: `take these hubs down first: ${Arr.join(hubs, ", ")}`,
    });
  const removed = yield* destroyStage(PLATFORM);
  yield* forgetStage(PLATFORM);
  const images = yield* removeLeftoverImages([], false);
  return { resourcesDestroyed: removed, imagesRemoved: images.removed, imagesLeft: images.left };
}).pipe(Effect.withSpan("world.platform.down"));
