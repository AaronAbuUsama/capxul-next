// The collector alone, for rehearsing it on a `pr-<x>` stage without the bench (the bench needs a Docker engine and
// its images; the collector needs neither): `bin/run.sh deploy -c collector.run.ts --stage pr-<x> --yes`, then
// `destroy` the same way. The shared platform deploys the collector as part of alchemy.run.ts; nothing deploys this
// stack in CI.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import { CollectorPart } from "./src/collector/stack.ts";

export default Alchemy.Stack(
  "CapxulCollectorRehearsal",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const collector = yield* CollectorPart;
    return { collectorUrl: collector.url, collectorScript: collector.script, collectorKeyId: collector.keyId };
  }),
);
