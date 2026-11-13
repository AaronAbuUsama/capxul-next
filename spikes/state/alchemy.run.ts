// The state spike's stack. Its state is kept in the account's shared Cloudflare state store, not on local disk, so a
// stage deployed from one container can be planned, read and destroyed from another that has never seen it.
//
// Every stage is one tiny Worker, standing in for a world's Cloudflare resources. A stage records who owns it and when
// it expires in the stack's outputs, which the state store keeps; the sweeper (src/sweep.ts) reads them from there.
// A stage deployed without WORLD_EXPIRES_AT records no expiry: the sweeper must leave it alone and report it.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import Hello from "./src/hello.ts";

export const STACK_NAME = "CapxulSpikeState";

export default Alchemy.Stack(
  STACK_NAME,
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const owner = yield* Config.String("WORLD_OWNER").pipe(Config.withDefault(""));
    const expiresAt = yield* Config.String("WORLD_EXPIRES_AT").pipe(Config.withDefault(""));
    const hello = yield* Hello;
    return {
      world: stage,
      url: hello.url,
      ...(owner ? { owner } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    };
  }),
);
