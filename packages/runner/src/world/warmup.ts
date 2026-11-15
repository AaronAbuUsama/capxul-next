// A new stage's address, while Cloudflare is still routing it (found by the pipeline spike: packages/core/docs/latency.md).
//
// A workers.dev address does not go live everywhere at once: for some seconds after a deploy, Cloudflare's edge can
// answer for it by itself with a 404 that is not JSON, between two answers from the Worker. So:
//
//   answersSteadily     A stage is ready only after several answers in a row that only the Worker can give: the Rpc
//                       protocol's own `Pong` to a `Ping`. One answer by the edge starts the count again.
//   resendingWhileWarm  For a declared time after that, a call the edge answered is sent again. The Worker never saw
//                       it, so nothing happens twice. Every resend is counted into the run record. After that time the
//                       same answer is passed on as it is, and the call is recorded as unanswered.
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Formatter from "effect/Formatter";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import { constPing, constPong } from "effect/rpc/RpcMessage";
import { WORLD_PATH } from "@capxul/core";

/** How a stage is judged ready, and for how long after that a call the edge answered is sent again. */
export interface WarmUpPolicy {
  /** How many answers in a row must come from the Worker itself. */
  readonly answers: number;
  /** The pause between two probes, and between two sends of one call. */
  readonly every: Duration.Duration;
  /** How long after the stage is ready a call answered by the edge is still sent again. */
  readonly warmUp: Duration.Duration;
}

/** What the wait for a stage saw. Kept in the run record. */
export const Readiness = Schema.Struct({
  /** Every probe sent. */
  probes: Schema.Finite,
  /** Probes the Worker did not answer after it had already answered once. */
  relapses: Schema.Finite,
  /** From the first probe to the last of the answers in a row. */
  ms: Schema.Finite,
});
export type Readiness = typeof Readiness.Type;

/** Cloudflare's edge answered instead of the Worker. Core answers every path with JSON (packages/core, doors.ts). */
export const answeredByEdge = (response: HttpClientResponse.HttpClientResponse): boolean =>
  response.status === 404 && !Str.startsWith("application/json")(response.headers["content-type"] ?? "");

/** The Rpc server's whole answer to one `Ping`. */
const Pongs = Schema.Tuple([Schema.Struct({ _tag: Schema.Literal(constPong._tag) })]);
const isPongs = Schema.is(Pongs);

/**
 * One probe: an Rpc `Ping` to the world's door, which only the Rpc server answers, before any middleware. Each asks a
 * different URL, so no cache on the way can hand back an earlier answer.
 */
const probe = (url: string, n: number) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(
      HttpClientRequest.post(`${url}${WORLD_PATH}?ready=${n}`).pipe(HttpClientRequest.bodyJsonUnsafe(constPing)),
    );
    const body = yield* Effect.option(response.json);
    const pong = response.status === 200 && Option.exists(body, isPongs);
    return { pong, said: `${response.status} ${response.headers["content-type"] ?? "no content type"}` };
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed({ pong: false, said: Str.slice(0, 160)(`no answer: ${Formatter.format(error)}`) }),
    ),
  );

/** Waits until Core at `url` has answered `policy.answers` probes in a row. The create step's timeout bounds it. */
export const answersSteadily = Effect.fn("world.answersSteadily")(function* (url: string, policy: WarmUpPolicy) {
  const started = yield* Clock.currentTimeMillis;
  const seen = yield* Ref.make({ probes: 0, row: 0, relapses: 0, answered: false });
  const ask = Effect.gen(function* () {
    const { probes } = yield* Ref.get(seen);
    const { pong, said } = yield* probe(url, probes + 1);
    const now = yield* Ref.updateAndGet(seen, (was) => ({
      probes: was.probes + 1,
      row: pong ? was.row + 1 : 0,
      relapses: was.relapses + (!pong && was.answered ? 1 : 0),
      answered: was.answered || pong,
    }));
    if (!pong) yield* Effect.logDebug(`probe ${now.probes} of ${url}: not answered by Core: ${said}`);
    return now;
  });
  const last = yield* Effect.repeat(ask, {
    schedule: Schedule.spaced(policy.every),
    until: (now) => now.row >= policy.answers,
  });
  return { probes: last.probes, relapses: last.relapses, ms: (yield* Clock.currentTimeMillis) - started };
});

/**
 * An HTTP client that sends a request again when Cloudflare's edge answered it and the moment `warmUntil` (epoch
 * milliseconds) has not passed, adding one to `resent` each time. Any other answer is returned as it is.
 */
export const resendingWhileWarm =
  (warmUntil: number, every: Duration.Duration, resent: Ref.Ref<number>) =>
  <E, R>(client: HttpClient.HttpClient.With<E, R>): HttpClient.HttpClient.With<E, R> =>
    HttpClient.transform(client, (answer, request) =>
      Effect.repeat(answer, {
        schedule: Schedule.spaced(every),
        until: (response) =>
          Effect.gen(function* () {
            if (!answeredByEdge(response)) return true;
            const left = warmUntil - (yield* Clock.currentTimeMillis);
            if (left <= 0) return true;
            const n = yield* Ref.updateAndGet(resent, (was) => was + 1);
            yield* Effect.logWarning(`${request.url} is not routed yet; resend ${n}, ${left} ms of warm-up left`);
            return false;
          }),
      }),
    );
