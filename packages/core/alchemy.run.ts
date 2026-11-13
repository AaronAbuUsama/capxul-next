// The stack `CapxulCore`: one stage is one Core with a database of its own, created and destroyed as a unit. The
// runner deploys a stage per run (packages/runner). Never run `alchemy nuke`.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Neon from "@alchemy.run/neon";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CoreProject } from "./src/stack/database.ts";
import Core from "./src/worker.ts";

export default Alchemy.Stack(
  "CapxulCore",
  { providers: Neon.providers().pipe(Layer.provideMerge(Cloudflare.providers())), state: Alchemy.localState() },
  Effect.gen(function* () {
    const project = yield* CoreProject;
    const core = yield* Core;
    return { url: core.url.as<string>(), database: project.connectionUri, projectId: project.projectId };
  }),
);
