// A world's one database: its own copy-on-write branch of the Neon project that stage "ct-platform" owns.
// Every world names its owner and the moment it expires; Neon deletes the branch itself at that moment.
import * as Neon from "@alchemy.run/neon";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

export const PLATFORM = "ct-platform";

export const WorldDb = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const owner = yield* Config.String("WORLD_OWNER");
  const expiresAt = yield* Config.String("WORLD_EXPIRES_AT");
  const project = yield* Neon.Project.ref("worlds-db", { stage: PLATFORM });
  return yield* Neon.Branch("world", { project, name: `w-${owner}-${stage}`, expiresAt });
});
