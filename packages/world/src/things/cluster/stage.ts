// The fleet hub's stack (roadmap step 1.15). One stage is one hub: its door Worker, the three Durable Object classes
// that own every world's containers (Chain, Indexer, Bundler), ONE container application of each kind (anvil, Ponder
// next to Neon in western Europe, alto), the bucket the chains are saved to, and its admin token. It is deployed once
// (`./run.sh hub up`); a world on it is then only Durable Object names and a Neon branch (src/things/world/stage.ts), so a
// world's create deploys no container application.
//
// A hub has an owner and an expiry, as a world does, recorded before its deploy. No world on it may outlive it
// (src/things/cluster/client.ts), and the sweeper destroys an expired hub once no world names it.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import Door from "../../parts/gateway/Gateway.ts";
import { WorldSettingsMissing } from "../../common/failures.ts";
import { type StateLayer } from "../world/stage.ts";
import { HUB_CAPACITY, HUB_STACK } from "./values.ts";

/** What the caller decides about a hub: whose it is and until when. */
export interface HubSettings {
  readonly owner: string;
  /** RFC 3339. The sweeper destroys the hub after this, once no world names it. */
  readonly expiresAt: string;
}

export const HubSettings = Context.Reference<Option.Option<HubSettings>>("capxul/world/HubSettings", {
  defaultValue: () => Option.none(),
});

/** The hub's settings as the stack sees them; inside the running Worker they are neither known nor needed. */
const hubSettings = Effect.gen(function* () {
  if ((yield* Alchemy.ALCHEMY_PHASE) === "runtime") return { owner: "", expiresAt: "" };
  const provided = yield* HubSettings;
  if (Option.isSome(provided)) return provided.value;
  return yield* Effect.die(
    WorldSettingsMissing.make({ message: "a hub is deployed through `hub up`, which provides its owner and expiry" }),
  );
});

// Each provider takes its HTTP client from the stack's own services; none feeds another.
const providers = Layer.mergeAll(Cloudflare.providers(), Alchemy.RandomProvider());

export const hubStack = (state: StateLayer) =>
  Alchemy.Stack(
    HUB_STACK,
    { providers, state },
    Effect.gen(function* () {
      const { stage } = yield* Alchemy.Stack;
      const settings = yield* hubSettings;
      const door = yield* Door;
      // How many worlds the hub admits, recorded so that admission reads what the hub was deployed with.
      return {
        hub: stage,
        owner: settings.owner,
        expiresAt: settings.expiresAt,
        doorUrl: door.url,
        capacity: HUB_CAPACITY,
      };
    }),
  );
