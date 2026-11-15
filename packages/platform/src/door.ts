// The platform package's door: what other packages may import. packages/world mints a world's site token here when
// it creates a world on the shared platform (roadmap step 2.3), and reads where the platform's door and sites answer.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import { TOKEN_PROP } from "./collector/caller.ts";
import { mintCollectorToken } from "./collector/tokens.ts";
import { COLLECTOR, STACK } from "./names.ts";
import { outputsIn, recordedOutputs, secretIn, secretOf, withState, type StateStore } from "./state.ts";
import { cryptoLayer } from "./token.ts";

export { Claims, cryptoLayer, fingerprint, mint } from "./token.ts";
export { COLLECTOR, namesOf, STACK, STAGING } from "./names.ts";
export { TOKEN_PROP } from "./collector/caller.ts";
export { CollectorGrant, mintCollectorToken } from "./collector/tokens.ts";
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
 * A platform stage's collector key, from a state store the caller holds open: what signs a token (`mintCollectorToken`), for a
 * world's Core's binding or an operator's public calls. Dies when the stage has no collector yet.
 */
export const collectorKeyIn = Effect.fn("sites.collectorKeyIn")(function* (state: StateStore, stage: string) {
  const outputs: unknown = yield* state.getOutput({ stack: STACK, stage });
  const keyId = Predicate.hasProperty(outputs, "collectorKeyId") ? outputs.collectorKeyId : undefined;
  if (!Predicate.isString(keyId)) return yield* Effect.die(`${STACK}/${stage} has no collector`);
  return yield* secretIn(state, STACK, stage, keyId, "text");
});

/**
 * A platform stage's collector as a public caller reaches it: its workers.dev URL and a token for `operator`, signed
 * under its key and good until `expires` (Unix seconds), naming no world (an operator's own work, as the runner's run
 * is). None when the stage has no collector yet.
 */
export const publicCollector = Effect.fn("sites.publicCollector")(function* (
  stage: string,
  operator: string,
  expires: number,
) {
  return yield* withState(ENTRYPOINT, (state) =>
    Effect.gen(function* () {
      const outputs: unknown = yield* state.getOutput({ stack: STACK, stage });
      const url = Predicate.hasProperty(outputs, "collectorUrl") ? outputs.collectorUrl : undefined;
      if (!Predicate.isString(url) || url === "") return Option.none();
      const key = yield* collectorKeyIn(state, stage);
      const token = yield* mintCollectorToken(key, {
        operator,
        world: Option.none(),
        grade: Option.none(),
        expires,
      }).pipe(
        // oxlint-disable-next-line effecttsgo/strict-effect-provide -- WebCrypto's HMAC is the platform's own layer, used for this one signature
        Effect.provide(cryptoLayer),
      );
      return Option.some({ url, token });
    }),
  );
});

/**
 * A world's Core's service binding to a platform stage's collector, carrying the world's token in its props
 * (`ctx.props.token` on the collector's side, which only the deployer sets). For packages/world, when it deploys Core:
 * `env: { COLLECTOR: yield* collectorBinding(stage, token) }`. The token is signed, not secret: it is only accepted
 * from a binding.
 */
export const collectorBinding = (stage: string, token: Redacted.Redacted) =>
  Effect.map(Cloudflare.Worker.ref(COLLECTOR, { stack: STACK, stage }), (worker) =>
    Cloudflare.WorkerEntrypoint(worker, { props: { [TOKEN_PROP]: Redacted.value(token) } }),
  );

export {
  exportFromConfig,
  exportLayer,
  sitesTelemetry,
  RunAttributes,
  type ExportLayer,
  type ExportOptions,
  type Producer,
  type Target,
} from "./telemetry.ts";
