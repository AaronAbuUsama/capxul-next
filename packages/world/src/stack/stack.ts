// The stack. Stage "platform" owns what worlds share (the Neon project and the registry of world names). Every
// other stage is one world: its database (a branch of that project and a Hyperdrive configuration in front of it),
// its chain (a Durable Object that owns an anvil container, and the bucket its state is saved to), its index (a
// Durable Object that owns a Ponder container), its door (the Worker in front of both) and its Core.
//
// Core is the one part the caller supplies: any Effect that yields a Worker. It is deployed and destroyed with the
// world like every other resource, and may bind the world's database (`WorldDatabase`).
//
// The stack's outputs are printed and stored in plain text by Alchemy, so no secret is ever an output: neither the
// database's connection string nor the door's token. Both are read from the resources' own state when needed.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Neon from "@alchemy.run/neon";
import * as Alchemy from "alchemy";
import type { ProviderServices, StackServices } from "alchemy/Stack";
import type { ConfigError } from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Registry, WorldBranch, WorldDatabase, WorldsProject } from "../database/Db.ts";
import Door from "../door/Door.ts";
import { PLATFORM, STACK } from "./names.ts";
import { worldSettings } from "./settings.ts";

const providers = Layer.mergeAll(Cloudflare.providers(), Neon.providers(), Alchemy.RandomProvider());

/** What fills the Core slot: anything that deploys a Worker and says where it answers. */
export type CoreSlot = Effect.Effect<{ readonly url: unknown }, ConfigError, StackServices | ProviderServices>;

/** The stack with `core` in its Core slot. Destroy, sweep and state reads never run `core`. */
export const worldStack = (core: CoreSlot) =>
  Alchemy.Stack(
    STACK,
    { providers, state: Cloudflare.state() },
    Effect.gen(function* () {
      const { stage } = yield* Alchemy.Stack;
      if (stage === PLATFORM) {
        const project = yield* WorldsProject;
        const registry = yield* Registry;
        return { projectId: project.projectId, registryBranch: registry.branchId };
      }
      const settings = yield* worldSettings;
      const branch = yield* WorldBranch;
      yield* WorldDatabase;
      const door = yield* Door;
      const served = yield* core;
      return {
        world: stage,
        owner: settings.owner,
        expiresAt: settings.expiresAt,
        forkedFrom: Option.getOrElse(settings.forkedFrom, () => "nothing"),
        coreUrl: served.url,
        doorUrl: door.url,
        branch: branch.branchId,
      };
    }),
  );
