// The index's container: the real Ponder app of packages/indexer, built from ponder/Dockerfile with the repository's
// packages/ folder as the context. Its database is the world's Neon branch, given to it as an environment variable;
// where the chain is, it is told when it is started.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import { WorldBranch } from "../database/Db.ts";
import { INDEX_IMAGE } from "../stack/names.ts";

export const PONDER_PORT = 42069;

export class Ponder extends Cloudflare.Container<Ponder>()(
  "Ponder",
  Effect.gen(function* () {
    const branch = yield* WorldBranch;
    return {
      context: `${import.meta.dirname}/../../..`,
      dockerfile: `${import.meta.dirname}/../../ponder/Dockerfile`,
      publish: { repository: INDEX_IMAGE },
      // 1/4 vCPU and 1 GiB. The six-contract app also ran on "lite" in the spike's smaller form; this is the size
      // it was proven on here.
      instanceType: "basic" as const,
      maxInstances: 2,
      // Next to the world's database (Neon's aws-eu-west-2, src/database/Db.ts): Ponder's start is mostly round trips
      // to it (README, Timings).
      constraints: { regions: ["WEUR"] },
      env: { DATABASE_URL: branch.connectionUri },
      observability: { logs: { enabled: true } },
    };
  }),
) {}
