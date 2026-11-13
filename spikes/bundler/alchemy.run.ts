// The bundler spike's stack. Every resource is created under the stack name "CapxulSpikeBundler" and a stage whose
// name starts "bd-", so nothing here can collide with what else is in the Cloudflare account or with another agent's
// stack. Every stage is one world: its door (a Worker), its chain (a Durable Object that owns an anvil container),
// the R2 bucket the chain's state is saved to while its container is stopped, and its bundler (a Durable Object that
// owns an alto container). There is no database: nothing here needs one.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import Door from "./src/Door.ts";

export default Alchemy.Stack(
  "CapxulSpikeBundler",
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const door = yield* Door;
    return { world: stage, url: door.url };
  }),
);
