// bun test runner/warmup.test.ts
// The readiness wait and the warm-up resend, against a client that answers from a script instead of a network.
import { describe, expect, test } from "bun:test";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as References from "effect/References";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { answeredByEdge, answersSteadily, resendingWhileWarm } from "./warmup.ts";

type Answer = "pong" | "edge html" | "edge 1042" | "core 404" | "defect";

/** What Cloudflare's edge and Core answer, as observed on 13 November 2026. */
const answers: Record<Answer, () => Response> = {
  pong: () => new Response('[{"_tag":"Pong"}]', { status: 200, headers: { "content-type": "application/json" } }),
  "edge html": () => new Response("<!DOCTYPE html><title>There is nothing here yet</title>", { status: 404, headers: { "content-type": "text/html; charset=UTF-8" } }),
  "edge 1042": () => new Response("error code: 1042", { status: 404, headers: { "content-type": "text/plain; charset=UTF-8" } }),
  "core 404": () => new Response("[]", { status: 404, headers: { "content-type": "application/json" } }),
  defect: () => new Response('[{"_tag":"Defect","defect":"x"}]', { status: 200, headers: { "content-type": "application/json" } }),
};

/** A client that gives the answers of `script` in order and then repeats the last one; `sent` counts the requests. */
const scripted = (script: ReadonlyArray<Answer>, sent: Ref.Ref<number>) =>
  HttpClient.make((request) =>
    Effect.map(Ref.getAndUpdate(sent, (n) => n + 1), (n) => HttpClientResponse.fromWeb(request, answers[script[Math.min(n, script.length - 1)] ?? "pong"]())),
  );

/** The warnings about each relapse and each resend are the code's to give and not this file's to show. */
const quietly = Effect.provideService(References.MinimumLogLevel, "None");

const policy = { answers: 3, every: Duration.millis(1), warmUp: Duration.seconds(30) };

const waitFor = (script: ReadonlyArray<Answer>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sent = yield* Ref.make(0);
      return yield* answersSteadily("https://core.example", policy).pipe(Effect.provide(Layer.succeed(HttpClient.HttpClient, scripted(script, sent))));
    }).pipe(quietly),
  );

/** One GET through `resendingWhileWarm`, with the warm-up ending `warmFor` from now: the status that came back, the requests sent, the resends counted. */
const getOnce = (script: ReadonlyArray<Answer>, warmFor: number) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sent = yield* Ref.make(0);
      const resent = yield* Ref.make(0);
      const client = resendingWhileWarm((yield* Clock.currentTimeMillis) + warmFor, Duration.millis(1), resent)(scripted(script, sent));
      const response = yield* client.get("https://core.example/");
      return { status: response.status, sent: yield* Ref.get(sent), resent: yield* Ref.get(resent) };
    }).pipe(quietly),
  );

describe("which answers are the edge's and not Core's", () => {
  const edge = (answer: Answer) => answeredByEdge(HttpClientResponse.fromWeb({} as never, answers[answer]()));
  test("a 404 that is not JSON is the edge's, whichever page it shows", () => {
    expect(edge("edge html")).toBe(true);
    expect(edge("edge 1042")).toBe(true);
  });
  test("anything Core can say is not: a 200, and a 404 that is JSON", () => {
    expect(edge("pong")).toBe(false);
    expect(edge("defect")).toBe(false);
    expect(edge("core 404")).toBe(false);
  });
});

describe("the wait for a world", () => {
  test("three pongs in a row are enough", () => waitFor(["pong"]).then((seen) => expect(seen).toMatchObject({ probes: 3, relapses: 0 })));

  test("one good answer is not: an address that goes away again starts the count again, and is counted", () =>
    waitFor(["pong", "edge html", "edge html", "pong", "pong", "edge 1042", "pong"]).then((seen) => expect(seen).toMatchObject({ probes: 9, relapses: 3 })));

  test("answers before the first pong are not relapses", () => waitFor(["edge 1042", "edge 1042", "pong"]).then((seen) => expect(seen).toMatchObject({ probes: 5, relapses: 0 })));

  test("a 200 that is not a pong does not count", () => waitFor(["defect", "pong"]).then((seen) => expect(seen).toMatchObject({ probes: 4, relapses: 0 })));
});

describe("a call during and after the warm-up", () => {
  test("during the warm-up, a call the edge answered is sent again until Core answers, and each resend is counted", () =>
    getOnce(["edge html", "edge 1042", "pong"], 60_000).then((got) => expect(got).toEqual({ status: 200, sent: 3, resent: 2 })));

  test("after the warm-up, the edge's answer is passed on as it is: sent once, nothing counted", () =>
    getOnce(["edge html", "pong"], -1).then((got) => expect(got).toEqual({ status: 404, sent: 1, resent: 0 })));

  test("resending stops when the warm-up ends, even if the edge still answers", () =>
    getOnce(["edge html"], 40).then((got) => {
      expect(got.status).toBe(404);
      expect(got.resent).toBe(got.sent - 1);
      expect(got.sent).toBeGreaterThan(1);
    }));

  test("an answer of Core's is never resent, whatever it says", () =>
    Promise.all([getOnce(["defect", "pong"], 60_000), getOnce(["core 404", "pong"], 60_000)]).then((got) =>
      expect(got).toEqual([
        { status: 200, sent: 1, resent: 0 },
        { status: 404, sent: 1, resent: 0 },
      ]),
    ));
});
