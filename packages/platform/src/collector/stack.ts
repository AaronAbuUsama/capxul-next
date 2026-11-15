// The collector's part of a platform stage: its Worker (worker.ts), the zone route that sends its public name to it,
// and a proxied record that makes the name resolve to Cloudflare's edge. The record's address, 100::, is a placeholder
// that is never reached: the route answers first. No certificate is made: the name is two levels under the zone, and
// callers reach it over HTTP, as they reach the site door.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { RECORD_COMMENT } from "../edge.ts";
import { names } from "../stage.ts";
import { collectorKeyId } from "./key.ts";
import Collector from "./worker.ts";

export const CollectorPart = Effect.gen(function* () {
  const n = yield* names;
  const zoneId = yield* Config.String("PLATFORM_ZONE_ID");
  const worker = yield* Collector;
  const record = yield* Cloudflare.DNS.Record("CollectorRecord", {
    zoneId,
    name: n.collectorHost,
    type: "AAAA",
    content: "100::",
    proxied: true,
    comment: RECORD_COMMENT,
  });
  return {
    worker,
    record,
    script: n.collector,
    url: `http://${n.collectorHost}`,
    keyId: yield* collectorKeyId,
  };
});
