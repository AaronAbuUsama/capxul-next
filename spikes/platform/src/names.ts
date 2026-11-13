// Every name the platform gives a resource, derived from the stage. All Docker objects start `cx-platform-<stage>`, so
// they cannot collide with another agent's on a shared engine; every DNS name is `<label>.<PLATFORM_DOMAIN>`, one
// level under the test domain Aaron set aside (`worlds.abuusama.dev`).
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const STACK = "CapxulPlatformRehearsal";
export const WORLD_STACK = "CapxulWorldRehearsal";
export const STAGE_PREFIX = "pr-";

export class StageRefused extends Schema.TaggedError<StageRefused>()("StageRefused", {
  stage: Schema.String,
  rule: Schema.String,
}) {}

export const names = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  if (!stage.startsWith(STAGE_PREFIX) || !/^[a-z0-9-]{4,24}$/.test(stage)) {
    return yield* Effect.die(new StageRefused({ stage, rule: `starts "${STAGE_PREFIX}", 4 to 24 of a-z, 0-9 and -` }));
  }
  const domain = yield* Config.String("PLATFORM_DOMAIN").pipe(Config.withDefault("worlds.abuusama.dev"));
  const prefix = `cx-platform-${stage}`;
  return {
    stage,
    domain,
    prefix,
    container: (role: string) => `${prefix}-${role}`,
    hostname: (label: string) => `${label}.${domain}`,
  };
});
