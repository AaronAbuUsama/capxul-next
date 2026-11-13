// The simplest Core: a Worker that says which world it serves. It stands in the stack's Core slot until a caller
// supplies the real Core, and proves the slot: one more Worker, deployed and destroyed with the world.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

export default class PlaceholderCore extends Cloudflare.Worker<PlaceholderCore>()(
  "Core",
  { main: import.meta.url },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    return {
      fetch: Effect.succeed(
        HttpServerResponse.text(JSON.stringify({ core: "placeholder", world: stage }), {
          contentType: "application/json",
        }),
      ),
    };
  }),
) {}
