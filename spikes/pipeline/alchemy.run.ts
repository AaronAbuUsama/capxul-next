// The pipeline spike's stack. Every resource is created under the stack name "CapxulSpikePipeline" and a named
// stage, so nothing here can collide with what else lives in the Cloudflare account or the Neon organization.
//
// Stage "platform" owns what worlds share (the Neon project). Every other stage is one world: a Neon branch
// (its one database), a Hyperdrive configuration in front of it, and the Core Worker that serves the contract.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Neon from "@alchemy.run/neon";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import Core from "./core/worker.ts";
import { PLATFORM, WorldBranch, WorldDatabase, WorldsProject } from "./core/world.ts";

export default Alchemy.Stack(
  "CapxulSpikePipeline",
  { providers: Layer.mergeAll(Cloudflare.providers(), Neon.providers()), state: Alchemy.localState() },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    if (stage === PLATFORM) {
      const project = yield* WorldsProject;
      return { projectId: project.projectId };
    }
    const branch = yield* WorldBranch;
    yield* WorldDatabase;
    const core = yield* Core;
    return { world: stage, url: core.url.as<string>(), database: branch.connectionUri, expiresAt: branch.expiresAt };
  }),
);
