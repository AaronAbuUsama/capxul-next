// The world a chain belongs to on the hub: kept by the world's chain object when the world is registered, and checked
// on every call to the world (src/door/Door.ts). The token's second half must be the registered secret, and the world
// must not have expired: the hub serves no expired world, whether or not the sweeper has removed it yet.
import type * as Cloudflare from "@alchemy.run/cloudflare";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { ChainFailed } from "../failures.ts";
import type { Registration } from "../hub/registration.ts";

/** Where the world's registration is kept in its chain object's storage. */
const REGISTERED = "world";

export const admission = (storage: Cloudflare.DurableObjectStorage) => {
  /** The world this chain belongs to; a chain of no world serves nothing. */
  const registered = storage.get<Registration>(REGISTERED).pipe(
    Effect.filterOrFail(
      (found): found is Registration => found !== undefined,
      () => ChainFailed.make({ step: "world", message: "no world is registered here" }),
    ),
  );

  /** Keeps the world; asked again with the same secret, it changes nothing. */
  const register = (world: Registration) =>
    Effect.gen(function* () {
      const old = yield* storage.get<Registration>(REGISTERED);
      if (old !== undefined && old.secret === world.secret) return { registered: world.stage, again: true };
      yield* storage.put(REGISTERED, world);
      return { registered: world.stage, again: false };
    });

  /** The world's stage when `secret` is its token's and the world has not expired; refused otherwise. */
  const admit = (secret: string) =>
    Effect.gen(function* () {
      const world = yield* registered;
      if (world.secret !== secret) return yield* ChainFailed.make({ step: "world", message: "not this world" });
      const now = yield* Clock.currentTimeMillis;
      if (DateTime.toEpochMillis(DateTime.makeUnsafe(world.expiresAt)) <= now)
        return yield* ChainFailed.make({ step: "world", message: `${world.stage} expired at ${world.expiresAt}` });
      return world.stage;
    });

  return { registered, register, admit };
};
