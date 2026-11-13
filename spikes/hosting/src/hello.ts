// Step 1 of the hosting spike: the smallest Worker, to prove a deploy from an agent's container.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

export default Cloudflare.Worker(
  "Hello",
  { main: import.meta.url },
  Effect.gen(function* () {
    return {
      fetch: Effect.succeed(HttpServerResponse.text("capxul hosting spike: hello")),
    };
  }),
);
