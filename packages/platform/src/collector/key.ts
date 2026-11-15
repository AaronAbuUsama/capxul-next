// The collector's signing key: an Alchemy.Random of the platform stage, kept in the shared state and bound to the
// collector as a secret, never an output. Whoever can read the platform's state can sign a token (grant.ts), as with
// the site door's key (src/bench.ts). A new generation (SITES_COLLECTOR_KEY_GENERATION) is a new key: every token
// signed under the old one stops working once the collector is deployed with it.
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

/** The logical id of the collector key in the platform's stack, recorded as the output `collectorKeyId`. */
export const collectorKeyId = Effect.map(
  Config.Int("SITES_COLLECTOR_KEY_GENERATION").pipe(Config.withDefault(1)),
  (generation) => `CollectorKey-g${generation}`,
);
