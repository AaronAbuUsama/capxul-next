// The collector's part of a platform stage: its Worker (worker.ts). Public callers reach it at its workers.dev URL,
// over HTTPS, which needs no route, record or certificate on the zone; a name under the platform's domain can come
// later, with CI's token allowed to write Worker routes. A world's Core reaches it by service binding.
import * as Effect from "effect/Effect";
import { names } from "../stage.ts";
import { collectorKeyId } from "./key.ts";
import Collector from "./worker.ts";

export const CollectorPart = Effect.gen(function* () {
  const n = yield* names;
  const worker = yield* Collector;
  return { worker, script: n.collector, url: worker.url, keyId: yield* collectorKeyId };
});
