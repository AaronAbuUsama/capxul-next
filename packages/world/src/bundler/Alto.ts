// The bundler's container: Pimlico's alto 0.0.21, built from images/alto. What it is told (the chain's address, the
// EntryPoint, its keys) is given as ALTO_* variables when its Durable Object starts it. The class is all the Durable
// Object needs to bind it; nothing here runs inside the container.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import { HUB_CAPACITY, REGIONS } from "../hub/names.ts";
import { imageSource } from "../stack/images.ts";

export const ALTO_PORT = 4337;

export class Alto extends Cloudflare.Container<Alto>()(
  "Alto",
  Effect.gen(function* () {
    return {
      // The image every world shares, pinned by digest while its inputs are unchanged (src/stack/images.ts).
      ...(yield* imageSource("bundler")),
      // 1/4 vCPU and 1 GiB, the size it was proven on (records/spike-bundler). alto is a Node process with 237 MB of
      // dependencies; lite (256 MiB) was not tried.
      instanceType: "basic" as const,
      maxInstances: HUB_CAPACITY,
      // With every world's chain object, its index and the worlds' database (src/hub/names.ts).
      constraints: { regions: REGIONS },
      observability: { logs: { enabled: true } },
    };
  }),
) {}
