// Core's two doors on one Worker: the platform group at `/platform` and the world group at `/world`, each an HTTP
// POST of Effect Rpc in JSON, as the SDK's transport calls them (a trailing slash is the same door). Any other path answers 404 with JSON, so an answer
// that is not JSON is never Core's: it is Cloudflare's edge, still routing a new address.
import { PLATFORM_PATH, PlatformRpcs, WORLD_PATH, WorldRpcs } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as RpcServer from "effect/rpc/RpcServer";

// The blueprint declares the doors' paths, once (packages/blueprint/src/telemetry.ts), so Core and the SDK agree.
export { PLATFORM_PATH, WORLD_PATH };

// A defect in one call answers that call only; it does not end the caller's whole client.
const options = { disableFatalDefects: true } as const;

/** Serves one request at whichever door its path names. Needs the handlers and middlewares of both groups. */
export const serveDoors = Effect.map(
  Effect.all([RpcServer.toHttpEffect(PlatformRpcs, options), RpcServer.toHttpEffect(WorldRpcs, options)]),
  ([platform, world]) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      // Effect's Rpc client posts to its URL with a trailing slash: `/world/` is the world's door too.
      const path = Option.match(HttpServerRequest.toURL(request), {
        onNone: () => "",
        onSome: (url) => Str.replace(/\/+$/, "")(url.pathname),
      });
      if (path === WORLD_PATH) return yield* world;
      if (path === PLATFORM_PATH) return yield* platform;
      return HttpServerResponse.jsonUnsafe({ door: null, doors: [PLATFORM_PATH, WORLD_PATH] }, { status: 404 });
    }),
);
