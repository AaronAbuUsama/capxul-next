// The bundler's container: Pimlico's alto 0.0.21, built from images/alto. What it is told (the chain's address, the
// EntryPoint, its keys) is given as ALTO_* variables when its Durable Object starts it. The class is all the Durable
// Object needs to bind it; nothing here runs inside the container.
import * as Cloudflare from "@alchemy.run/cloudflare";
import { BUNDLER_IMAGE } from "../stack/names.ts";

export const ALTO_PORT = 4337;

export class Alto extends Cloudflare.Container<Alto>()("Alto", {
  context: `${import.meta.dirname}/../../images/alto`,
  // One image repository for every world, as for the chain and the index: a world whose image is already published
  // deploys without Docker, and a destroyed world leaves no image of its own behind.
  publish: { repository: BUNDLER_IMAGE },
  // 1/4 vCPU and 1 GiB, the size it was proven on (records/spike-bundler). alto is a Node process with 237 MB of
  // dependencies; lite (256 MiB) was not tried.
  instanceType: "basic",
  maxInstances: 2,
  observability: { logs: { enabled: true } },
}) {}
