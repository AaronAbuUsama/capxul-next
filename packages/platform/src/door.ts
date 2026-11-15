// The platform package's door: what other packages may import. packages/world mints a world's site token here when
// it creates a world on the shared platform (roadmap step 2.3), and reads where the platform's door and sites answer.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import { CLAIM_PROP } from "./collector/caller.ts";
import { COLLECTOR, STACK } from "./names.ts";
import { outputsIn, recordedOutputs, secretIn, secretOf, type StateStore } from "./state.ts";

export { Claims, cryptoLayer, fingerprint, mint } from "./token.ts";
export { COLLECTOR, namesOf, STACK, STAGING } from "./names.ts";
export { CLAIM_PROP } from "./collector/caller.ts";
export { CollectorClaims, mintClaim } from "./collector/claims.ts";
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

/**
 * A platform stage's collector key, from a state store the caller holds open: what signs a claim (`mintClaim`), for a
 * world's Core's binding or an operator's public calls. Dies when the stage has no collector yet.
 */
export const collectorKeyIn = Effect.fn("platform.collectorKeyIn")(function* (state: StateStore, stage: string) {
  const outputs: unknown = yield* state.getOutput({ stack: STACK, stage });
  const keyId = Predicate.hasProperty(outputs, "collectorKeyId") ? outputs.collectorKeyId : undefined;
  if (!Predicate.isString(keyId)) return yield* Effect.die(`${STACK}/${stage} has no collector`);
  return yield* secretIn(state, STACK, stage, keyId, "text");
});

/**
 * A world's Core's service binding to a platform stage's collector, carrying the world's claim in its props
 * (`ctx.props.claim` on the collector's side, which only the deployer sets). For packages/world, when it deploys Core:
 * `env: { COLLECTOR: yield* collectorBinding(stage, claim) }`. The claim is signed, not secret: it is only accepted
 * from a binding.
 */
export const collectorBinding = (stage: string, claim: Redacted.Redacted) =>
  Effect.map(Cloudflare.Worker.ref(COLLECTOR, { stack: STACK, stage }), (worker) =>
    Cloudflare.WorkerEntrypoint(worker, { props: { [CLAIM_PROP]: Redacted.value(claim) } }),
  );
