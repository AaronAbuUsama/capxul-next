// How many company sites the bench makes at once without one made cold: the ready blank copies its door keeps
// (packages/platform/door, pool.py, DOOR_BLANK_POOL_SIZE), as its `GET /templates` reports them. A run side by side caps
// its sites at it (packages/runner, worlds/side-by-side.ts), so it never asks for more than the deployed pool holds.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { SWEEPER } from "../site-template/sweep.ts";
import { BenchStage, soon, tokenFor } from "./bench.ts";
import { doorCall } from "./client.ts";

/** What the door's `GET /templates` says of its pool: its ready blank copies, when it says. */
const Pool = Schema.Struct({ blank_pool_size: Schema.optional(Schema.Int) });

/**
 * The ready blank copies the bench `WORLD_BENCH` names keeps. None with no bench, a door that does not say, or one not
 * reached: the run's setting is then its bound. Asked with a token for no world (quota 0), as a sweep is.
 */
export const benchPool = Effect.gen(function* () {
  const bench = yield* BenchStage;
  if (Option.isNone(bench)) return Option.none<number>();
  const { door, token } = yield* tokenFor(bench.value, SWEEPER, 0, yield* soon);
  const listed = yield* doorCall(door, token, HttpClientRequest.get("/templates"), Pool);
  return Option.fromNullishOr(listed.blank_pool_size);
}).pipe(Effect.orElseSucceed(() => Option.none<number>()));
