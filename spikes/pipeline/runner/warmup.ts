// A new world's address, while Cloudflare is still routing it.
//
// A workers.dev address does not go live everywhere at once. For some seconds after the deploy, Cloudflare's edge
// may answer for it by itself, without the Worker: status 404, `text/plain`, body `error code: 1042`. One request
// can reach the Worker and the next one that 404, because they land on different edge servers. Two things follow:
//
//   answersSteadily     A world is ready only after several answers in a row that only the Worker can give: the
//                       Rpc protocol's own `Pong` to a `Ping`. One answer by the edge starts the count again.
//   resendingWhileWarm  For a declared time after that (the world's warm-up), a call the edge answered is sent
//                       again. The Worker never saw it, so nothing can happen twice. Every resend is counted and
//                       ends up in the run record. Once the warm-up is over, the same answer is passed on as it
//                       is, and the call fails: this never hides a world that stopped answering.
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import { constPing, constPong } from "effect/rpc/RpcMessage";

/** How a world is judged ready, and for how long after that a call the edge answered is sent again. */
export interface WarmUpPolicy {
  /** How many answers in a row must come from the Worker itself. */
  readonly answers: number;
  /** The pause between two probes, and between two sends of one call. */
  readonly every: Duration.Duration;
  /** How long after the world is ready a call answered by the edge is still sent again. */
  readonly warmUp: Duration.Duration;
}

/** What the wait for a world saw. Kept in the run record. */
export interface Readiness {
  /** Every probe sent. */
  readonly probes: number;
  /** Probes the Worker did not answer after it had already answered once: the address went away again. */
  readonly relapses: number;
  /** From the first probe to the last of the answers in a row. */
  readonly ms: number;
}

const JSON_TYPE = "application/json";

/**
 * Cloudflare's edge answered instead of the Worker: the address is not routed (yet). Core serves the Rpc group on
 * every path and always answers 200 with JSON, so a 404 that is not JSON cannot be Core's.
 */
export const answeredByEdge = (response: HttpClientResponse.HttpClientResponse): boolean =>
  response.status === 404 && !(response.headers["content-type"] ?? "").startsWith(JSON_TYPE);

/** The Rpc server's whole answer to one `Ping`. */
const Pongs = Schema.fromJsonString(Schema.Tuple([Schema.Struct({ _tag: Schema.Literal(constPong._tag) })]));

/** One probe: an Rpc `Ping`. Each asks a different URL, so no cache on the way can hand back an earlier answer. */
const probe = (url: string, n: number) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(HttpClientRequest.post(`${url}/?ready=${n}`).pipe(HttpClientRequest.bodyText(JSON.stringify(constPing), JSON_TYPE)));
    const text = yield* response.text;
    const pong = response.status === 200 && Option.isSome(Schema.decodeUnknownOption(Pongs)(text));
    return { pong, said: `${response.status} ${response.headers["content-type"] ?? "no content type"}: ${text.slice(0, 80)}` };
  }).pipe(
    Effect.scoped,
    Effect.catch((error) => Effect.succeed({ pong: false, said: `no answer: ${String(error)}`.slice(0, 160) })),
  );

/**
 * Waits until Core at `url` has answered `policy.answers` probes in a row. It has no limit of its own: the world's
 * create step, which it is part of, has a declared timeout.
 */
export const answersSteadily = (url: string, policy: WarmUpPolicy) =>
  Effect.gen(function* () {
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
      if (!pong) yield* (now.answered ? Effect.logWarning : Effect.logDebug)(`probe ${now.probes} of ${url}: ${now.answered ? "the address went away again" : "not ready"}: ${said}`);
      return now;
    });
    const last = yield* Effect.repeat(ask, { schedule: Schedule.spaced(policy.every), until: (now) => now.row >= policy.answers });
    return { probes: last.probes, relapses: last.relapses, ms: (yield* Clock.currentTimeMillis) - started } satisfies Readiness;
  }).pipe(Effect.withSpan("world.answersSteadily"));

/**
 * An HTTP client that sends a request again when Cloudflare's edge answered it and the moment `warmUntil` (epoch
 * milliseconds) has not passed, and adds one to `resent` each time. Any other answer, and the edge's answer after
 * `warmUntil`, is returned as it is.
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
            yield* Effect.logWarning(`${request.url} is not routed yet (${response.status}); sending the call again (resend ${n}, ${left} ms of warm-up left)`);
            return false;
          }),
      }),
    );
