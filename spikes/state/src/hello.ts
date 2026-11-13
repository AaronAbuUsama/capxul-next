// The smallest Worker: one per stage, standing in for whatever a world creates on Cloudflare.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

export default Cloudflare.Worker(
  "Hello",
  { main: import.meta.url },
  Effect.gen(function* () {
    return {
      fetch: Effect.succeed(HttpServerResponse.text("capxul state spike: hello")),
    };
  }),
);
