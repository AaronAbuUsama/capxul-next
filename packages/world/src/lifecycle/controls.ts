// The world's controls at its hub's door that an in-place reset and a snapshot's save need (src/lifecycle/reset.ts,
// src/platform/snapshots.ts): the chain rewound to a snapshot, and the index stopped and resumed.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type { World } from "./spec.ts";
import { doorCall } from "./parts.ts";

type Door = Pick<World, "door">;

const Reset = Schema.Struct({
  snapshot: Schema.String,
  inPlace: Schema.Boolean,
  bytes: Schema.Finite,
  ms: Schema.Finite,
});

/** Rewinds the world's chain, in place, to the state a snapshot saved; the bundler is stopped with it. */
export const resetChain = (world: Door, snapshot: string) =>
  doorCall(world, "chain", HttpClientRequest.post(`/chain/reset/${snapshot}`), Reset);

/**
 * Mines the world's chain's next block at the world's time: `worldMs` as read at host time `atHostMs`, which the
 * chain's object brings to now next to anvil (src/chain/calls.ts, `mineAt`); a frozen clock's (`atHostMs` null) as it is.
 */
export const mineAtWorld = (world: Door, worldMs: number, atHostMs: number | null) =>
  doorCall(
    world,
    "chain",
    HttpClientRequest.post("/chain/mine-at").pipe(HttpClientRequest.bodyJsonUnsafe({ worldMs, atHostMs })),
    Schema.Struct({ minedAt: Schema.Finite }),
  );

/** The chain's time, in whole seconds, and the host time it was read at, both read next to anvil. */
export const chainTime = (world: Door) =>
  doorCall(
    world,
    "chain",
    HttpClientRequest.get("/chain/time"),
    Schema.Struct({ chainSeconds: Schema.Finite, hostMs: Schema.Finite }),
  );

/** Stops Ponder with SIGTERM, so it lets go of its schema lock (src/containers/stop.ts). */
export const stopIndex = (world: Door) =>
  doorCall(world, "index", HttpClientRequest.post("/index/stop"), Schema.Unknown).pipe(Effect.asVoid);

/** Starts Ponder again as it was last started, and does not wait for it. */
export const resumeIndex = (world: Door) =>
  doorCall(world, "index", HttpClientRequest.post("/index/resume"), Schema.Unknown).pipe(Effect.asVoid);
