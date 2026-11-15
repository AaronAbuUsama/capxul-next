// The platform package's door: what other packages may import. packages/world mints a world's site token here when
// it creates a world on the shared platform (roadmap step 2.3), and reads where the platform's door and sites answer.
import * as Effect from "effect/Effect";
import { STACK } from "./names.ts";
import { outputsIn, recordedOutputs, secretIn, secretOf, type StateStore } from "./state.ts";

export { Claims, cryptoLayer, fingerprint, mint } from "./token.ts";
export { namesOf, STACK, STAGING } from "./names.ts";
export { PlatformOutputs, type StateStore } from "./state.ts";

/** The platform's stack file; the state store is opened through it. */
const ENTRYPOINT = `${import.meta.dirname}/../alchemy.run.ts`;

/** A platform stage's recorded outputs: its domain, its door's name, its edge and its containers. */
export const platformOutputs = (stage: string) => recordedOutputs(ENTRYPOINT, STACK, stage);

/** A platform stage's door key, from the shared state, as a secret. Whoever holds it can mint any world's token. */
export const doorKey = Effect.fn("platform.doorKey")(function* (stage: string) {
  const outputs = yield* platformOutputs(stage);
  return yield* secretOf(ENTRYPOINT, STACK, stage, outputs.doorKeyId, "text");
});

/** A platform stage's recorded outputs, from a state store the caller already holds open (the same account's). */
export const platformOutputsIn = (state: StateStore, stage: string) => outputsIn(state, STACK, stage);

/** A platform stage's door key, from a state store the caller already holds open. */
export const doorKeyIn = Effect.fn("platform.doorKeyIn")(function* (state: StateStore, stage: string) {
  const outputs = yield* platformOutputsIn(state, stage);
  return yield* secretIn(state, STACK, stage, outputs.doorKeyId, "text");
});
export {
  exportFromConfig,
  exportLayer,
  platformTelemetry,
  PRODUCERS,
  RunAttributes,
  type ExportLayer,
  type ExportOptions,
  type Producer,
} from "./telemetry.ts";
export { RUN_ATTRIBUTES } from "./collector/envelope.ts";
