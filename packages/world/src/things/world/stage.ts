// The stack. Stage "platform" owns what worlds share (the Neon project and the registry of world names). Every
// other stage is one world: its database (a branch of that project and a Hyperdrive configuration in front of it)
// and its Core. Its chain, index and bundler are not here: they are Durable Objects of the fleet hub, named by the
// world's stage (src/things/cluster), so a world's deploy makes no container application.
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
import { State } from "alchemy/State/State";
import type { ConfigError } from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Registry, WorldDatabase, WorldsProject } from "../../parts/database/Database.ts";
import { PLATFORM, STACK } from "../../stack/names.ts";
import { worldSettings } from "../../stack/settings.ts";

// Each provider takes its HTTP client from the stack's own services, as Alchemy's stacks are written; none is meant
// to feed another, so they are merged side by side.
// @effect-diagnostics-next-line layerMergeAllWithDependencies:off
const providers = Layer.mergeAll(Cloudflare.providers(), Neon.providers(), Alchemy.RandomProvider());

/** What fills the Core slot: anything that deploys a Worker and says where it answers. */
export type CoreSlot = Effect.Effect<{ readonly url: unknown }, ConfigError, StackServices | ProviderServices>;

/** Where a stack keeps its state: the account's shared store, opened anew, or one this process already opened. */
export type StateLayer = Layer.Layer<State, never, StackServices>;

/** The shared store this process already opened, as a stack's state: opening it again costs about 3 s. */
export const openedState = (store: Effect.Success<State["Service"]>): StateLayer =>
  Layer.succeed(State, Effect.succeed(store));

/** The stack with `core` in its Core slot. Destroy, sweep and state reads never run `core`. */
export const worldStack = (core: CoreSlot, state: StateLayer = Cloudflare.state()) =>
  Alchemy.Stack(
    STACK,
    { providers, state },
    Effect.gen(function* () {
      const { stage } = yield* Alchemy.Stack;
      if (stage === PLATFORM) {
        const project = yield* WorldsProject;
        const registry = yield* Registry;
        return { projectId: project.projectId, registryBranch: registry.branchId };
      }
      const settings = yield* worldSettings;
      yield* WorldDatabase;
      const served = yield* core;
      return {
        world: stage,
        owner: settings.owner,
        expiresAt: settings.expiresAt,
        forkedFrom: Option.getOrElse(settings.forkedFrom, () => "nothing"),
        coreUrl: served.url,
        doorUrl: settings.hub.doorUrl,
        hub: settings.hub.stage,
        registeredUntil: settings.expiresAt,
        branch: settings.branch.id,
        bench: Option.match(settings.bench, { onNone: () => "none", onSome: (bench) => bench.stage }),
      };
    }),
  );
