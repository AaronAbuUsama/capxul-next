// `world platform serve`: the platform group served on this machine's loopback until the process is stopped, for a
// caller on the same machine (decisions.md, 51). The runner serves it in its own process instead.
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Made, Tried } from "./create.ts";
import { Operators } from "./operators.ts";
import { platformUrl, servePlatform } from "./server.ts";

const announced = Layer.effectDiscard(
  platformUrl.pipe(Effect.flatMap((url) => Effect.logInfo(`the platform answers at ${url}`))),
);

export const servePlatformOn = (port: number) =>
  announced.pipe(
    Layer.provideMerge(servePlatform),
    Layer.provideMerge(BunHttpServer.layer({ port, hostname: "127.0.0.1" })),
    Layer.provide(Layer.mergeAll(Made.layer, Tried.layer, Operators.fromConfig)),
    Layer.launch,
  );
