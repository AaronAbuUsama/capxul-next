// The chain's container: anvil, built from images/anvil/Dockerfile with the repository's seeded state baked in.
// The class is all a Durable Object needs to bind it; nothing here runs inside the container.
import * as Cloudflare from "@alchemy.run/cloudflare";

export const CHAIN_ID = 84532;
export const RPC_PORT = 8545;

/** How anvil starts when its state comes from the last stop instead of from the seed in the image. */
export const restoreEntrypoint = [
  "anvil", "--host", "0.0.0.0", "--port", String(RPC_PORT), "--chain-id", String(CHAIN_ID), "--no-request-size-limit",
];

export class Anvil extends Cloudflare.Container<Anvil>()("Anvil", {
  context: `${import.meta.dirname}/../../../../packages/contracts/state`,
  dockerfile: `${import.meta.dirname}/../../images/anvil/Dockerfile`,
  // One image repository for every world: a world whose image is already published deploys without Docker, and a
  // destroyed world leaves no image of its own behind (alchemy's destroy does not delete image repositories).
  publish: { repository: "capxulspikecontainers-anvil" },
  instanceType: "lite",
  maxInstances: 2,
  observability: { logs: { enabled: true } },
}) {}
