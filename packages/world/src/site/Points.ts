// A world's company sites across an in-place reset (roadmap 1.16 and 1.17): saved to a point of the bench with the
// world's snapshot, and put back in place to it when the world is reset. The bench's site door does the work
// (packages/platform, door/points.py: `POST /world/save` and `POST /world/reset`); this is the world's half, as
// Saved.ts is for a restore into a new world.
//
// The door's reset puts the world's clock entry back as it was saved (a running clock at its saved offset), while a
// reset world's clock reads the snapshot's time at the reset (src/lifecycle/reset.ts), so the entry is set to the
// world's clock right after (`POST /clock`): Core, the chain and the bench then read one clock.
//
// Not yet run against a bench: none is reachable from this container (roadmap 1.4). A world with no company has
// nothing here.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { nameOf } from "../stack/names.ts";
import { doorCall, soon, tokenFor } from "./Bench.ts";
import type { BenchClock } from "./Saved.ts";

const Point = Schema.Struct({ world: Schema.String, point: Schema.String });

/** Saves every site of world `stage` on `bench` to a point named after the snapshot. */
export const savePoint = Effect.fn("world.site.savePoint")(function* (stage: string, bench: string, snapshot: string) {
  const { door, token } = yield* tokenFor(bench, nameOf(stage), 0, yield* soon);
  return yield* doorCall(
    door,
    token,
    HttpClientRequest.post("/world/save").pipe(HttpClientRequest.bodyJsonUnsafe({ point: snapshot })),
    Point,
  );
});

/** Puts every site of world `stage` back to the snapshot's point, in place, then its clock entry to `clock`. */
export const resetPoint = Effect.fn("world.site.resetPoint")(function* (
  stage: string,
  bench: string,
  snapshot: string,
  clock: BenchClock,
) {
  const { door, token } = yield* tokenFor(bench, nameOf(stage), 0, yield* soon);
  const reset = yield* doorCall(
    door,
    token,
    HttpClientRequest.post("/world/reset").pipe(HttpClientRequest.bodyJsonUnsafe({ point: snapshot })),
    Point,
  );
  yield* doorCall(
    door,
    token,
    HttpClientRequest.post("/clock").pipe(HttpClientRequest.bodyJsonUnsafe(clock)),
    Schema.Unknown,
  );
  return reset;
});
