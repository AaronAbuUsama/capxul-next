// A world runs once its Core answers steadily. A new workers.dev address does not go live everywhere at once: for
// some seconds after a deploy Cloudflare's edge can answer for it with a 404 that is not Core's, between two answers
// of Core's (packages/runner, src/world/warmup.ts). So world.create and world.snapshot.restore answer only after
// Core's health check has answered `ANSWERS` times in a row, which a caller's first calls then need not wait for.
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import { CORE_HEALTH } from "./health.ts";
import { PlatformFailed } from "../../common/failures.ts";

const ANSWERS = 10;
// Ten answers over about 2.5 s: the create waits on it after Core's deploy (src/things/world/bring-up.ts), and the runner
// sends a call the edge answered again while a stage warms up (packages/runner, src/world/warmup.ts).
const EVERY = "250 millis";
const AT_MOST = "2 minutes";

const answered = (door: string) =>
  HttpClient.get(`${door}${CORE_HEALTH}`).pipe(
    Effect.map(
      (response) =>
        response.status === 200 && Str.startsWith("application/json")(response.headers["content-type"] ?? ""),
    ),
    Effect.scoped,
    Effect.orElseSucceed(() => false),
  );

/** Waits until the Core at `door` has answered its health check `ANSWERS` times in a row. */
export const steady = (door: string) =>
  Effect.gen(function* () {
    const row = yield* Ref.make(0);
    yield* Effect.repeat(
      Effect.flatMap(answered(door), (ok) => Ref.updateAndGet(row, (was) => (ok ? was + 1 : 0))),
      { schedule: Schedule.spaced(EVERY), until: (now) => now >= ANSWERS },
    );
  }).pipe(
    Effect.timeoutOrElse({
      duration: AT_MOST,
      orElse: () =>
        PlatformFailed.make({ step: "facts", message: `${door} did not answer steadily within ${AT_MOST}` }),
    }),
    Effect.withSpan("platform.steady"),
  );
