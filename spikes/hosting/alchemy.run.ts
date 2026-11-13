// The hosting spike's stack. Every resource is created under the stack name "CapxulHostingSpike" and a named stage,
// so nothing here can collide with what already exists in the Cloudflare account or the Neon organization.
//
// Stage "platform" owns what worlds share (the Neon project). Every other stage is one world: it borrows the
// project and gets its own copy-on-write branch (forked from another world when WORLD_PARENT names one), which holds that world's one database (app data and the index).
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Neon from "@alchemy.run/neon";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export default Alchemy.Stack(
  "CapxulHostingSpike",
  { providers: Layer.mergeAll(Cloudflare.providers(), Neon.providers()), state: Alchemy.localState() },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const orgId = yield* Config.String("NEON_ORG_ID");
    if (stage === "platform") {
      const project = yield* Neon.Project("worlds-db", { region: "aws-eu-west-2", orgId, historyRetentionSeconds: 21600 });
      return { projectId: project.projectId };
    }
    const project = yield* Neon.Project.ref("worlds-db", { stage: "platform" });
    // A world may start as a copy of another world: its branch forks the parent world's branch (copy-on-write).
    const parent = yield* Config.String("WORLD_PARENT").pipe(Config.withDefault(""));
    const parentBranch = parent ? yield* Neon.Branch.ref("world", { stage: parent }) : undefined;
    const world = yield* Neon.Branch("world", parentBranch ? { project, parentBranch } : { project });
    return { world: stage, branchId: world.branchId, forkedFrom: parent || "empty" };
  }),
);
