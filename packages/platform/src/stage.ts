// The names of the stage being deployed (src/names.ts derives them), read from Alchemy's stack and PLATFORM_DOMAIN.
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { isStage, namesOf, REHEARSAL_PREFIX, STAGING } from "./names.ts";

/** The names of the stage being deployed. A stage the platform does not accept stops the deploy before anything. */
export const names = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  if (!isStage(stage)) {
    // A stage name the platform does not accept is a mistake in how the command was asked: the deploy stops here.
    return yield* Effect.die(
      `stage "${stage}" refused: "${STAGING}", or "${REHEARSAL_PREFIX}" and 1 to 21 of a-z, 0-9 and -`,
    );
  }
  const domain = yield* Config.String("PLATFORM_DOMAIN").pipe(Config.withDefault("worlds.abuusama.dev"));
  return namesOf(stage, domain);
});
