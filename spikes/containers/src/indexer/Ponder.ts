// The indexer's container: the Ponder app in ponder/, built from its Dockerfile. Its database is the world's Neon
// branch, given to it as an environment variable; where the chain is, it is told when it is started.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { WorldDb } from "../world/Db.ts";

export const PONDER_PORT = 42069;

export class Ponder extends Cloudflare.Container<Ponder>()(
  "Ponder",
  Effect.gen(function* () {
    const db = yield* WorldDb;
    // "basic" is 1/4 vCPU and 1 GiB. CT_PONDER_INSTANCE=lite (1/16 vCPU, 256 MiB) is there to try the smallest size.
    const instanceType = yield* Config.Literals(["lite", "basic", "standard-1"], "CT_PONDER_INSTANCE").pipe(
      Config.withDefault("basic" as const),
    );
    return {
      context: `${import.meta.dirname}/../../ponder`,
      publish: { repository: "capxulspikecontainers-ponder" },
      instanceType,
      maxInstances: 2,
      env: { DATABASE_URL: db.connectionUri },
      observability: { logs: { enabled: true } },
    };
  }),
) {}
