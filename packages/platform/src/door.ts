// The platform package's door: what other packages may import. packages/world mints a world's site token here when
// it creates a world on the shared platform (roadmap step 2.3), and reads where the platform's door and sites answer.
import * as Effect from "effect/Effect";
import { STACK } from "./names.ts";
import { recordedOutputs, secretOf } from "./state.ts";

export { Claims, cryptoLayer, fingerprint, mint } from "./token.ts";
export { namesOf, STACK, STAGING } from "./names.ts";
export { PlatformOutputs } from "./state.ts";

/** The platform's stack file, relative to packages/platform; the state store is opened through it. */
const ENTRYPOINT = "alchemy.run.ts";

/** A platform stage's recorded outputs: its domain, its door's name, its edge and its containers. */
export const platformOutputs = (stage: string) => recordedOutputs(ENTRYPOINT, STACK, stage);

/** A platform stage's door key, from the shared state, as a secret. Whoever holds it can mint any world's token. */
export const doorKey = Effect.fn("platform.doorKey")(function* (stage: string) {
  const outputs = yield* platformOutputs(stage);
  return yield* secretOf(ENTRYPOINT, STACK, stage, outputs.doorKeyId, "text");
});
