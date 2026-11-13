// The bundler's container: Pimlico's alto 0.0.21, built from images/alto. What it is told (the chain's address, the
// EntryPoint, its keys) is given as ALTO_* variables when its Durable Object starts it.
import * as Cloudflare from "@alchemy.run/cloudflare";

export const ALTO_PORT = 4337;

export class Alto extends Cloudflare.Container<Alto>()("Alto", {
  context: `${import.meta.dirname}/../../images/alto`,
  // One image repository for every world, as the containers spike does for anvil.
  publish: { repository: "capxulspikebundler-alto" },
  // 1/4 vCPU and 1 GiB. alto is a Node process with 237 MB of dependencies; lite (256 MiB) was not tried.
  instanceType: "basic",
  maxInstances: 2,
  observability: { logs: { enabled: true } },
}) {}
