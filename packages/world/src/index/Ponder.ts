// The index's container on the hub: the real Ponder app of packages/indexer, built from ponder/Dockerfile with the
// repository's packages/ folder as the context. One application serves every world on the hub; which world's database
// and chain a container indexes, it is told when its Durable Object starts it (src/index/Indexer.ts).
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import { HUB_CAPACITY, REGIONS } from "../hub/names.ts";
import { imageSource } from "../stack/images.ts";

export const PONDER_PORT = 42069;

export class Ponder extends Cloudflare.Container<Ponder>()(
  "Ponder",
  Effect.gen(function* () {
    return {
      // The image every world shares, pinned by digest while its inputs are unchanged (src/stack/images.ts).
      ...(yield* imageSource("index")),
      // 1/2 vCPU and 4 GiB: Ponder builds its app for 5 to 7 s on 1/4 vCPU ("basic") before it syncs, and a world's
      // create waits on it (records/hub). It runs only while its world is in use.
      instanceType: "standard-1" as const,
      maxInstances: HUB_CAPACITY,
      // Next to the world's database (Neon's aws-eu-west-2, src/database/Db.ts): Ponder's start is mostly round trips
      // to it (README, Timings).
      constraints: { regions: REGIONS },
      observability: { logs: { enabled: true } },
    };
  }),
) {}
