// The chain's container: anvil, built from images/anvil/Dockerfile with the repository's seeded state baked in.
// The class is all a Durable Object needs to bind it; nothing here runs inside the container.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import { HUB_CAPACITY, REGIONS } from "../hub/names.ts";
import { imageSource } from "../stack/images.ts";

export const CHAIN_ID = 84532;
export const RPC_PORT = 8545;

/** How anvil starts when its state comes from a save instead of from the seed in the image. */
export const restoreEntrypoint = [
  "anvil",
  "--host",
  "0.0.0.0",
  "--port",
  String(RPC_PORT),
  "--chain-id",
  String(CHAIN_ID),
  "--no-request-size-limit",
];

export class Anvil extends Cloudflare.Container<Anvil>()(
  "Anvil",
  Effect.gen(function* () {
    return {
      // The image every world shares, pinned by digest while its inputs are unchanged (src/stack/images.ts).
      ...(yield* imageSource("chain")),
      instanceType: "lite" as const,
      maxInstances: HUB_CAPACITY,
      // With every world's chain object, its index and the worlds' database (src/hub/names.ts).
      constraints: { regions: REGIONS },
      observability: { logs: { enabled: true } },
    };
  }),
) {}
