// The containers spike's stack. Every resource is created under the stack name "CapxulSpikeContainers" and a stage
// whose name starts "ct-", so nothing here can collide with what else is in the Cloudflare account or the Neon
// organization, or with another agent's stack.
//
// Stage "ct-platform" owns what worlds share (the Neon project). Every other stage is one world: its door (a
// Worker), its chain (a Durable Object that owns an anvil container), the R2 bucket the chain's state is saved to
// while its container is stopped, its indexer (a Durable Object that owns a Ponder container) and its own branch of
// the Neon project, which is the database Ponder writes to.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Neon from "@alchemy.run/neon";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import Door from "./src/Door.ts";
import { PLATFORM, WorldDb } from "./src/world/Db.ts";

export default Alchemy.Stack(
  "CapxulSpikeContainers",
  { providers: Layer.mergeAll(Cloudflare.providers(), Neon.providers()), state: Alchemy.localState() },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    if (stage === PLATFORM) {
      const orgId = yield* Config.String("NEON_ORG_ID");
      const project = yield* Neon.Project("worlds-db", { region: "aws-eu-west-2", orgId, historyRetentionSeconds: 21600 });
      return { projectId: project.projectId };
    }
    // The branch's connection string is not an output: alchemy prints outputs in plain text, secrets included.
    const db = yield* WorldDb;
    const door = yield* Door;
    return { world: stage, url: door.url, branch: db.branchId };
  }),
);
