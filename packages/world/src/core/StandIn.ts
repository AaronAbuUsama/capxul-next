// The stand-in for Core, until packages/core lands: a Worker with Core's door shape, which is one HTTP endpoint that
// answers a health check. It proves the slot: one more Worker, deployed and destroyed with the world.
//   GET /health   200 {"core":"stand-in","world":<stage>}
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { CORE_HEALTH } from "./health.ts";

export default class StandInCore extends Cloudflare.Worker<StandInCore>()(
  "Core",
  { main: import.meta.url },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const { pathname } = new URL(request.url, "http://core");
        return request.method === "GET" && pathname === CORE_HEALTH
          ? HttpServerResponse.jsonUnsafe({ core: "stand-in", world: stage })
          : HttpServerResponse.jsonUnsafe({ error: "no such route" }, { status: 404 });
      }),
    };
  }),
) {}
