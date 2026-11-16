// Which world a journey's restored world came from, as its own calls say (client.ts records every world a call made,
// `MadeWorlds`): a journey's take-down destroys a restored world before its source (teardown.ts, `destroyInOrder`).
import type { OperationName } from "@capxul/blueprint";
import * as World from "@capxul/world";
import * as Predicate from "effect/Predicate";

/** A world a call made, by stage, and the world it was restored from when a world.snapshot.restore made it. */
export interface MadeWorld {
  readonly stage: string;
  readonly from: string | null;
}

/** The operation that makes a world from another's snapshot: its payload names the source. */
const RESTORES: Partial<Record<OperationName, true>> = { "world.snapshot.restore": true };

/** The world, by stage, a world.snapshot.restore was asked to restore from; null for any other call. */
export const restoredFromOf = (call: { readonly operation: OperationName; readonly payload: unknown }): string | null =>
  RESTORES[call.operation] === true &&
  Predicate.hasProperty(call.payload, "world") &&
  Predicate.isString(call.payload.world)
    ? World.stageOf(call.payload.world)
    : null;
