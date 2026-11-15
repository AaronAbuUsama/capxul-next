// Core's handlers of the blueprint's domain "world". Its platform operations are packages/world's (src/platform,
// packages/blueprint/docs/decisions.md, entry 51), so Core's own are empty: each fails with the blueprint's
// `NotImplemented`, naming itself. Core serves `world.clock.warp` (src/site-ops).
import { Errors, type OperationName } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { siteOps } from "../site-ops/door.ts";

/** The answer of an operation that has no implementation in Core. */
const unbuilt = (operation: OperationName) => () => Effect.fail(Errors.NotImplemented.make({ operation }));

/** Its share of the platform group: what `packages/world` serves. Core serves it until its platform door goes. */
export const platform = {
  "world.create": unbuilt("world.create"),
  "world.show": unbuilt("world.show"),
  "world.snapshot.save": unbuilt("world.snapshot.save"),
  "world.snapshot.restore": unbuilt("world.snapshot.restore"),
  "world.list": unbuilt("world.list"),
  "world.snapshot.list": unbuilt("world.snapshot.list"),
  "world.snapshot.delete": unbuilt("world.snapshot.delete"),
};

/** Its share of the world group. */
export const world = { "world.clock.warp": siteOps["world.clock.warp"] };
